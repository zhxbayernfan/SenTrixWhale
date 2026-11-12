#!/usr/bin/env node
const { matchSticker, resolveSticker, takeRoundTicket, resetStickerRound } = require('../stickers_bridge.js');
const { savePhoto, checkFixedLocation } = require('../../media/photo_manager');
const { ingestPhoto } = require('../../media/shw_ingest'); // [存图] 归档+补EXIF+入SHW
const { resolve: resolveAlbum } = require('../../media/album_resolver'); // [存图] 一句话→相册路径+时间
// SenTrixWhale bridge v0.1 — 工程鲸桥接(零依赖, Node>=22)
// 定位: SHW记忆助手的QQ交互前端 — 对话即记忆输入, 检索即回答, 质检即信任.
//
// 四层: NapCat(QQ) -> bridge(本文件) -> DS API(对话骨架) + SHW检索API(记忆大坝, 阶段1)

const fs = require('fs');
// [FIX-1] think() 的 usage 原来是局部变量, handle() 里 logChat(..., u) 会 ReferenceError
let lastUsage = null;

// 日志记录函数
function logChat(who, userText, reply, usage) {
    try {
        const CL = path.join(ROOT, 'state', 'chat_log_sentrix.jsonl');
        const d = new Date();
        const p2t = (x) => String(x).padStart(2, '0');
        const ts = d.getFullYear() + '-' + p2t(d.getMonth() + 1) + '-' + p2t(d.getDate()) + ' ' + p2t(d.getHours()) + ':' + p2t(d.getMinutes()) + ':' + p2t(d.getSeconds());
        const record = {
            event: 'chat',
            who: who,
            dest: 'private',
            ts: ts,
            in: userText,
            out: reply,
            usage: usage || {},
            cost: 0
        };
        fs.appendFileSync(CL, JSON.stringify(record) + '\n');
    } catch (e) {
        log('[logChat错误] ' + e.message);
    }
}

// 身份识别字典（借鉴家人鲸WHO_NOTE思路）
const WHO_NOTE = {
    '1303425363': { name: 'zhx1', role: '哥哥' },
    '1309459509': { name: 'zhx2', role: '弟弟' }
};

function getWhoNote(qq) {
    return WHO_NOTE[qq] || { name: '新朋友', role: '朋友' };
}

// 全局异常处理，防止bridge崩溃退出
process.on('uncaughtException', (e) => {
    try { log('[uncaughtException] ' + (e.stack || e.message)); } catch {}
});
process.on('unhandledRejection', (e) => {
    try { log('[unhandledRejection] ' + ((e && e.stack) || String(e))); } catch {}
});
const path = require('path');

// ---------- 路径: 全部相对WHALE_HOME(跨平台口子) ----------
const ROOT = process.env.WHALE_HOME || path.join(__dirname, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const LOG = path.join(ROOT, 'state', 'bridge.log');
fs.mkdirSync(path.join(ROOT, 'state'), { recursive: true });

// 进程级兜底: 未捕获异常只记日志不退出
process.on('uncaughtException', (e) => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' [uncaught] ' + (e.stack || e.message) + '\n'); } catch {} });
process.on('unhandledRejection', (e) => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' [unhandledRejection] ' + ((e && e.stack) || String(e)) + '\n'); } catch {} });

const log = (s) => {
    const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
    fs.appendFileSync(LOG, `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${s}\n`);
};

// ---------- 护栏: 双计数 + 下沉模式 + 日账单 ----------
const DAILY = path.join(ROOT, 'state', 'daily.json');
let daily = { date: '', calls: 0, cachedIn: 0, plainIn: 0, out: 0, costYuan: 0 };

// 照片等待状态
let pendingPhoto = null; // {url, senderId, round: 0, maxRounds: 3}
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
    // 本地模型(apiKey为空)免费，云端模型按DS费率计费
    if (!cfg.ds.apiKey) return 0;  // 本地qwen3.5，零成本
    // 粗估(谷价): miss 1元/M, hit 0.02元/M, out 4元/M
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

