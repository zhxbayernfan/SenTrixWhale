// media/geo_lookup.js — STW 内置地理库的查询接口
//
// 数据:
//   data/geo/cn.json    35 省 / 348 地级市 / 2869 区县（从 PyGeoCN 的天地图边界提取，只留名字）
//   data/geo/world.json 46 国 / 洲 / 主要城市与州（含反向索引）
//
// 设计: 国内三级齐全，国外只到"国家 + 洲 + 用户说得出的一层（市或州）"。
// 跨国地名穷举不完，末层一律宽松——词典只帮忙归位，不阻断存图。

const path = require('path');
const CN = require(path.join(__dirname, '..', 'data', 'geo', 'cn.json'));
const WORLD = require(path.join(__dirname, '..', 'data', 'geo', 'world.json'));

let IDX = null;
function index() {
    if (IDX) return IDX;
    const provOfCity = new Map();   // 市 → 省
    const cityOfDistrict = new Map(); // 区 → [{prov, city}]
    for (const [prov, cities] of Object.entries(CN)) {
        for (const [city, districts] of Object.entries(cities)) {
            provOfCity.set(city, prov);
            for (const d of districts) {
                if (!cityOfDistrict.has(d)) cityOfDistrict.set(d, []);
                cityOfDistrict.get(d).push({ prov, city });
            }
        }
    }
    IDX = { provOfCity, cityOfDistrict };
    return IDX;
}

const PROVINCES = new Set(Object.keys(CN));
const COUNTRIES = WORLD['国家'];
const REV = WORLD['_反向索引'];   // 城市或州 → {country, 洲}

/**
 * 查一个地名在国内属于哪一级
 * @param {string} name 用户说的地名（可带"省/市/区/县"后缀）
 * @param {string} [preferProvince] 歧义时优先的省（通常是用户所在省）
 * @returns {{level:'province'|'city'|'district', province:string, city?:string, district?:string}|null}
 */
function lookupCn(name, preferProvince) {
    const raw = String(name || '').trim();
    const n = raw.replace(/(维吾尔自治区|壮族自治区|回族自治区|特别行政区|自治区|省|市辖区|自治州|地区|盟|新区|自治县|自治旗|区|县|旗|市)$/u, '');
    if (!n) return null;

    // 省
    if (PROVINCES.has(n)) return { level: 'province', province: n };

    // 市
    const prov = index().provOfCity.get(n);
    if (prov) return { level: 'city', province: prov, city: n };

    // 区（可能重名，按 preferProvince 挑）
    const hits = index().cityOfDistrict.get(n);
    if (hits && hits.length) {
        const pick = (preferProvince && hits.find((h) => h.prov === preferProvince)) || hits[0];
        return { level: 'district', province: pick.prov, city: pick.city, district: n };
    }
    return null;
}

/**
 * 查一个地名是不是国外的（国家 / 城市 / 州）
 * @returns {{country:string, continent:string, kind:'country'|'city'|'state'}|null}
 */
function lookupWorld(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    if (COUNTRIES[n]) return { country: n, continent: COUNTRIES[n]['洲'], kind: 'country' };
    const hit = REV[n];
    if (!hit) return null;
    const isState = (COUNTRIES[hit.country]['州'] || []).includes(n);
    return { country: hit.country, continent: hit['洲'], kind: isState ? 'state' : 'city' };
}

/** 一句话里所有命中的地名（国内 + 国外） */
function matchAll(text) {
    const t = String(text || '');
    const { cn, world } = flat();
    // 单字地名（很多区去掉"区"就剩一个字，如"东""南"）会把整句话污染掉，
    // 例如"日本东京"里的"东"会被当成四川攀枝花的东区。一律不要。
    const pick = (list) => list
        .filter((x) => x.name.length >= 2 && t.includes(x.name))
        .sort((a, b) => b.name.length - a.name.length);
    return { cn: pick(cn), world: pick(world) };
}

