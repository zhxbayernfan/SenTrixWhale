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

// ── 省级行政区（33）──────────────────────────────────────────────
const PROVINCES = [
    '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
    '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
    '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
    '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆',
    '香港', '澳门', '台湾',
];

// ── 地级市 → 省（重点在广东，其余取省会与常见市）────────────────
const CITIES = {
    广东: ['广州', '深圳', '珠海', '汕头', '佛山', '韶关', '湛江', '肇庆', '江门', '茂名',
        '惠州', '梅州', '汕尾', '河源', '阳江', '清远', '东莞', '中山', '潮州', '揭阳', '云浮'],
    浙江: ['杭州', '宁波', '温州', '嘉兴', '湖州', '绍兴', '金华', '衢州', '舟山', '台州', '丽水'],
    江苏: ['南京', '无锡', '徐州', '常州', '苏州', '南通', '连云港', '淮安', '盐城', '扬州', '镇江', '泰州', '宿迁'],
    陕西: ['西安', '铜川', '宝鸡', '咸阳', '渭南', '延安', '汉中', '榆林', '安康', '商洛'],
    河北: ['石家庄', '唐山', '秦皇岛', '邯郸', '邢台', '保定', '张家口', '承德', '沧州', '廊坊', '衡水'],
    山东: ['济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁', '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽'],
    河南: ['郑州', '开封', '洛阳', '平顶山', '安阳', '鹤壁', '新乡', '焦作', '濮阳', '许昌', '漯河', '三门峡', '南阳', '商丘', '信阳', '周口', '驻马店'],
    四川: ['成都', '自贡', '攀枝花', '泸州', '德阳', '绵阳', '广元', '遂宁', '内江', '乐山', '南充', '眉山', '宜宾', '广安', '达州', '雅安', '巴中', '资阳'],
    湖北: ['武汉', '黄石', '十堰', '宜昌', '襄阳', '鄂州', '荆门', '孝感', '荆州', '黄冈', '咸宁', '随州'],
    湖南: ['长沙', '株洲', '湘潭', '衡阳', '邵阳', '岳阳', '常德', '张家界', '益阳', '郴州', '永州', '怀化', '娄底'],
    福建: ['福州', '厦门', '莆田', '三明', '泉州', '漳州', '南平', '龙岩', '宁德'],
    安徽: ['合肥', '芜湖', '蚌埠', '淮南', '马鞍山', '淮北', '铜陵', '安庆', '黄山', '滁州', '阜阳', '宿州', '六安', '亳州', '池州', '宣城'],
    江西: ['南昌', '景德镇', '萍乡', '九江', '新余', '鹰潭', '赣州', '吉安', '宜春', '抚州', '上饶'],
    辽宁: ['沈阳', '大连', '鞍山', '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳', '盘锦', '铁岭', '朝阳', '葫芦岛'],
    云南: ['昆明', '曲靖', '玉溪', '保山', '昭通', '丽江', '普洱', '临沧'],
    广西: ['南宁', '柳州', '桂林', '梧州', '北海', '防城港', '钦州', '贵港', '玉林', '百色', '贺州', '河池', '来宾', '崇左'],
};

// ── 区县 → 市（只做本地省 + 少数重点城市；不全是故意的）─────────
const DISTRICTS = {
    // 深圳
    福田区: '深圳', 福田: '深圳',
    罗湖区: '深圳', 罗湖: '深圳',
    南山区: '深圳', 南山: '深圳',
    盐田区: '深圳', 盐田: '深圳',
    宝安区: '深圳', 宝安: '深圳',
    龙岗区: '深圳', 龙岗: '深圳',
    龙华区: '深圳', 龙华: '深圳',
    坪山区: '深圳', 坪山: '深圳',
    光明区: '深圳', 光明: '深圳',
    大鹏新区: '深圳', 大鹏: '深圳',
    // 广州
    越秀区: '广州', 越秀: '广州',
    荔湾区: '广州', 荔湾: '广州',
    海珠区: '广州', 海珠: '广州',
    天河区: '广州', 天河: '广州',
    白云区: '广州', 白云: '广州',
    黄埔区: '广州', 黄埔: '广州',
    番禺区: '广州', 番禺: '广州',
    花都区: '广州', 花都: '广州',
    南沙区: '广州', 南沙: '广州',
    从化区: '广州', 从化: '广州',
    增城区: '广州', 增城: '广州',
    // 珠海
    香洲区: '珠海', 香洲: '珠海',
    斗门区: '珠海', 斗门: '珠海',
    金湾区: '珠海', 金湾: '珠海',
    // 佛山
    禅城区: '佛山', 禅城: '佛山',
    南海区: '佛山', 南海: '佛山',
    顺德区: '佛山', 顺德: '佛山',
    三水区: '佛山', 三水: '佛山',
    高明区: '佛山', 高明: '佛山',
    // 东莞/中山 是直筒子市，不设区，街镇直接挂在市下
};

