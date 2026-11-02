#!/usr/bin/env node
// SenTrixWhale bridge v0.1 — 工程鲸桥接(零依赖, Node>=22)
// 定位: SHW记忆助手的QQ交互前端 — 对话即记忆输入, 检索即回答, 质检即信任.
//
// 四层: NapCat(QQ) -> bridge(本文件) -> DS API(对话骨架) + SHW检索API(记忆大坝, 阶段1)

const fs = require('fs');
const path = require('path');

// ---------- 路径: 全部相对WHALE_HOME(跨平台口子) ----------
const ROOT = process.env.WHALE_HOME || path.join(__dirname, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const LOG = path.join(ROOT, 'state', 'bridge.log');
fs.mkdirSync(path.join(ROOT, 'state'), { recursive: true });

const log = (s) => {
    const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
    fs.appendFileSync(LOG, `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${s}\n`);
};

// ---------- 护栏: 双计数 + 下沉模式 + 日账单 ----------
const DAILY = path.join(ROOT, 'state', 'daily.json');
let daily = { date: '', calls: 0, cachedIn: 0, plainIn: 0, out: 0, costYuan: 0 };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function loadDaily() {
    try { daily = JSON.parse(fs.readFileSync(DAILY, 'utf8')); } catch (e) { log('[告警] daily读取失败: ' + e.message); }
    if (daily.date !== today()) {
        if (daily.date) log(`[账单] ${daily.date} 调用${daily.calls}次 花费${daily.costYuan.toFixed(4)}元`);
        daily = { date: today(), calls: 0, cachedIn: 0, plainIn: 0, out: 0, costYuan: 0 };
        saveDaily();
    }
}
function saveDaily() { fs.writeFileSync(DAILY, JSON.stringify(daily)); }

function costOf(u) {
    // 粗估(谷价): miss 1元/M, hit 0.02元/M, out 4元/M — 峰谷档位后续config化
    const miss = u.prompt_cache_miss_tokens || u.prompt_tokens || 0;
    const hit = u.prompt_cache_hit_tokens || 0;
    return (miss * 1 + hit * 0.02 + (u.completion_tokens || 0) * 4) / 1e6;
}
const overLimit = () => daily.calls >= cfg.guard.maxCallsPerDay || daily.costYuan >= cfg.guard.dailyLimitYuan;

// ---------- 记忆: memory.json(结构化长期记忆) ----------
const MEM = path.join(ROOT, 'state', 'memory.json');
let mem = {};
try { mem = JSON.parse(fs.readFileSync(MEM, 'utf8')); } catch { mem = {}; }
function saveMem() { const t = MEM + '.tmp'; fs.writeFileSync(t, JSON.stringify(mem, null, 2)); fs.renameSync(t, MEM); }
const memText = () => Object.keys(mem).length ? Object.entries(mem).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n') : '(记忆库还空着)';

// ---------- 质检桩: 记忆写入时自动生成抽查QA(阶段1: 写入, 评测run阶段3) ----------
function genCheckQA(key, value) {
    return { q: `你还记得关于"${key}"的事吗?`, a: value, key, ts: new Date().toISOString() };
}

// ---------- SHW检索桩(阶段1主功能): 对接SHW检索API, 拿回记忆证据 ----------
async function shwSearch(query) {
    if (!cfg.shw || !cfg.shw.enabled) return null;  // 未启用: 走本地记忆
    try {
        const r = await fetch(cfg.shw.apiBase + cfg.shw.retrievalEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, top_k: 5 }),
        });
        if (!r.ok) return null;
        const j = await r.json();
        return j.results || j;  // SHW检索结果(结构按SHW API契约)
    } catch (e) { log('[SHW] 检索失败: ' + e.message); return null; }
}

// ---------- 对话骨架: DS API ----------
const owners = () => (cfg.owners || []).map(String);
const isKnown = (qq) => owners().includes(String(qq)) || (cfg.friends || []).map(String).includes(String(qq));

