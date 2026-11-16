// media/album_resolver.js — 把一句人话解析成「相册路径 + 拍摄时间 + 精度」
//
// 设计前提（zhx 定的，已实测）：
//   照片过 QQ 之后 EXIF 一点不剩，时间和地点 100% 靠用户口述。
//   所以这里只做一件事：把"深圳南山 2023年4月29日"这种话，变成机器能查的结构。
//
// 三条铁律：
//   1. 词典只解决"归位"，不解决"能不能存"。词典里没有的地名，按用户说的建，绝不拒绝。
//   2. 说得出区就记区，说不出就停在市，不逼问。
//   3. 时间解析不出来就不写时间，不猜"今天"——猜出来的时间比没有更糟。

const BRANCH = { LOCAL: '本地省', NATION: '全国', GLOBAL: '全球' };

const { lookupCn, lookupWorld, matchAll } = require('./geo_lookup');

const CN = require('../data/geo/cn.json');
const CITIES = Object.fromEntries(Object.entries(CN).map(([p, cs]) => [p, Object.keys(cs)]));
const PROVINCES = Object.keys(CN);

// 指令词 / 干扰词：解析前先剥掉
const NOISE = ['收进画廊', '收进相册', '收进来', '收进', '存进', '存到', '存起来', '存一下',
    '请收', '帮我收', '帮忙收', '画廊', '相册', '照片', '这张', '那张', '一下'];

function stripNoise(text) {
    let s = String(text || '');
    s = s.replace(/@[^\s，,。.、]+/g, ' ');   // 剥所有 @提及（群里 @4 / @Zhx的QQ小肥鱼 都算），不当地名
    for (const w of NOISE) s = s.split(w).join(' ');
    return s.replace(/\s+/g, ' ').trim();
}

// ── 坐标 → 城市（只在中国主要城市里找最近的；超过 0.8 度就拒绝，不猜）──
const CITY_COORDS = {
    北京: [39.9042, 116.4074], 上海: [31.2304, 121.4737], 天津: [39.3434, 117.3616],
    重庆: [29.5630, 106.5516], 杭州: [30.2741, 120.1551], 绍兴: [30.0300, 120.5800],
    宁波: [29.8683, 121.5440], 温州: [27.9938, 120.6994], 南京: [32.0603, 118.7969],
    苏州: [31.2989, 120.5853], 无锡: [31.4912, 120.3119], 徐州: [34.2058, 117.2848],
    合肥: [31.8206, 117.2272], 济南: [36.6512, 117.1201], 青岛: [36.0671, 120.3826],
    烟台: [37.4638, 121.4479], 郑州: [34.7466, 113.6254], 武汉: [30.5928, 114.3055],
    长沙: [28.2282, 112.9388], 南昌: [28.6820, 115.8579], 福州: [26.0745, 119.2965],
    厦门: [24.4798, 118.0894], 泉州: [24.8741, 118.6757], 广州: [23.1291, 113.2644],
    深圳: [22.5431, 114.0579], 珠海: [22.2707, 113.5767], 佛山: [23.0219, 113.1214],
    东莞: [23.0207, 113.7518], 中山: [22.5176, 113.3928], 惠州: [23.1115, 114.4162],
    汕头: [23.3535, 116.6820], 西安: [34.3416, 108.9398], 成都: [30.5728, 104.0668],
    昆明: [25.0389, 102.7183], 贵阳: [26.6470, 106.6302], 南宁: [22.8170, 108.3665],
    海口: [20.0444, 110.1999], 三亚: [18.2528, 109.5119], 石家庄: [38.0428, 114.5149],
    太原: [37.8706, 112.5489], 沈阳: [41.8057, 123.4315], 大连: [38.9140, 121.6147],
    长春: [43.8171, 125.3235], 哈尔滨: [45.8038, 126.5350], 呼和浩特: [40.8424, 111.7490],
    兰州: [36.0611, 103.8343], 西宁: [36.6171, 101.7782], 银川: [38.4872, 106.2309],
    乌鲁木齐: [43.8256, 87.6168], 拉萨: [29.6520, 91.1721], 香港: [22.3193, 114.1694],
    澳门: [22.1987, 113.5439], 台北: [25.0330, 121.5654],
};
function cityFromGps(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    let best = null;
    for (const [city, [clat, clon]] of Object.entries(CITY_COORDS)) {
        const d = Math.hypot(lat - clat, lon - clon);
        if (!best || d < best.d) best = { city, d };
    }
    return best && best.d < 0.8 ? best.city : null;
}