const chatHist={};function getHist(w){return(chatHist[w]||[]).slice(-10)}function addHist(w,u,r){if(!chatHist[w])chatHist[w]=[];chatHist[w].push({role:'user',content:u},{role:'assistant',content:r})}
let shwStats={total:0};async function fetchSHWStats(){if(!cfg.shw||!cfg.shw.enabled)return;try{const d=await(await fetch(cfg.shw.apiBase+'/api/v1/assets?limit=1000',{signal:AbortSignal.timeout(20000)})).json();shwStats.total=(d.items||[]).length;if(d.has_more){const d2=await(await fetch(cfg.shw.apiBase+'/api/v1/assets?limit=1000&offset=1000',{signal:AbortSignal.timeout(20000)})).json();shwStats.total+=(d2.items||[]).length}log('[SHW统计] '+shwStats.total)}catch(e){log('[SHW统计] 失败')}}
function familySum(){try{const CL=path.join(ROOT,'state','chat_log_sentrix.jsonl');if(!fs.existsSync(CL))return'';const byU={};fs.readFileSync(CL,'utf8').trim().split('\n').filter(l=>l.startsWith('{')).slice(-20).forEach(l=>{try{const d=JSON.parse(l),q=String(d.who||'');if(!byU[q])byU[q]=[];if(d.in)byU[q].push(d.in.slice(0,30))}catch(e){}});return Object.entries(byU).map(([q,m])=>{const k=Object.entries(mem).find(([kk])=>kk===q);return'- '+(k?k[0]:q)+': '+m.join('; ')}).join('\n')}catch(e){return''}}


// ---------- 对话历史(最近5轮) ----------
const chatHistory = {};
const MAX_HISTORY = 5;
function getHistory(who) {
    // [FIX-12] 原来直接返回空数组"避免混淆"，结果每轮都是失忆的：
    // 多聊几句就接不上，两个号更是分不清。按 QQ 号隔离 + 截断，才是正确做法。
    const h = chatHistory[who] || [];
    return h.slice(-6).map((m) => ({
        role: m.role,
        content: String(m.content || '').slice(0, 150),
    }));
}
function addHistory(who, userText, reply) {
    if (!chatHistory[who]) chatHistory[who] = [];
    chatHistory[who].push({ role: 'user', content: userText });
    chatHistory[who].push({ role: 'assistant', content: reply });
}

const memText = () => Object.keys(mem).length ? Object.entries(mem).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n') : '(记忆库还空着)';
// ---------- 全家对话摘要(最近3条/人) ----------
function familyChatSummary() {
    try {
        const CL = path.join(ROOT, 'state', 'chat_log_sentrix.jsonl');
        if (!fs.existsSync(CL)) return '';
        const lines = fs.readFileSync(CL, 'utf8').trim().split('\n').filter(l => l.trim());
        const byUser = {};
        lines.slice(-50).forEach(l => {
            try {
                const d = JSON.parse(l);
                const who = d.who || 'unknown';
                if (!byUser[who]) byUser[who] = [];
                const safeOut = (d.out || '').substring(0, 50); byUser[who].push({ in: d.in, out: safeOut });
            } catch {}
        });
        return Object.entries(byUser).map(([qq, msgs]) => {
            const known = Object.entries(mem).find(([k, v]) => String(v).includes(qq));
            const name = known ? known[0] : `QQ:${qq}`;
            const last = msgs.slice(-2).map(m => `"${m.in}" → "${m.out}"`).join('; ');
            return `- ${name}: ${last}`;
        }).join('\n');
    } catch { return ''; }
}


// ---------- 质检桩: 记忆写入时自动生成抽查QA(阶段1: 写入, 评测run阶段3) ----------
function genCheckQA(key, value) {
    return { q: `你还记得关于"${key}"的事吗?`, a: value, key, ts: new Date().toISOString() };
}