async function think(userText, who) {
    loadDaily();
    if (overLimit()) {
        log(`[下沉] 调用${daily.calls}次 花费${daily.costYuan.toFixed(4)}元, 超线拒答`);
        return '今天电量不足, 明天再见 🐳';
    }
    // SHW检索优先(记忆大坝): 检索到的证据作为回答依据; 未启用/未命中则落回本地记忆
    const hits = await shwSearch(userText);
    const memBlock = hits
        ? '[SHW记忆检索结果]\n' + JSON.stringify(hits).slice(0, 3000)
        : '[本地记忆]\n' + memText();

    const sys = `你是SenTrixWhale, SHW记忆助手产品的工程鲸。\n${cfg.roleNotes || ''}\n\n${memBlock}\n\n回答规则: 有记忆依据就引用并出示依据; 记忆里没有的, 如实说"记忆里没有, 你可以告诉我"。`;

    const r = await fetch(cfg.ds.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.ds.apiKey },
        body: JSON.stringify({ model: cfg.ds.model, max_tokens: 2048, thinking: { type: 'disabled' }, messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userText },
        ] }),
    });
    if (!r.ok) throw new Error('DS ' + r.status + ': ' + (await r.text()).slice(0, 150));
    const j = await r.json();
    const m = j.choices[0].message;
    if (!(m.content || '').trim()) throw new Error('空content(思考挤占?)');

    loadDaily();
    const u = j.usage || {};
    daily.calls += 1;
    daily.cachedIn += u.prompt_cache_hit_tokens || 0;
    daily.plainIn += u.prompt_cache_miss_tokens || u.prompt_tokens || 0;
    daily.out += u.completion_tokens || 0;
    daily.costYuan += costOf(u);
    saveDaily();
    log(`[对话] 入${u.prompt_tokens || 0}(缓${u.prompt_cache_hit_tokens || 0}) 出${u.completion_tokens || 0} 累计${daily.costYuan.toFixed(4)}元`);

    const reply = (m.content || '').trim();
    if (!reply) throw new Error('空content(思考挤占?)');
    return reply;
}

// ---------- 记忆写入: "记住: key=value" 指令 + 质检QA桩 ----------
function tryMemoryWrite(userText) {
    const m = userText.match(/^记住[:：]\s*(.+?)\s*[=＝]\s*(.+)$/);
    if (!m) return false;
    mem[m[1].trim()] = m[2].trim();
    saveMem();
    const qa = genCheckQA(m[1].trim(), m[2].trim());
    fs.appendFileSync(path.join(ROOT, 'state', 'qa_log.jsonl'), JSON.stringify(qa) + '\n');
    log('[记忆写入] ' + m[1].trim());
    return true;
}

// ---------- NapCat WS ----------
let lastWsData = Date.now();
let ws = null;
function connect() {
    try {
        ws = new WebSocket(cfg.napcat.wsUrl + '?access_token=' + encodeURIComponent(cfg.napcat.accessToken));
    } catch (e) { log('[NapCat] WS构造失败: ' + e.message + ', 5s重试'); setTimeout(connect, 5000); return; }
    ws.onopen = () => { lastWsData = Date.now(); log('[NapCat] WS已连接'); };
    ws.onmessage = (ev) => {
        lastWsData = Date.now();
        try {
            const m = JSON.parse(ev.data);
            if (m.post_type !== 'message') return;
            const text = (m.message || []).filter(p => p.type === 'text').map(p => p.data.text).join('');
            if ((!text.trim()) || !isKnown(m.user_id)) return;
            const dest = m.message_type === 'group' ? { kind: 'group', id: String(m.group_id), atQQ: m.user_id } : { kind: 'private', id: m.user_id };
            const atMe = (m.message || []).some(p => p.type === 'at' && String(p.data.qq) === String(m.self_id));
            if (m.message_type === 'group' && !atMe) return;
            handle(text.trim(), m.user_id, dest);
        } catch (e) { log('[WS解析] ' + e.message); }
    };
    ws.onclose = () => { log('[NapCat] WS断开, 5s重连'); setTimeout(connect, 5000); };
    ws.onerror = () => { log('[NapCat] WS错误'); };
}
// 看门狗: 90s无脉强连
setInterval(() => {
    if (ws && Date.now() - lastWsData > 90000) { try { ws.terminate(); } catch {} }
}, 30000);

// ---------- 主处理 ----------
let lastCall = 0;
async function handle(userText, senderId, dest) {
    if (tryMemoryWrite(userText)) {
        await replyTo(dest, '记住了 🐳 已入库并生成抽查问答。');
        return;
    }
    const gap = (Date.now() - lastCall) / 1000;
    if (gap < (cfg.guard.cooldownSec || 3)) await new Promise(r => setTimeout(r, ((cfg.guard.cooldownSec || 3) - gap) * 1000));
    lastCall = Date.now();
    try {
        const reply = await think(userText, senderId);
        await replyTo(dest, reply);
    } catch (e) {
        log('[错误] ' + e.message);
        await replyTo(dest, '处理出错了, 请稍后再试。');
    }
}
async function replyTo(dest, text) {
    const body = dest.kind === 'group'
        ? { group_id: Number(dest.id), message: [{ type: 'text', data: { text } }] }
        : { user_id: Number(dest.id), message: [{ type: 'text', data: { text } }] };
    const url = dest.kind === 'group' ? '/send_group_msg' : '/send_private_msg';
    const r = await fetch(cfg.napcat.httpUrl + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.napcat.accessToken },
        body: JSON.stringify(body),
    });
    if (!r.ok) log('[发送失败->' + dest.id + '] ' + r.status);
}

log(`[启动] SenTrixWhale bridge | 护栏=${cfg.guard.dailyLimitYuan}元/${cfg.guard.maxCallsPerDay}次 | SHW检索=${cfg.shw && cfg.shw.enabled ? '启用' : '桩'}`);
connect();