// ── 国家 → 洲（跨国照片少，够用即可）────────────────────────────
const COUNTRIES = {
    德国: '欧洲', 法国: '欧洲', 英国: '欧洲', 意大利: '欧洲', 西班牙: '欧洲',
    荷兰: '欧洲', 瑞士: '欧洲', 奥地利: '欧洲', 捷克: '欧洲', 希腊: '欧洲',
    葡萄牙: '欧洲', 瑞典: '欧洲', 挪威: '欧洲', 丹麦: '欧洲', 芬兰: '欧洲',
    俄罗斯: '欧洲', 波兰: '欧洲', 匈牙利: '欧洲', 冰岛: '欧洲', 爱尔兰: '欧洲',
    日本: '亚洲', 韩国: '亚洲', 泰国: '亚洲', 新加坡: '亚洲', 马来西亚: '亚洲',
    越南: '亚洲', 柬埔寨: '亚洲', 老挝: '亚洲', 缅甸: '亚洲', 印度: '亚洲',
    印尼: '亚洲', 菲律宾: '亚洲', 阿联酋: '亚洲', 土耳其: '亚洲', 以色列: '亚洲',
    美国: '北美洲', 加拿大: '北美洲', 墨西哥: '北美洲',
    巴西: '南美洲', 阿根廷: '南美洲', 智利: '南美洲', 秘鲁: '南美洲',
    澳大利亚: '大洋洲', 新西兰: '大洋洲',
    埃及: '非洲', 南非: '非洲', 摩洛哥: '非洲', 肯尼亚: '非洲',
};

// 国名 → 首都/常见城市（可选，用户没说市就不写）
const COUNTRY_CITIES = {
    德国: ['柏林', '慕尼黑', '汉堡', '法兰克福', '科隆', '斯图加特'],
    日本: ['东京', '大阪', '京都', '北海道', '名古屋', '福冈'],
    法国: ['巴黎', '里昂', '马赛', '尼斯'],
    英国: ['伦敦', '爱丁堡', '曼彻斯特'],
    美国: ['纽约', '洛杉矶', '旧金山', '西雅图', '波士顿', '芝加哥'],
    泰国: ['曼谷', '清迈', '普吉'],
    新加坡: ['新加坡'],
    韩国: ['首尔', '釜山', '济州'],
};

// 指令词 / 干扰词：解析前先剥掉
const NOISE = ['收进画廊', '收进相册', '收进来', '收进', '存进', '存到', '存起来', '存一下',
    '请收', '帮我收', '帮忙收', '画廊', '相册', '照片', '这张', '那张', '一下'];

function stripNoise(text) {
    let s = String(text || '');
    s = s.replace(/@\d+/g, ' ');        // @4 这种
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
    if (/今天|今日/.test(t)) return mk(now.getFullYear(), now.getMonth() + 1, now.getDate(), hour, minute, 'day');
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
    s = s.replace(/今天|今日|昨天|昨日|前天|去年|前年|今年/g, ' ');
    s = s.replace(/\d{2,4}\s*年/g, ' ');          // 只有年份
    s = s.replace(/的?\s*\d{1,2}\s*[日号]/g, ' '); // 残余"的12日"
    s = s.replace(/^的|的$/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
}

// ── 地点解析 ───────────────────────────────────────────────────
// 返回 { branch, path, place } 或 { branch:null }
function parsePlace(text, homeProvince = '广东', inPrompt = false) {
    const t = stripTime(stripNoise(text));
    const hit = (name) => t.includes(name);

    // ① 国名 → 全球/洲/国(/市)
    for (const [country, continent] of Object.entries(COUNTRIES)) {
        if (!hit(country)) continue;
        const cities = COUNTRY_CITIES[country] || [];
        const city = cities.find(hit) || '';
        const parts = [BRANCH.GLOBAL, continent, country];
        if (city) parts.push(city);
        return { branch: 'global', path: parts.join('/'), place: { country, continent, city } };
    }

    // ② 区 → 市（区名只在词典里出现才算，避免"南山"这种误判）
    for (const [districtKey, city] of Object.entries(DISTRICTS)) {
        if (!hit(districtKey)) continue;
        const province = provinceOfCity(city);
        if (!province) continue;
        const d = districtKey.replace(/区$/, '');
        if (province === homeProvince) {
            return { branch: 'local', path: [province, city, d].join('/'), place: { province, city, district: d } };
        }
        return { branch: 'nation', path: [BRANCH.NATION, province, city].join('/'), place: { province, city, district: d } };
    }

    // ③ 市 → 省
    for (const [province, cities] of Object.entries(CITIES)) {
        const city = cities.find(hit);
        if (!city) continue;
        if (province === homeProvince) {
            return { branch: 'local', path: [province, city].join('/'), place: { province, city } };
        }
        return { branch: 'nation', path: [BRANCH.NATION, province, city].join('/'), place: { province, city } };
    }

    // ④ 省
    const province = PROVINCES.find(hit);
    if (province) {
        if (province === homeProvince) return { branch: 'local', path: province, place: { province } };
        return { branch: 'nation', path: [BRANCH.NATION, province].join('/'), place: { province } };
    }

    // ⑤ 剩下来的话当成用户自定义地名：不拒绝，按原话建
    //    但只有带明确指令（收进/存进/画廊/相册）时才敢猜，否则"随便吧"会被当成地名
    const directive = inPrompt || /[收存].{0,3}(进|到|入)|画廊|相册/.test(String(text));
    const guess = directive ? t.replace(/[，,。.、\s]+/g, '').slice(0, 12) : '';
    if (guess.length >= 2) {
        return { branch: 'global', path: [BRANCH.GLOBAL, '未归类', guess].join('/'), place: { unclassified: guess }, guessed: true };
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
