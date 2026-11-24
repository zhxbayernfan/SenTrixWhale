#!/usr/bin/env node
'use strict';
// tests/sim_qa.js — 模拟 QA：不连 NapCat，也不把消息发到真人 QQ
//
// 两层隔离，缺一不可：
//   1. STW_NO_CONNECT=1  bridge.js 启动时跳过整个 WS 连接，收不到真实消息；
//   2. 拦 fetch           只拦 /send_private_msg 和 /send_group_msg，把消息存进
//                         sent 数组并假装成功。SHW 检索、llama 推理照常走。
//
// 只做第一层是不够的：handle() 内部照样会走 replyTo → NapCat HTTP，
// 消息会真的发到号上（1124 踩过：用 1309459509 跑测试，消息真发出去了）。
//
// 用法：
//   node tests/sim_qa.js "25年4月30日在杭州拍了几张照片"
//   node tests/sim_qa.js --who 1309459509 "问句1" "问句2"
//   node tests/sim_qa.js --file /tmp/cases.json      # [{"q":"...","who":"..."}]
//
// 输出是 JSON 行，每行一条：{q, who, texts, images}
const path = require('path');

process.env.WHALE_HOME = process.env.WHALE_HOME || path.join(__dirname, '..');
process.env.STW_NO_CONNECT = '1';

const sent = [];
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
    const s = String(url);
    if (s.includes('/send_private_msg') || s.includes('/send_group_msg')) {
        let body = null;
        try { body = JSON.parse(opts && opts.body ? opts.body : '{}'); } catch { body = null; }
        sent.push({ url: s, body });
        return new Response(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 1 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    return realFetch(url, opts);
};

const { handle } = require('../bridge/src/bridge.js');

const textOf = (msg) => (msg || []).filter((m) => m.type === 'text').map((m) => m.data.text).join('');
const imageCount = (msg) => (msg || []).filter((m) => m.type === 'image').length;

async function ask(q, who) {
    sent.length = 0;
    await handle(q, who, { kind: 'private', id: who }, []);
    const msgs = sent.map((x) => (x.body && x.body.message) || []);
    return {
        texts: msgs.map(textOf).filter(Boolean),
        images: msgs.reduce((n, m) => n + imageCount(m), 0),
    };
}

async function main() {
    const argv = process.argv.slice(2);
    let who = '999999';
    let cases = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--who') { who = argv[++i]; continue; }
        if (a === '--file') {
            const fs = require('fs');
            cases = JSON.parse(fs.readFileSync(argv[++i], 'utf8')).map((c) =>
                typeof c === 'string' ? { q: c, who } : { q: c.q, who: String(c.who || who) });
            continue;
        }
        cases.push({ q: a, who });
    }
    if (!cases.length) {
        console.error('用法: node tests/sim_qa.js [--who QQ] "问句" ...');
        process.exit(2);
    }
    for (const c of cases) {
        const r = await ask(c.q, c.who);
        console.log(JSON.stringify({ q: c.q, who: c.who, ...r }));
    }
}

main().then(() => process.exit(0)).catch((e) => {
    console.error(e && e.stack || e);
    process.exit(1);
});
