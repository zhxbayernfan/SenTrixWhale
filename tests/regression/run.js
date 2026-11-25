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
const { handle } = require(process.env.HOME + '/SenTrixWhale/bridge/src/bridge.js');

(async () => {
  let pass = 0, fail = 0, known = 0, xpass = 0;
  const fails = [];
  const knownList = [];
  for (const [group, cases] of Object.entries(suite)) {
    if (group.startsWith('_')) continue;
    for (const c of cases) {
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
        if (ok) {
          xpass++;
          console.log(`  XPASS [xfail] ${c.q.slice(0, 26)}  ← 已修复，可以挪回 identity`);
        } else {
          known++;
          knownList.push({ q: c.q, a, why: c._why, miss, bad });
          console.log(`  XFAIL [xfail] ${c.q.slice(0, 26)}  ${miss.length ? '缺:' + miss.join(',') : ''} ${bad.length ? '多:' + bad.join(',') : ''}`);
        }
      } else if (ok) {
        pass++;
        console.log(`  PASS  [${group}] ${c.q.slice(0, 26)}`);
      } else {
        fail++;
        fails.push({ group, q: c.q, a, miss, bad });
        console.log(`  FAIL  [${group}] ${c.q.slice(0, 26)}  ${miss.length ? '缺:' + miss.join(',') : ''} ${bad.length ? '多:' + bad.join(',') : ''}`);
      }
    }
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败 / 已知失败 ${known} / XPASS ${xpass} / 共 ${pass + fail + known + xpass}`);
  fs.writeFileSync(path.join(BASE, 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, known, xpass, fails, knownList }, null, 1));
  process.exit(fail > 0 ? 1 : 0);
})();
