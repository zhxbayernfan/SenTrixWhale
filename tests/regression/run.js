process.env.STW_TEST = '1';
process.env.STW_NO_CONNECT = '1';
process.chdir(process.env.HOME + '/SenTrixWhale');
const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const suite = JSON.parse(fs.readFileSync(path.join(BASE, 'suite.json'), 'utf8'));

const QQ = { zhx: '1303425363', zyn: '1309459509' };
const sent = [];
const realFetch = global.fetch;
global.fetch = async (u, o) => {
  const s = String(u);
  if (s.includes('/send_private_msg') || s.includes('/send_group_msg')) {
    sent.push(JSON.parse(o.body).message.map((m) => m.data.text || '[图]').join(' '));
    return { ok: true, json: async () => ({}) };
  }
  return realFetch(u, o);
};
const { handle, _resetHistory } = require(process.env.HOME + '/SenTrixWhale/bridge/src/bridge.js');

// [资产存在性] 照片会被删/重传，题库里指名道姓的题不该因此变红：
// 跑之前先拉一次 SHW 资产清单，缺图的题标 SKIP（不算通过也不算失败）。
async function loadAssets() {
  try {
    const r = await realFetch('http://127.0.0.1:8191/api/v1/assets?limit=1000', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const j = await r.json();
    const files = new Set(), days = new Set();
    for (const it of (j.items || [])) {
      const a = it.asset || it;
      if (a.file_name) files.add(a.file_name);
      const d = String(a.captured_at || '').slice(0, 10);
      if (d) days.add(d);
    }
    return { files, days };
  } catch (e) { return null; }
}
const missingOf = (c, assets) => {
  if (!assets) return '';
  const lack = [];
  for (const f of (c.need || [])) if (!assets.files.has(f)) lack.push(f);
  if (c.needDay && !assets.days.has(c.needDay)) lack.push(c.needDay);
  return lack.join(',');
};

(async () => {
  let pass = 0, fail = 0, known = 0, xpass = 0, skip = 0;
  const results = [];
  const assets = await loadAssets();
  if (!assets) console.log('  (SHW 未响应，跳过资产检查)');
  const fails = [];
  const knownList = [];
  for (const [group, cases] of Object.entries(suite)) {
    if (group.startsWith('_')) continue;
    // 组内连续（指代题需要前文），组间重置：避免 28 题累积把模型带跑偏
    _resetHistory();
    for (const c of cases) {
      const _lack = missingOf(c, assets);
      if (_lack) {
        skip++;
        console.log(`  SKIP  [${group}] ${c.q.slice(0, 26)}  (缺 ${_lack})`);
        results.push({ group, who: c.who, q: c.q, a: '', ok: false, skip: true, lack: _lack });
        continue;
      }
      const who = QQ[c.who] || c.who;
      sent.length = 0;
      try { await handle(c.q, who, { kind: 'private', id: who }, []); } catch (e) { sent.push('[异常]' + e.message); }
      const a = sent.join(' ').replace(/\n/g, ' ');
      // must 是"任一命中即可"——同一件事常有多种说法，卡"全部"会误判
      const miss = (c.must || []).length && !(c.must || []).some((k) => a.includes(k))
        ? ['(一个都没命中:' + (c.must || []).join('/') + ')'] : [];
      const bad = (c.mustNot || []).filter((k) => a.includes(k));
      const ok = miss.length === 0 && bad.length === 0;
      if (group === 'xfail') {
        // 已知失败：不算通过率，但挂出来看得见；一旦跑过就提示可以摘帽
        results.push({ group, who: c.who, q: c.q, a, ok, xfail: true });
        if (ok) {
          xpass++;
          console.log(`  XPASS [xfail] ${c.q.slice(0, 26)}  ← 已修复，可以挪回 identity`);
        } else {
          known++;
          knownList.push({ q: c.q, a, why: c._why, miss, bad });
          console.log(`  XFAIL [xfail] ${c.q.slice(0, 26)}  ${miss.length ? '缺:' + miss.join(',') : ''} ${bad.length ? '多:' + bad.join(',') : ''}`);
        }
      } else if (ok) {
        results.push({ group, who: c.who, q: c.q, a, ok: true });
        pass++;
        console.log(`  PASS  [${group}] ${c.q.slice(0, 26)}`);
      } else {
        results.push({ group, who: c.who, q: c.q, a, ok: false, miss, bad });
        fail++;
        fails.push({ group, q: c.q, a, miss, bad });
        console.log(`  FAIL  [${group}] ${c.q.slice(0, 26)}  ${miss.length ? '缺:' + miss.join(',') : ''} ${bad.length ? '多:' + bad.join(',') : ''}`);
      }
    }
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败 / 已知失败 ${known} / XPASS ${xpass} / 跳过 ${skip} / 共 ${pass + fail + known + xpass + skip}`);
  fs.writeFileSync(path.join(BASE, 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, known, xpass, skip, fails, knownList, results }, null, 1));
  process.exit(fail > 0 ? 1 : 0);
})();