// ---------- SHW检索桩(阶段1主功能): 对接SHW检索API, 拿回记忆证据 ----------
function timeRangeOf(q) {  // [FIX-7] 时间词 -> SHW 的 time_range + 本地校验区间
    const d = new Date();
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const iso = (a) => a.toISOString().slice(0, 10);
    const mk = (yy, mm) => {
        const a = new Date(Date.UTC(yy, mm - 1, 1));
        const b = new Date(Date.UTC(yy, mm, 1));
        return { label: `${yy}年${mm}月`, from: iso(a), to: iso(new Date(b - 864e5)) };
    };
    if (/去年/.test(q)) return { label: `${y - 1}年`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    if (/今年/.test(q)) return { label: `${y}年`, from: `${y}-01-01`, to: `${y}-12-31` };
    if (/上个月/.test(q)) return mk(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1);
    if (/上周|上星期|这几天|最近/.test(q)) { const t = new Date(Date.now() - 7 * 864e5); return mk(t.getFullYear(), t.getMonth() + 1); }
    const ym = q.match(/(\d{4})年(\d{1,2})?月?/);
    if (ym) return ym[2] ? mk(Number(ym[1]), Number(ym[2])) : { label: `${ym[1]}年`, from: `${ym[1]}-01-01`, to: `${ym[1]}-12-31` };
    return null;
}

// [FIX-10] 事件/摘要才是能开口说话的"记忆"; 向量检索只给文件名, 说不了事
let tlCache = { at: 0, days: [] };
async function timelineDays() {
    if (tlCache.days.length && Date.now() - tlCache.at < 10 * 60 * 1000) return tlCache.days;
    try {
        const byDate = {};
        let total = Infinity;
        for (let off = 0; off < 600 && Object.keys(byDate).length < total; off += 200) {
            const r = await fetch(cfg.shw.apiBase + '/api/v1/timeline?limit=200&offset=' + off, { signal: AbortSignal.timeout(20000) });
            if (!r.ok) break;
            const j = await r.json();
            total = j.total || 0;
            const days = j.days || [];
            if (!days.length) break;
            for (const d of days) byDate[d.date] = d;
        }
        const days = Object.entries(byDate).map(([k, v]) => v).sort((a, b) => (a.date < b.date ? 1 : -1));
        tlCache = { at: Date.now(), days };
        log('[SHW] 时间线缓存 ' + days.length + ' 天 / total ' + total);
    } catch (e) { log('[SHW] 时间线失败: ' + e.message); }
    return tlCache.days;
}

async function eventsInRange(from, to) {
    const days = await timelineDays();
    const out = [];
    for (const d of days) {
        if (d.date < from || d.date > to) continue;
        for (const e of (d.events || [])) {
            const sum = String(e.summary || '').replace(/\s+/g, ' ').trim();
            if (!sum) continue;
            out.push({ date: d.date, place: String(e.place || '').slice(-12), summary: sum.slice(0, 90) });
        }
    }
    return out.slice(0, 3);
}

async function shwSearch(query) {
    if (!cfg.shw || !cfg.shw.enabled) return null;  // 未启用: 走本地记忆
    try {
        const tr = timeRangeOf(query);
        // [FIX-9] SHW 的 time_range 过滤在本机会抛 "naive/aware datetime" 错, metadata 通道降级,
        // 于是它仍会把 2023 年的照片当"上周"返回. 这里不信任服务端过滤, 取回后本地按日期硬筛.
        const _u = cfg.shw.apiBase + cfg.shw.retrievalEndpoint + '?q=' + encodeURIComponent(query) + '&top_k=10'
            + (tr ? '&time_range=' + encodeURIComponent(tr.label) : '');
        const r = await fetch(_u, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) { log('[SHW] HTTP ' + r.status); return null; }
        const j = await r.json();
        const seen = new Set();
        const items = (j.items || []).filter(it => {   // [FIX-6] 同一张图会返回多条, 按文件名去重
            const a = it.asset || {};
            if (!a.file_name || seen.has(a.file_name)) return false;
            if (tr) {                                  // [FIX-9] 只留落在时间区间内的
                const day = String(a.captured_at || '').slice(0, 10);
                if (!day || day < tr.from || day > tr.to) return false;
            }
            seen.add(a.file_name); return true;
        }).slice(0, 5).map(it => ({
            file: it.asset.file_name,
            time: it.asset.captured_at,
            type: it.asset.media_type,
        }));
        log(`[SHW] q="${query}"${tr ? ' 区间=' + tr.from + '~' + tr.to : ''} 原始${(j.items || []).length}条 去重/筛选后${items.length}条`);
        const events = tr ? await eventsInRange(tr.from, tr.to) : [];
        return { count: items.length, items, events };
    } catch (e) { log('[SHW] 检索失败: ' + e.message); return null; }
}

// ---------- 角色卡加载 ----------
const roleText = () => {
    try { return fs.readFileSync(path.join(ROOT, cfg.paths.roleCard), 'utf8'); }
    catch { return '你是SenTrixWhale,一条有记忆的鲸鱼。'; }
};

// ---------- 对话骨架: DS API ----------

// ---------- 工程鲸chatLog(调试工具,可随意清空) ----------
const CL = path.join(ROOT, 'state', 'chat_log_sentrix.jsonl');
const chatLog = (obj) => {
    const d = new Date(); const p2 = (x) => String(x).padStart(2, '0');
    const ordered = {
        event: obj.event,
        who: obj.who,
        dest: obj.dest,
        ts: d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()),
        in: obj.in,
        out: obj.out,
    };
    if (obj.usage) { ordered.usage = obj.usage; ordered.cost = obj.cost; }
    if (obj.error) ordered.error = obj.error;
    fs.appendFileSync(CL, JSON.stringify(ordered) + '\n');
};

