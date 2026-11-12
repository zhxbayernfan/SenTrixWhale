// tests/album_resolver.cases.js — 相册/时间解析的用例集
// 直接跑：node tests/album_resolver.cases.js
const { resolve } = require('../media/album_resolver');

// 固定"今天"，否则相对时间的用例每天都在变
const NOW = new Date(2026, 10, 12, 10, 0, 0); // 2026-11-12 10:00

const cases = [
    // 时间：各种写法
    ['20230429', { path: null, when: '2023-04-29 12:00', precision: 'day' }],
    ['230429', { path: null, when: '2023-04-29 12:00', precision: 'day' }],
    ['2023-04-29', { path: null, when: '2023-04-29 12:00', precision: 'day' }],
    ['2023/4/29', { path: null, when: '2023-04-29 12:00', precision: 'day' }],
    ['2023年4月29日', { path: null, when: '2023-04-29 12:00', precision: 'day' }],
    ['23年4月29日', { path: null, when: '2023-04-29 12:00', precision: 'day' }],
    ['去年3月15日', { path: null, when: '2025-03-15 12:00', precision: 'day' }],
    ['前年12月1日', { path: null, when: '2024-12-01 12:00', precision: 'day' }],
    ['3年前 5月20日', { path: null, when: '2023-05-20 12:00', precision: 'day' }],
    ['5个月前的12日', { path: null, when: '2026-06-12 12:00', precision: 'day' }],
    ['10天前', { path: null, when: '2026-11-02 12:00', precision: 'day' }],
    ['昨天', { path: null, when: '2026-11-11 12:00', precision: 'day' }],
    ['2023年4月', { path: null, when: '2023-04-01 12:00', precision: 'month' }],
    ['2023年', { path: null, when: '2023-01-01 12:00', precision: 'year' }],
    ['4月29日', { path: null, when: '2026-04-29 12:00', precision: 'day' }],
    ['2023年4月29日 16:50', { path: null, when: '2023-04-29 16:50', precision: 'day' }],
    ['2023年4月29日 23点04分', { path: null, when: '2023-04-29 23:04', precision: 'day' }],

    // 地点
    ['深圳', { path: '广东/深圳' }],
    ['南山', { path: '广东/深圳/南山' }],
    ['深圳南山区', { path: '广东/深圳/南山' }],
    ['西安', { path: '全国/陕西/西安' }],
    ['厦门', { path: '全国/福建/厦门' }],
    ['杭州西湖', { path: '全国/浙江/杭州' }],
    ['德国', { path: '全球/欧洲/德国' }],
    ['德国柏林', { path: '全球/欧洲/德国/柏林' }],
    ['日本东京', { path: '全球/亚洲/日本/东京' }],
    ['波尔图', { path: null }],   // 没有指令词时不当地名
    ['收进 波尔图', { path: '全球/未归类/波尔图' }],

    // 组合
    ['深圳南山 2023年4月29日', { path: '广东/深圳/南山', when: '2023-04-29 12:00' }],
    ['收进画廊 2017年2月4日 23点04分', { path: null, when: '2017-02-04 23:04', missing: ['place'] }],
    ['收进相册 广东 2023年4月29日 16点50分', { path: '广东', when: '2023-04-29 16:50' }],
    ['东莞 去年 3月15日', { path: '广东/东莞', when: '2025-03-15 12:00' }],
    ['这是啥', { path: null, missing: ['place', 'date'] }],
    ['波尔图 2023年5月1日', { path: '全球/未归类/波尔图' }, { inPrompt: true }],
];

const fmt = (d) => {
    if (!d) return '—';
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

let pass = 0, fail = 0;
const rows = [];
for (const [input, exp, opts] of cases) {
    const r = resolve(input, { now: NOW, homeProvince: '广东', ...(opts || {}) });
    const got = { path: r.path, when: fmt(r.when), precision: r.precision, missing: r.missing.join(',') || '—' };
    const okPath = exp.path === undefined || exp.path === got.path;
    const okWhen = exp.when === undefined || exp.when === got.when;
    const okPrec = exp.precision === undefined || exp.precision === got.precision;
    const okMiss = exp.missing === undefined || exp.missing.join(',') === got.missing;
    const ok = okPath && okWhen && okPrec && okMiss;
    ok ? pass++ : fail++;
    rows.push({ input, ok, got, exp });
}

for (const r of rows) {
    const mark = r.ok ? '✓' : '✗';
    console.log(`${mark} ${r.input.padEnd(34)} → ${String(r.got.path).padEnd(20)} ${String(r.got.when).padEnd(17)} ${r.got.precision || '-'}${r.got.missing !== '—' ? '  缺:' + r.got.missing : ''}`);
    if (!r.ok) console.log(`    期望: path=${r.exp.path} when=${r.exp.when} precision=${r.exp.precision}`);
}
console.log(`\n${pass} 通过 / ${fail} 失败 / 共 ${cases.length}`);
process.exit(fail ? 1 : 0);