let FLAT = null;
function flat() {
    if (FLAT) return FLAT;
    const cn = [];
    for (const [prov, cities] of Object.entries(CN)) {
        cn.push({ name: prov, level: 'province', province: prov });
        for (const [city, districts] of Object.entries(cities)) {
            cn.push({ name: city, level: 'city', province: prov, city });
            for (const d of districts) cn.push({ name: d, level: 'district', province: prov, city, district: d });
        }
    }
    const world = [];
    for (const [name, info] of Object.entries(COUNTRIES)) {
        world.push({ name, kind: 'country', country: name, continent: info['洲'] });
    }
    for (const [name, info] of Object.entries(REV)) {
        const isState = (COUNTRIES[info.country]['州'] || []).includes(name);
        world.push({ name, kind: isState ? 'state' : 'city', country: info.country, continent: info['洲'] });
    }
    cn.sort((a, b) => b.name.length - a.name.length);
    world.sort((a, b) => b.name.length - a.name.length);
    return (FLAT = { cn, world });
}

/** 在一句话里找最长命中的地名（国内优先，其次国外） */
function matchLongest(text, preferProvince) {
    const t = String(text || '');
    const { cn, world } = flat();
    const hit = cn.find((x) => t.includes(x.name));
    if (hit) {
        if (hit.level === 'district' && preferProvince) {
            const alt = cn.find((x) => x.name === hit.name && x.level === 'district' && x.province === preferProvince);
            if (alt) return alt;
        }
        return hit;
    }
    return world.find((x) => t.includes(x.name)) || null;
}

// ── 给"小鲸鱼"用的查询接口：问什么答什么，答不出就说不知道 ──
// 注意：这不是让 4B 模型自己调工具（它调不动），而是 bridge 在本地先判一次，
// 命中了就直接回，不烧模型。
function ask(question) {
    const q = String(question || '');

    // 「X 在哪个省 / 哪个国家 / 属于哪里」
    const m = q.match(/([\u4e00-\u9fa5]{2,10}?)(?:在哪个|属于哪个|是哪个)(省|市|区|国家)[吗呢？?]*$/);
    if (m) {
        const name = m[1];
        const cn = lookupCn(name);
        if (cn) return { ok: true, text: `${name}在${cn.province}${cn.city ? '·' + cn.city : ''}${cn.district ? '·' + cn.district : ''}` };
        const w = lookupWorld(name);
        if (w) return { ok: true, text: `${name}在${w.country}（${w.continent}）` };
        return { ok: false, text: `这个我查不到——${name}是哪儿呀？` };
    }

    // 「X 有哪些区 / 下辖什么」
    const d = q.match(/([\u4e00-\u9fa5]{2,10}?)(?:有|下辖)(?:哪些|什么)(?:区|区县|县|市)/);
    if (d) {
        const name = d[1];
        const cn = lookupCn(name);
        if (cn && cn.city && CN[cn.province] && CN[cn.province][cn.city]) {
            const list = CN[cn.province][cn.city];
            return { ok: true, text: `${cn.city}下辖 ${list.length} 个区县：${list.slice(0, 12).join('、')}${list.length > 12 ? '…' : ''}` };
        }
        if (CN[name]) {
            const cities = Object.keys(CN[name]);
            return { ok: true, text: `${name}下辖 ${cities.length} 个地级市：${cities.slice(0, 12).join('、')}…` };
        }
    }
    return { ok: false, text: '' };   // 空串表示"不是地理问题"，交回给模型
}

module.exports = { lookupCn, lookupWorld, matchLongest, matchAll, ask, PROVINCES, COUNTRIES };

// 自测: node media/geo_lookup.js 南山
if (require.main === module) {
    const arg = process.argv.slice(2).join(' ');
    if (/[?？]$|哪些|哪个/.test(arg)) console.log(ask(arg));
    else console.log({ cn: lookupCn(arg, '广东'), world: lookupWorld(arg) });
}