const owners = () => (cfg.owners || []).map(String);
const isKnown = (qq) => owners().includes(String(qq)) || (cfg.friends || []).map(String).includes(String(qq));

function filterSurrogates(str) {
    if (!str) return '';
    // 移除所有surrogate字符和emoji
    return str.replace(/[\ud800-\udfff]/g, '')
              .replace(/[^\u0000-\u007F\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '');
}

async function think(userText, who) {
    log('[think] 开始处理: ' + userText.slice(0,30) + ' from: ' + who);
    loadDaily();
    // 过滤输入中的surrogate字符
    userText = filterSurrogates(userText);
    log('[think] 护栏检查: calls=' + daily.calls + ' cost=' + daily.costYuan);
    if (overLimit()) {
        log(`[下沉] 调用${daily.calls}次 花费${daily.costYuan.toFixed(4)}元, 超线拒答`);
        return '今天电量不足, 明天再见 ';
    }
    // SHW检索优先(记忆大坝): 检索到的证据作为回答依据; 未启用/未命中则落回本地记忆
    const hits = await shwSearch(userText);
    const famSum = familyChatSummary();
    // 添加照片统计信息到系统提示
    const photoData = mem['照片总数'] ? '\n 照片统计：' + mem['照片总数'] + '\n 地点：' + (mem['照片地点']||'') + '\n 时间：' + (mem['照片时间范围']||'') : '';
    const identityNote = memText() ? '\n以下是你认识的家庭成员信息：' + photoData + '\n' + memText() : '';
    const chatNote = famSum ? `\n最近大家聊过：\n${famSum}` : '';
    let memBlock;
    if (hits && hits.count > 0) {
        // [FIX-4] 原来 memBlock 算完就扔了, 模型根本看不到检索结果
        const times = hits.items.map(x => x && x.time).filter(Boolean).sort();
        const span = times.length ? `，照片时间 ${times[0]} 到 ${times[times.length - 1]}` : '';
        const lines = (hits.events || []).map(e => `- ${e.date} ${e.place}：${e.summary}`).join('\n');
        memBlock = `【记忆证据】${lines ? '这几天你自己记下的事：\n' + lines + '\n' : ''}命中 ${hits.count} 条照片${span}。只用上面这些事实回答，可以说"我记得"，不许补充证据之外的人名、地点、情节。`;
    } else {
        // [FIX-8] 检索为空时必须直说没存到, 不许拿"温馨瞬间"之类的空话糊弄
        // [FIX-11] 模型不知道今天几号, 会把"没检索到"解释成"还没到", 必须把日期和话术都钉死
        const _now = new Date();
        const _today = `${_now.getFullYear()}年${_now.getMonth() + 1}月${_now.getDate()}日`;
        memBlock = `【今天是 ${_today}】这一问检索到 0 条记录。你必须如实说"这个我没存到/没找到"，`
            + '绝对不要编造照片内容、地点或时间，也不要猜"还没到""还没拍""以后再说"这类理由——'
            + '库里有就是有，没有就是没存到。'
            + (memText() ? `\n你确实认识的家里人：\n${memText()}` : '');
    }

    const _d = new Date();
    const _who = getWhoNote(who);
    let sys = `今天是 ${_d.getFullYear()}年${_d.getMonth() + 1}月${_d.getDate()}日。\n` + roleText() + identityNote + chatNote + '\n\n' + memBlock
        + '\n\n回答规则: 像老朋友聊天——轻松、自然、简短。记得的事情就说"我记得/好像有印象"，不记得就老实说"这个我好像没存"。不报数字、不甩文件名、不列清单、不说"检索到"。';
    // [FIX-13] 说话人挪到最末尾：4B 模型对开头注意力弱，放远会被角色卡冲掉；
    // 并且明确写死"你不是他"，否则它会把对方的名字当自己的
    sys += `\n\n【本轮】现在是 ${_who.name}（QQ ${who}）在跟你说话，你要叫他"${_who.role}"。`
        + `\n你是工程鲸，不是 ${_who.name}，也不是家里任何一个人。`
        + `\n他要是问"我是谁"，直接答"你是${_who.role}"，别绕、别说"你${_who.role}记忆里的一条鲸"这种怪话。`;
    sys = filterSurrogates(sys);

    const _bodyStr = JSON.stringify({ model: cfg.ds.model, max_tokens: 2048, thinking: { type: 'disabled' }, reasoning: false, messages: [
            { role: 'user', content: sys + '\n\n---\n\n' + userText },
        ] });
    log('[DBG] bodyLen:'+_bodyStr.length+' sysLen:'+sys.length);
    try{require('fs').writeFileSync('/tmp/llama_body.json',_bodyStr)}catch(e){}
    // 再次确保所有message content都清理过
    const cleanHistory = getHistory(who).map(h => ({
        role: h.role,
        content: filterSurrogates(h.content)
    }));
    
    const _fetchBody = JSON.stringify({ 
        model: cfg.ds.model, 
        max_tokens: 2048, 
        thinking: { type: 'disabled' },
        reasoning: false,
        messages: [
            { role: 'system', content: filterSurrogates(sys) },
            ...cleanHistory,
            { role: 'user', content: filterSurrogates(userText) },
        ] 
    });
    try{require('fs').writeFileSync('/tmp/actual_fetch_body.json', _fetchBody)}catch(e){}
    log('[FETCH] bodyLen:'+_fetchBody.length+' histLen:'+getHistory(who).length+' histJSON:'+JSON.stringify(getHistory(who)).slice(0,200));
    log('[think] 准备调用llama: ' + cfg.ds.baseUrl + '/chat/completions');
    const r = await fetch(cfg.ds.baseUrl + '/chat/completions', {
        signal: AbortSignal.timeout(90000), // 模型请求最多 90 秒，避免 event loop 被挂住
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.ds.apiKey },
        body: _fetchBody.replace('"messages"', '"chat_template_kwargs":{"enable_thinking":false},"messages"'), // [FIX-5]
    });
    log('[think] llama响应状态: ' + r.status);
    if (!r.ok) {
        const errText = await r.text();
        log('[think] llama错误: ' + errText.slice(0,200));
        throw new Error('DS ' + r.status + ': ' + errText.slice(0, 150));
    }
    const j = await r.json();
    const m = j.choices[0].message;
    if (!(m.content || '').trim()) throw new Error('空content(思考挤占?)');

    loadDaily();
    // 过滤输入中的surrogate字符
    userText = filterSurrogates(userText);
    const u = j.usage || {};
    lastUsage = u; // [FIX-1]
    daily.calls += 1;
    daily.cachedIn += u.prompt_cache_hit_tokens || 0;
    daily.plainIn += u.prompt_cache_miss_tokens || u.prompt_tokens || 0;
    daily.out += u.completion_tokens || 0;
    daily.costYuan += costOf(u);
    saveDaily();
    log(`[对话] 入${u.prompt_tokens || 0}(缓${u.prompt_cache_hit_tokens || 0}) 出${u.completion_tokens || 0} 累计${daily.costYuan.toFixed(4)}元`);

    let reply = (m.content || '').trim();
    // 过滤emoji
    reply = reply.replace(/[\ud800-\udfff]/g, '');
    if (!reply) throw new Error('空content(思考挤占?)');

    // 记录对话到chatLog
    chatLog({ event: 'chat', who: who, dest: 'private', in: userText, out: reply, usage: u, cost: costOf(u) });
    
    // 持久化memory.json（每次对话后保存）
    try {
        fs.writeFileSync(MEM + '.tmp', JSON.stringify(mem, null, 2));
        fs.renameSync(MEM + '.tmp', MEM);
    } catch (e) {
        log('[记忆保存失败] ' + e.message);
    }

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

// ---------- 照片计数功能（实时读取目录） ----------
async function countPhotos() {
    try {
        const photoDir = path.join(ROOT, 'media', 'photos');
        if (fs.existsSync(photoDir)) {
            const allPhotos = fs.readdirSync(photoDir).filter(f => f.endsWith('.jpg'));
            const newPhotos = allPhotos.filter(f => f.startsWith('photo_'));
            const framePhotos = allPhotos.filter(f => f.startsWith('frame'));
            return { total: allPhotos.length, new: newPhotos.length, frames: framePhotos.length };
        }
        return { total: 0, new: 0, frames: 0 };
    } catch (e) {
        log('[countPhotos错误] ' + e.message);
        return { total: 0, new: 0, frames: 0 };
    }
}

// ---------- NapCat WS ----------
let lastWsData = Date.now();
// 消息去重
const processedMessages = new Set();
const MAX_PROCESSED = 100;
let ws = null;
function connect() {
    try {
        ws = new WebSocket(cfg.napcat.wsUrl + '?access_token=' + encodeURIComponent(cfg.napcat.accessToken));
    } catch (e) { log('[NapCat] WS构造失败: ' + e.message + ', 5s重试'); setTimeout(connect, 5000); return; }
    ws.onopen = () => { lastWsData = Date.now(); log('[NapCat] WS已连接'); };
    ws.onmessage = (ev) => {
        lastWsData = Date.now();
        log('[WS] 收到原始消息: ' + ev.data.toString().slice(0,100));
        try {
            const m = JSON.parse(ev.data);
            log('[WS] 解析后: post_type=' + m.post_type + ' user_id=' + m.user_id);
            if (m.post_type !== 'message') return;
            const text = (m.message || []).filter(p => p.type === 'text').map(p => p.data.text).join('');
            const imgs = (m.message || []).filter(p => p.type === 'image').map(p => p.data).slice(0, 3);
            // 允许纯图片消息通过
            if ((!text.trim() && imgs.length === 0) || !isKnown(m.user_id)) return;
            const dest = m.message_type === 'group' ? { kind: 'group', id: String(m.group_id), atQQ: m.user_id } : { kind: 'private', id: m.user_id };
            const atMe = (m.message || []).some(p => p.type === 'at' && String(p.data.qq) === String(m.self_id));
            if (m.message_type === 'group' && !atMe) return;
            // 消息去重
            const msgKey = m.message_id || m.time;
            if (processedMessages.has(msgKey)) {
                log('[WS] 跳过重复消息: ' + msgKey);
                return;
            }
            processedMessages.add(msgKey);
            if (processedMessages.size > MAX_PROCESSED) {
                const firstKey = processedMessages.values().next().value;
                processedMessages.delete(firstKey);
            }
            
            log('[WS] 准备调用handle: text=' + text.trim().slice(0,30) + ' user=' + m.user_id + ' imgs=' + imgs.length);
            handle(text.trim(), m.user_id, dest, imgs).catch(e => log('[handle错误] ' + e.message));
        } catch (e) { log('[WS解析] ' + e.message); }
    };
    ws.onclose = () => { log('[NapCat] WS断开, 5s重连'); setTimeout(connect, 5000); };
    ws.onerror = () => { log('[NapCat] WS错误'); };
}
// 看门狗: 90s无脉强连
setInterval(() => {
    if (ws && Date.now() - lastWsData > 45000) { try { ws.close(); } catch {} }
}, 30000);

// [存图] 从一句话里认相册名：广东 / 广东相册 / 收进浙江
const ALBUM_WORDS = ['广东','浙江','江苏','福建','山东','河南','河北','湖南','湖北','四川','云南',
    '广西','陕西','山西','江西','安徽','辽宁','吉林','黑龙江','内蒙古','甘肃','青海','宁夏',
    '新疆','西藏','海南','贵州','北京','上海','天津','重庆','香港','澳门','台湾',
    '杭州','深圳','广州','西安','济南','南京','成都','武汉','苏州','长沙','郑州','沈阳',
    '大连','青岛','宁波','厦门','石家庄','邯郸','宿州','惠州'];
function parseAlbum(text) {
    const m = String(text).match(/([\u4e00-\u9fa5]{1,6})相册/);
    if (m) return m[1];
    for (const w of ALBUM_WORDS) if (String(text).includes(w)) return w;
    return '';
}

// ---------- 主处理 ----------
let lastCall = 0;
async function handle(userText, senderId, dest, imgs) {
    // 身份识别：使用WHO_NOTE字典
    const currentUserQQ = String(senderId);
    const whoInfo = getWhoNote(currentUserQQ);
    const currentUserName = whoInfo.name;
    const userRole = whoInfo.role;
    // 处理照片计数查询
    if (userText.includes('几张') || userText.includes('多少张') || userText.includes('照片数量')) {
        const count = await countPhotos();
        if (count !== null) {
            const reply = '记忆库里现在有' + count.total + '张照片呢～'; // [FIX-2]
            // 记录chatLog
            chatLog({ event: 'chat', who: senderId, dest: dest.kind, in: userText, out: reply });
            logChat(senderId, userText, reply, lastUsage);
        await replyTo(dest, reply, userText);
            return;
        }
    }
    // 入库并回话（带字直存 / 追问后存 共用）
    async function doIngest(buf, parsed, dest, said) {
        try {
            const r = await ingestPhoto(buf, {
                album: parsed.path,
                when: parsed.when,
                precision: parsed.precision,
                said,
                place: parsed.place,
                scopeId: parsed.path,
                shwBase: (cfg.shw && cfg.shw.apiBase) || 'http://127.0.0.1:8191',
            });
            if (r.ok) {
                log('[存图] ' + r.relFile + ' -> ' + r.assetId + ' (' + parsed.precision + ')');
                const day = r.when.slice(0, 10).replace(/:/g, '-');
                const tail = parsed.precision === 'day' ? day
                    : parsed.precision === 'month' ? `${day.slice(0, 7)}（只到月份）`
                        : `${day.slice(0, 4)} 年（只到年份）`;
                await replyTo(dest,
                    `收好了 🐳 收进《${parsed.path}》，记作 ${tail}。${r.dedup ? '（这张之前收过，没重复占地方）' : ''}`,
                    said);
            } else {
                await replyTo(dest, '存的时候出了岔子：' + String(r.error).slice(0, 60), said);
            }
        } catch (e) {
            log('[存图] 出错: ' + e.message);
            await replyTo(dest, '存图出错了，再试一次？', said);
        }
    }

    // ── 存图：发图 → 说相册+日期 → 归档并入库 SHW ──────────────────
    if (imgs && imgs.length > 0) {
        const imgUrl = imgs[0].url || imgs[0].file || '';
        if (imgUrl && !imgUrl.includes('sticker')) {
            log('[存图] 收到照片');
            try {
                const r = await fetch(imgUrl, { signal: AbortSignal.timeout(20000) });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const buf = Buffer.from(await r.arrayBuffer());

                // [带字直存] 图和话在同一条消息里，能解析就直接收，不追问
                const parsedNow = resolveAlbum(userText || '', {
                    homeProvince: (cfg.album && cfg.album.homeProvince) || '广东',
                });
                if (userText && userText.trim() && parsedNow.ok) {
                    await doIngest(buf, parsedNow, dest, userText);
                    return;
                }

                pendingPhoto = { buf, senderId, dest, round: 0, maxRounds: 3, said: (userText || '').trim() };
                if (userText && userText.trim() && parsedNow.missing.length === 1) {
                    // 说了一半（只缺一样），点名追问，别让他重说
                    const miss = parsedNow.missing.includes('place') ? '相册名' : '日期';
                    const hint = parsedNow.missing.includes('place') ? '「深圳南山」' : '「2023年4月29日」';
                    await replyTo(dest, `图收到～ 还差${miss}，比如 ${hint}`, userText);
                } else {
                    await replyTo(dest, '收到图了～ 想收进哪本相册、记成哪天？说「深圳南山 2023年4月29日」这样就行。', userText);
                }
            } catch (e) {
                log('[存图] 下载失败: ' + e.message);
                await replyTo(dest, '这张图没下下来，麻烦再发一次～', userText);
            }
            return;
        }
    }

    if (pendingPhoto && pendingPhoto.senderId === senderId) {
        pendingPhoto.round = (pendingPhoto.round || 0) + 1;
        // 累积多轮原话再解析：先说时间、后补地点也能拼起来
        const combined = `${pendingPhoto.said || ''} ${userText}`.trim();
        const parsed = resolveAlbum(combined, {
            homeProvince: (cfg.album && cfg.album.homeProvince) || '广东',
            inPrompt: true,   // 追问中：剩下的词就是相册名
        });
        pendingPhoto.said = combined;

        if (parsed.ok) {
            await doIngest(pendingPhoto.buf, parsed, dest, userText);
            pendingPhoto = null;
            return;
        }

        // 三轮拒收：第 3 次还说不清就不收了，但留一句"能捡回来"
        if (pendingPhoto.round >= pendingPhoto.maxRounds) {
            pendingPhoto = null;
            await replyTo(dest, '这张我先不收啦，想存的时候再发一次图，或者跟我说「收回刚才那张」🐳', userText);
            return;
        }
        const miss = parsed.missing.includes('place') && parsed.missing.includes('date')
            ? '相册名和日期'
            : parsed.missing.includes('place') ? '相册名' : '日期';
        const hint = parsed.missing.includes('place') && parsed.missing.includes('date')
            ? '「深圳南山 2023年4月29日」'
            : parsed.missing.includes('place') ? '「深圳南山」' : '「2023年4月29日」';
        await replyTo(dest, `还差${miss}～ 比如 ${hint}`, userText);
        return;
    }

    if (tryMemoryWrite(userText)) {
        await replyTo(dest, '记住了  已入库并生成抽查问答。');
        return;
    }
    const gap = (Date.now() - lastCall) / 1000;
    if (gap < (cfg.guard.cooldownSec || 3)) await new Promise(r => setTimeout(r, ((cfg.guard.cooldownSec || 3) - gap) * 1000));
    lastCall = Date.now();
    try {
        const reply = await think(userText, senderId);
        addHistory(senderId, userText, reply);
        logChat(senderId, userText, reply, lastUsage);
        await replyTo(dest, reply, userText);
    } catch (e) {
        log('[错误] ' + e.message);
        // 错误回复也记录chatLog
        chatLog({ event: 'chat', who: senderId, dest: 'private', in: userText, out: '处理出错了, 请稍后再试。', error: e.message });
        logChat(senderId, userText, '处理出错了, 请稍后再试。', null);
        await replyTo(dest, '处理出错了, 请稍后再试。');
    }
}
// 发送节奏: 私聊按句分条,群聊整条发
async function sendHumanPaced(reply, dest) {
    if (dest.kind === 'group') {
        const body = { group_id: Number(dest.id), message: [{ type: 'text', data: { text: reply } }] };
        await fetch(cfg.napcat.httpUrl + '/send_group_msg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.napcat.accessToken },
            body: JSON.stringify(body),
        });
        return;
    }
    const chunks = reply.split(/(?<=[。!？!？~\n])/).map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < chunks.length; ++i) {
        const body = { user_id: Number(dest.id), message: [{ type: 'text', data: { text: chunks[i] } }] };
        await fetch(cfg.napcat.httpUrl + '/send_private_msg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.napcat.accessToken },
            body: JSON.stringify(body),
        });
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
    }
}