// ── 时间解析 ───────────────────────────────────────────────────
// 返回 { date: Date|null, precision: 'day'|'month'|'year'|null }
function parseWhen(text, now = new Date()) {
    const s = String(text || '');
    const p2 = (n) => String(n).padStart(2, '0');
    const mk = (y, mo, d, h, mi, precision) => {
        const dt = new Date(y, mo - 1, d, h == null ? 12 : h, mi == null ? 0 : mi, 0);
        return isNaN(dt.getTime()) ? null : { date: dt, precision };
    };

    // 时刻：16:50 / 21点49分 / 23点04 / 16时50分
    let hour = null, minute = null;
    const tm = s.match(/(\d{1,2})\s*[:：]\s*(\d{2})/) || s.match(/(\d{1,2})\s*[点时]\s*(?:(\d{1,2})\s*分?)?/);
    if (tm) {
        hour = Number(tm[1]);
        minute = tm[2] ? Number(tm[2]) : 0;
        if (hour > 23) { hour = null; minute = null; }
    }

    const t = stripNoise(s);

    // 1) 年月日（中文）
    let m = t.match(/(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (m) return mk(fixYear(m[1]), +m[2], +m[3], hour, minute, 'day');

    // 2) 数字分隔（- / .）
    m = t.match(/(?<!\d)((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
    if (m) return mk(+m[1], +m[2], +m[3], hour, minute, 'day');

    // 3) 紧凑数字：8 位 YYYYMMDD，6 位 YYMMDD（6 位优先当日期）
    m = t.match(/(?<!\d)(\d{8})(?!\d)/);
    if (m) {
        const v = m[1];
        return mk(+v.slice(0, 4), +v.slice(4, 6), +v.slice(6, 8), hour, minute, 'day');
    }
    m = t.match(/(?<!\d)(\d{6})(?!\d)/);
    if (m) {
        const v = m[1];
        const yy = +v.slice(0, 2), mo = +v.slice(2, 4), dd = +v.slice(4, 6);
        if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) return mk(fixYear(yy), mo, dd, hour, minute, 'day');
    }

    // 4) 相对日：今天/昨天/前天/N 天前
    // 「刚才/刚刚/方才」也是今天——目标点名要支持的说法
    if (/今天|今日|刚才|刚刚|方才|这会儿|今儿/.test(t)) return mk(now.getFullYear(), now.getMonth() + 1, now.getDate(), hour, minute, 'day');
    // 「上周三 / 周三 / 礼拜三 / 星期日」
    const wd = t.match(/(上|本|这)?(?:周|星期|礼拜)([一二三四五六日天1-7])/);
    if (wd) {
        const map = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':0,'天':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':0 };
        const want = map[wd[2]];
        let d = new Date(now);
        const diff = (d.getDay() - want + 7) % 7;
        d = shiftDays(d, -diff);                       // 本周那一天
        if (wd[1] === '上') d = shiftDays(d, -7);      // 上周再退七天
        return mk(d.getFullYear(), d.getMonth() + 1, d.getDate(), hour, minute, 'day');
    }
    if (/昨天|昨日/.test(t)) { const d = shiftDays(now, -1); return mk(d.getFullYear(), d.getMonth() + 1, d.getDate(), hour, minute, 'day'); }
    if (/前天/.test(t)) { const d = shiftDays(now, -2); return mk(d.getFullYear(), d.getMonth() + 1, d.getDate(), hour, minute, 'day'); }
    m = t.match(/(\d{1,3})\s*天前/);
    if (m) { const d = shiftDays(now, -Number(m[1])); return mk(d.getFullYear(), d.getMonth() + 1, d.getDate(), hour, minute, 'day'); }

    // 5) X 个月前的 DD 日
    m = t.match(/(\d{1,2})\s*个?月前(?:\s*(\d{1,2})\s*[日号])?/);
    if (m) {
        const d = shiftMonths(now, -Number(m[1]));
        const day = m[2] ? Number(m[2]) : d.getDate();
        return mk(d.getFullYear(), d.getMonth() + 1, day, hour, minute, 'day');
    }

    // 6) 前年 / 去年 / 今年 (+ 月日)
    const relYear = /前年/.test(t) ? now.getFullYear() - 2 : /去年/.test(t) ? now.getFullYear() - 1 : /今年/.test(t) ? now.getFullYear() : null;
    if (relYear != null) {
        const md = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
        if (md) return mk(relYear, +md[1], +md[2], hour, minute, 'day');
        const mo = t.match(/(\d{1,2})\s*月/);
        if (mo) return mk(relYear, +mo[1], 1, hour, minute, 'month');
        return mk(relYear, 1, 1, hour, minute, 'year');
    }

    // 7) N 年前 (+ 月日)
    m = t.match(/(\d{1,2})\s*年前/);
    if (m) {
        const y = now.getFullYear() - Number(m[1]);
        const md = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
        if (md) return mk(y, +md[1], +md[2], hour, minute, 'day');
        return mk(y, 1, 1, hour, minute, 'year');
    }

    // 7.5) 公历节日：17年元旦 / 2017国庆 / 圣诞
    const FESTIVALS = {
        元旦: [1, 1], 情人节: [2, 14], 妇女节: [3, 8], 劳动节: [5, 1], 儿童节: [6, 1],
        教师节: [9, 10], 国庆节: [10, 1], 国庆: [10, 1], 平安夜: [12, 24],
        圣诞: [12, 25], 跨年: [12, 31],
    };
    const festKey = Object.keys(FESTIVALS).find((k) => t.includes(k));
    if (festKey) {
        const [mo, dd] = FESTIVALS[festKey];
        const ym = t.match(/(\d{2,4})\s*年/) || t.match(/(?<!\d)((?:19|20)\d{2})(?!\d)/);
        const y = ym ? fixYear(ym[1]) : now.getFullYear();
        return mk(y, mo, dd, hour, minute, 'day');
    }

    // 8) 只有月日（补当年）
    m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (m) return mk(now.getFullYear(), +m[1], +m[2], hour, minute, 'day');

    // 9) 只有年月
    m = t.match(/(\d{2,4})\s*年\s*(\d{1,2})\s*月/);
    if (m) return mk(fixYear(m[1]), +m[2], 1, hour, minute, 'month');

    // 10) 只有月
    m = t.match(/(\d{1,2})\s*月(?!\s*\d)/);
    if (m) return mk(now.getFullYear(), +m[1], 1, hour, minute, 'month');

    // 11) 只有年
    m = t.match(/(?<!\d)((?:19|20)\d{2})\s*年?(?!\d)/);
    if (m) return mk(+m[1], 1, 1, hour, minute, 'year');

    return { date: null, precision: null };
}

function fixYear(y) {
    const n = Number(y);
    if (n >= 100) return n;
    return n > 70 ? 1900 + n : 2000 + n;
}
function shiftDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function shiftMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }


// 剥掉时间表述，剩下的才是地名候选
function stripTime(text) {
    let s = String(text || '');
    s = s.replace(/\d{2,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ');
    s = s.replace(/\d{2,4}\s*年\s*\d{1,2}\s*月/g, ' ');
    s = s.replace(/(?<!\d)(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?!\d)/g, ' ');
    s = s.replace(/(?<!\d)\d{8}(?!\d)/g, ' ');
    s = s.replace(/(?<!\d)\d{6}(?!\d)/g, ' ');
    s = s.replace(/\d{1,2}\s*点\s*\d{0,2}\s*分?/g, ' ');
    s = s.replace(/\d{1,2}\s*[:：]\s*\d{2}/g, ' ');
    s = s.replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ');
    s = s.replace(/\d{1,2}\s*月(?![\s\d])/g, ' ');
    s = s.replace(/\d{1,3}\s*天前/g, ' ');
    s = s.replace(/\d{1,2}\s*个?月前/g, ' ');
    s = s.replace(/\d{1,2}\s*年前/g, ' ');
    s = s.replace(/今天|今日|今儿|刚才|刚刚|方才|这会儿|昨天|昨日|前天|去年|前年|今年|(?:上|本|这)?(?:周|星期|礼拜)[一二三四五六日天1-7]/g, ' ');
    s = s.replace(/\d{2,4}\s*年/g, ' ');          // 只有年份
    s = s.replace(/的?\s*\d{1,2}\s*[日号]/g, ' '); // 残余"的12日"
    s = s.replace(/^的|的$/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
}

// ── 地点解析 ───────────────────────────────────────────────────
// 国内：省 / 市 / 区 三级齐（来自内置地理库）
// 国外：洲 / 国 / 用户说得出的一层（市或州），末层宽松
function parsePlace(text, homeProvince = '广东', inPrompt = false) {
    const t = stripTime(stripNoise(text));
    if (!t) return { branch: null, path: null, place: null };

    const { cn: cnHits, world: wHits } = matchAll(t);

    // ── 国内：级别组装 ──
    // 规则：有市命中时，看有没有「属于该市」的区命中 → 有则到区；否则到市。
    // 这样「深圳南山」能到区，「西安」不会被吉林辽源的「西安区」抢走。
    const cities = cnHits.filter((x) => x.level === 'city');
    const districts = cnHits.filter((x) => x.level === 'district');
    let picked = null;

    for (const c of cities) {
        const d = districts.find((x) => x.city === c.city && x.province === c.province);
        if (d) { picked = d; break; }
    }
    if (!picked) {
        const preferred = homeProvince
            ? districts.find((x) => x.province === homeProvince)
            : null;
        picked = (cities.length && cities[0]) || preferred || districts[0]
            || cnHits.find((x) => x.level === 'province') || null;
    }

    if (picked) {
        if (picked.province === homeProvince) {
            const parts = [picked.province];
            if (picked.city) parts.push(picked.city);
            if (picked.district && picked.district !== picked.city) parts.push(picked.district); // 直筒子市（东莞/中山）区名与市同名，不重复
            return {
                branch: 'local',
                path: parts.join('/'),
                place: { province: picked.province, city: picked.city, district: picked.district },
            };
        }
        const parts = [BRANCH.NATION, picked.province];
        if (picked.city) parts.push(picked.city);
        return {
            branch: 'nation',
            path: parts.join('/'),
            place: { province: picked.province, city: picked.city, district: picked.district },
        };
    }

    // ── 国外：国 + 用户说得出的一层（市或州）──
    const country = wHits.find((x) => x.kind === 'country');
    const region = wHits.find((x) => x.kind !== 'country');
    const anyWorld = country || region;
    if (anyWorld) {
        const cz = country || (region && { country: region.country, continent: region.continent, name: region.country });
        const parts = [BRANCH.GLOBAL, cz.continent, cz.country];
        const reg = region && region.country === cz.country ? region.name : null;
        if (reg) parts.push(reg);
        return {
            branch: 'global',
            path: parts.join('/'),
            place: { country: cz.country, continent: cz.continent, region: reg },
        };
    }

    // ── 未归类：带指令或追问中才敢把剩下的话当地名 ──
    // 只在「明确要存」时才把剩下的话当地名。
    // 「画廊」「相册」这种词在闲聊里到处都是，不能当触发词——否则
    // 「那，咱们的画廊呢」会被解析成 全球/未归类/那咱们的呢。
    const directive = inPrompt || /[收存].{0,4}(进|到|入)|存进|存到/.test(String(text));
    // 地名候选只留中文，剥掉代词/虚词，2-8 字才认。
    // 「那咱们的画廊呢」剥完是空的——它本来就不是地名。
    const raw = directive ? t.replace(/[^\u4e00-\u9fa5]/g, '') : '';
    const guess = raw.replace(/(这些|那些|这个|那个|咱们|我们|你们|他们|什么|怎么|哪里|这儿|那儿|这|那|的|了|呢|吗|吧)/g, '');
    const clean = guess.length >= 2 && guess.length <= 8 ? guess : '';
    if (clean) {
        return { branch: 'global', path: [BRANCH.GLOBAL, '未归类', clean].join('/'), place: { unclassified: clean }, guessed: true };
    }
    return { branch: null, path: null, place: null };
}

function provinceOfCity(city) {
    for (const [p, cs] of Object.entries(CITIES)) if (cs.includes(city)) return p;
    if (city === '东莞' || city === '中山') return '广东';
    return null;
}

/**
 * 一句话 → 相册路径 + 时间 + 精度
 * @returns {{ok:boolean, path:string|null, when:Date|null, precision:string|null, missing:string[], branch:string|null}}
 */
function resolve(text, opts = {}) {
    const now = opts.now instanceof Date ? opts.now : new Date();
    const homeProvince = opts.homeProvince || '广东';
    const { date, precision } = parseWhen(text, now);
    const place = parsePlace(text, homeProvince, !!opts.inPrompt);
    const missing = [];
    if (!place.path) missing.push('place');
    if (!date) missing.push('date');
    return {
        ok: missing.length === 0,
        path: place.path,
        branch: place.branch,
        place: place.place,
        guessed: !!place.guessed,
        when: date,
        precision,
        missing,
    };
}

module.exports = { resolve, parseWhen, parsePlace, stripNoise, BRANCH, CITIES, PROVINCES, cityFromGps, CITY_COORDS };

// 自测: node media/album_resolver.js "深圳南山 2023年4月29日"
if (require.main === module) {
    const text = process.argv.slice(2).join(' ');
    const r = resolve(text);
    console.log(JSON.stringify({
        input: text,
        ok: r.ok,
        path: r.path,
        branch: r.branch,
        when: r.when ? (function (d) {
            const p2 = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
        })(r.when) : null,
        precision: r.precision,
        missing: r.missing,
        guessed: r.guessed,
    }, null, 2));
}
