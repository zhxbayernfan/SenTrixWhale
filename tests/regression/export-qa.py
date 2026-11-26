#!/usr/bin/env python3
"""把回归集最近一次结果导成 QA 报告（Markdown）。用法: python3 export-qa.py [112601]"""
import json, sys, os, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
suite = json.load(open(os.path.join(BASE, 'suite.json'), encoding='utf-8'))
run = json.load(open(os.path.join(BASE, 'last-run.json'), encoding='utf-8'))
res = run.get('results', [])

idx = {}
for g, cases in suite.items():
    if g.startswith('_'):
        continue
    for c in cases:
        idx[(g, c['q'], c['who'])] = c

def esc(s):
    return str(s).replace('|', '\\|').replace('\n', ' ').replace('\r', ' ').strip()

tag = sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().strftime('%m%d') + '01'
year = datetime.date.today().year
day = f'{year}-{tag[:2]}-{tag[2:4]}'
out = [f'# QA 回归测试集 · {day}', '',
       f'> tests/regression/suite.json 全量 {len(res)} 条，模拟链路（不连 WS、拦发送），两个号交替。本轮 {run["pass"]}/{len(res)} 通过。', '',
       '| # | 号 | 问题 | 预期 | 回答 | 图 |', '|---|---|---|---|---|---|']
for i, r in enumerate(res, 1):
    c = idx.get((r['group'], r['q'], r['who']), {})
    must, nots = c.get('must') or [], c.get('mustNot') or []
    exp = []
    if must: exp.append('含 ' + ' / '.join(must))
    if nots: exp.append('不含 ' + ' / '.join(nots))
    ans = f'（跳过：缺 {r.get("lack","")}）' if r.get('skip') else r['a']
    out.append(f'| {i} | {esc(r["who"])} | {esc(r["q"])} | {esc("；".join(exp) or "—")} | {esc(ans)} | 0 |')
out += ['', '## 分组']
for g in ['identity', 'photos', 'time', 'safety', 'chat']:
    out.append(f'- {g}: {len([x for x in res if x["group"] == g])} 条')
dest = f'/Users/rm002/Desktop/Docs_Dont_Git/01QA/QA{tag}.md'
open(dest, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('written', dest, len(res), 'rows')