async function replyTo(dest, text, userInput) {
    const msg = [{ type: 'text', data: { text } }];
    // 匹配表情包
    const stickerFile = matchSticker(text, userInput);
    if (stickerFile) {
        const stickerPath = path.join(ROOT, 'bridge', 'stickers', stickerFile);
        if (fs.existsSync(stickerPath)) {
            // 读取文件并转为base64
            const b64 = fs.readFileSync(stickerPath).toString('base64');
            msg.push({ type: 'image', data: { file: 'base64://' + b64 } });
            log('[表情] 发送: ' + stickerFile);
        }
    }
    const body = dest.kind === 'group'
        ? { group_id: Number(dest.id), message: msg }
        : { user_id: Number(dest.id), message: msg };
    const url = dest.kind === 'group' ? '/send_group_msg' : '/send_private_msg';
    const r = await fetch(cfg.napcat.httpUrl + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.napcat.accessToken },
        body: JSON.stringify(body),
    });
    if (!r.ok) log('[发送失败->' + dest.id + '] ' + r.status);
}

// ---------- 启动 ----------
if (!process.env.STW_NO_CONNECT) {
    log("[启动] SenTrixWhale bridge pid=" + process.pid + " | 护栏=10元/500次 | SHW检索=启用 | 模型=本地");
    fetchSHWStats();
    connect();
} else {
    log("[测试] STW_NO_CONNECT=1, 跳过 WS 连接");
}
// [测试用] 导出以便无 QQ 环境跑通链路
module.exports = { handle, connect };

