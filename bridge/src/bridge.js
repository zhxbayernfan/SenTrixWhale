#!/usr/bin/env node
const { matchSticker, resolveSticker, takeRoundTicket, resetStickerRound } = require('../stickers_bridge.js');
const { savePhoto, checkFixedLocation } = require('../../media/photo_manager');
const { ingestPhoto } = require('../../media/shw_ingest'); // [存图] 归档+补EXIF+入SHW
const { resolve: resolveAlbum, cityFromGps } = require('../../media/album_resolver');
const { ask: geoAsk } = require('../../media/geo_lookup');
const { parseExif } = require('../../media/exif_parser'); // [存图] 一句话→相册路径+时间
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
// 护栏只在「真花钱」的时候才该拦。
// 家人鲸接 DS API，按次计费，所以要次数+金额双限；
// 工程鲸接本地 llama（127.0.0.1），调用不花钱，次数限额只会在长对话/测试时误伤
// （1116 实测：500 次限额把 44 条回答变成了「今天电量不足」）。
const isLocalModel = () => /127\.0\.0\.1|localhost/.test(String((cfg.ds && cfg.ds.baseUrl) || ''));
const overLimit = () => {
    if (process.env.STW_TEST) return false;      // 测试不拦
    if (isLocalModel()) return false;            // 本地模型不花钱，不拦
    return daily.calls >= cfg.guard.maxCallsPerDay || daily.costYuan >= cfg.guard.dailyLimitYuan;
};

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
    return h.slice(-12).map((m) => ({
        role: m.role,
        content: String(m.content || '').slice(0, 150),
    }));
}
function addHistory(who, userText, reply) {
    if (!chatHistory[who]) chatHistory[who] = [];
    chatHistory[who].push({ role: 'user', content: userText });
    chatHistory[who].push({ role: 'assistant', content: reply });
}

// ---------- 她自己的名字（用户起的，按人存） ----------
// 「取决于你怎么叫我」这句话要当真：用户说了名字，就得记住并用上。
function myNameFor(qq) { return mem['name_' + qq] || ''; }
function catchName(userText, qq) {
    const t = String(userText || '');
    // 仅认「叫你X」「喊你X」「以后叫你X」——不碰「我叫X」（那是用户的自我介绍）
    const m = t.match(/(?:以后|往后|就)?(?:叫|喊)你\s*(?:叫)?\s*([\u4e00-\u9fa5A-Za-z0-9]{1,8})/);
    if (!m) return null;
    const name = m[1].replace(/[吧呀啊哦呢嘛]$/u, '');
    if (!name || name.length < 1) return null;
    mem['name_' + qq] = name;
    saveMem();
    log('[名字] ' + qq + ' 给我起的名字: ' + name);
    return name;
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
    // 「今天 / 刚才」——现场拍完当场问「今天拍的」，得能查到
    const local = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (/今天|今日|刚才|刚刚|这会儿/.test(q)) {
        const t = new Date();
        return { label: `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`, from: local(t), to: local(t) };
    }
    if (/昨天|昨日/.test(q)) {
        const t = new Date(Date.now() - 864e5);
        return { label: `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`, from: local(t), to: local(t) };
    }
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
        // [地图检索] 问题里带地名就按相册过滤：问"杭州"→ scope=全国/浙江/杭州。
        // SHW 的 scope 是精确匹配（不支持前缀），所以只在解析出完整路径时才带。
        let scope = '';
        try {
            const pl = resolveAlbum(query, { homeProvince: (cfg.album && cfg.album.homeProvince) || '广东' });
            if (pl && pl.path) scope = pl.path;
        } catch (e) { /* 解析失败就不带 scope */ }

        // [FIX-9] SHW 的 time_range 过滤在本机会抛 "naive/aware datetime" 错, metadata 通道降级,
        // 于是它仍会把 2023 年的照片当"上周"返回. 这里不信任服务端过滤, 取回后本地按日期硬筛.
        const buildUrl = (sc) => cfg.shw.apiBase + cfg.shw.retrievalEndpoint + '?q=' + encodeURIComponent(query) + '&top_k=10'
            + (tr ? '&time_range=' + encodeURIComponent(tr.label) : '')
            + (sc ? '&scope_id=' + encodeURIComponent(sc) : '');

        let r = await fetch(buildUrl(scope), { signal: AbortSignal.timeout(20000) });
        if (!r.ok) { log('[SHW] HTTP ' + r.status); return null; }
        let _j = await r.json();
        // 带 scope 一条都没有时回退到全库，避免"地名解析对了但相册是空的"直接答没存
        if (scope && (!_j.items || !_j.items.length)) {
            log('[SHW] scope=' + scope + ' 无结果，回退全库');
            r = await fetch(buildUrl(''), { signal: AbortSignal.timeout(20000) });
            if (!r.ok) { log('[SHW] HTTP ' + r.status); return null; }
            _j = await r.json();
        }
        if (scope) log('[SHW] 按相册过滤: ' + scope);
        const j = _j;   // body 已经消费过，不能再 json() 一次
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
        return { count: items.length, items, events, scope };
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
        const album = hits.scope ? `，都在《${hits.scope}》这本相册里` : '';
        memBlock = `【记忆证据】${lines ? '这几天你自己记下的事：\n' + lines + '\n' : ''}命中 ${hits.count} 条照片${span}${album}。只用上面这些事实回答，可以说"我记得"，不许补充证据之外的人名、地点、情节。`;
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
    const _hh = String(new Date().getHours()).padStart(2, '0');
    const _mm = String(new Date().getMinutes()).padStart(2, '0');
    let sys = `现在是 ${_d.getFullYear()}年${_d.getMonth() + 1}月${_d.getDate()}日 ${_hh}:${_mm}。问到几点就按这个答，不知道就说不清楚，**不许编时间**。\n` + roleText() + identityNote + chatNote + '\n\n' + memBlock
        + '\n\n回答规则: 像老朋友聊天——轻松、自然、简短。记得的事情就说"我记得/好像有印象"，不记得就老实说"这个我好像没存"。不报数字、不甩文件名、不列清单、不说"检索到"。'
        + '\n\n先分清两种问题:'
        + '\n· 查记忆（"我上次在哪拍的""2023年4月""杭州的照片"）→ 去记忆库找，有就说，没有就说"这个我没存到"。'
        + '\n· 闲聊（"晚上吃啥""好累""你觉得呢""今天天气"）→ **正常聊，别提"存没存"三个字，也别往照片上引**。你不是只能谈记忆，你也会聊天。'
        + '\n· 让你**做事**（讲个笑话、讲个故事、推荐点啥、夸夸我、猜猜看）→ **直接做，别说"没存"**。'
        + '\n  你又不是只会查库——夸人就夸一句；**讲笑话必须把笑话讲完**（两句话也行），'
        + '\n  绝对不许只说"好，给你讲个短的：" 就停住，那是半成品。'
        + '\n· 跟自己无关的话题（游戏、比赛、新闻、八卦、别人家的事）→ **一句话接住就够，不分析、不追问、不总结、不拉回照片**。'
        + '\n  **「听着挺热闹」这句已经被用滥了，不许再用。**'
        + '\n  参考说法（挑一个，别每次都一样，也别说成口头禅）："这我就不懂了" / "哈哈，你们聊" / "这个我不太行" / "你们继续，我听着"'
        + '\n  **绝对不要**说"我没存过这个""记得拍下来发我""我帮你记进相册里"，也别说"这关你相册里的事"这种别扭话。'
        + '\n\n三条硬规矩:'
        + '\n1. 遇到不认识的人名/昵称（比如"小肥屿""西米老姐"），先问"这是谁呀"，别顺着用、别当成你认识的人。'
        + '\n2. 别重复上一轮的说法。同一个意思换个讲法，别把"下次记得拍照发我"当万能句。'
        + '\n3. 只有照片、家庭里发生的事才说"我记下来/存进相册"。别人聊的新闻、比赛、八卦，不归你管，别往记忆库里塞。';
    // [FIX-13] 说话人挪到最末尾：4B 模型对开头注意力弱，放远会被角色卡冲掉；
    // 并且明确写死"你不是他"，否则它会把对方的名字当自己的
    const _myName = myNameFor(who);
    log('[名字注入] who=' + who + ' name=' + (_myName || '(无)'));
    sys += _myName
        ? `\n\n【你的名字】你叫「${_myName}」。这是 ${_who.name} 给你起的。有人问"你是谁/你叫什么"，答"我是${_myName}"，别提"还没起名"。`
        : `\n\n【你的名字】你还没有名字。有人问"你是谁/你叫什么"，答"工程鲸只是代号，真名还空着，你给起一个？"`
    sys += `\n\n【本轮】现在是 ${_who.name}（QQ ${who}）在跟你说话。称呼他「${_who.name}」——就是这两个字，不加"哥""弟"。`
        + `\n你是工程鲸，不是 ${_who.name}，也不是家里任何一个人。`
        + `\n**不许叫"哥""弟""姐""叔"这类亲属称呼**，你没资格攀亲；直接用名字或"你"。`
        + `\n他要是问"我是谁"，答"你是${_who.name}"。`
        + (who === '1309459509' ? `\n他问"我哥是谁"，答"你哥是 zhx1"（他不是 zhx1，他是 zhx2）。` : '')
        + (who === '1303425363' ? `\n他问"我弟是谁"，答"你弟是 zhx2"（他不是 zhx2，他是 zhx1）。` : '');
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
        temperature: 0.7,
        repetition_penalty: 1.15,   // 默认 1.0 = 不惩罚，模型会字面复述上文
        top_p: 0.9,
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
            // 照片按相册分在 省/市/区 的子目录里，readdirSync 只数顶层会恒为 0
            const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
                const full = path.join(dir, e.name);
                return e.isDirectory() ? walk(full) : [e.name];
            });
            const allPhotos = walk(photoDir).filter(f => f.endsWith('.jpg'));
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
            const _allImgs = (m.message || []).filter(p => p.type === 'image').map(p => p.data).slice(0, 3);
            // [表情包分辨] OneBot 的 sub_type: 0=普通图片, 1=表情；summary 里还会写"[动画表情]"。
            // 表情包不该进相册（既不是回忆，也没有 EXIF），单独认出来。
            const isSticker = (d) => String(d.sub_type ?? 0) === '1' || /动画表情|\[表情\]/.test(String(d.summary || ''));
            const stickers = _allImgs.filter(isSticker);
            const imgs = _allImgs.filter(d => !isSticker(d));
            // 允许纯图片消息通过
            if ((!text.trim() && imgs.length === 0 && stickers.length === 0) || !isKnown(m.user_id)) return;
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
            
            // 纯表情包：不经过存图流程，也不让模型瞎猜，直接收下
            if (stickers.length && imgs.length === 0 && !text.trim()) {
                log('[WS] 收到表情包 → 不计入相册');
                replyTo(dest, '这个表情我收着啦 🐳').catch(() => {});
                return;
            }
            log('[WS] 准备调用handle: text=' + text.trim().slice(0,30) + ' user=' + m.user_id + ' imgs=' + imgs.length + ' 表情包=' + stickers.length);
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

// ── 读 EXIF：借 PIL，不借 exif-reader ──
// exif-reader 对华为写出来的 APP1 段会抛 "Invalid EXIF data"，
// 而 PIL 能稳定读出 DateTime / Model / GPS IFD。
const EXIF_PY = `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1])
ex = im.getexif()
out = {"dateTime": ex.get(36867) or ex.get(306) or None,
       "make": ex.get(271), "model": ex.get(272), "gps": None}
gps = ex.get_ifd(34853) if 34853 in ex else None
if gps:
    def dms(v):
        try:
            return float(v[0]) + float(v[1]) / 60.0 + float(v[2]) / 3600.0
        except Exception:
            return None
    lat, lon = dms(gps.get(2)), dms(gps.get(4))
    ok = (lat is not None and lon is not None
          and lat == lat and lon == lon
          and -90 <= lat <= 90 and -180 <= lon <= 180
          and not (abs(lat) < 1e-6 and abs(lon) < 1e-6))
    if ok:
        out["gps"] = {"lat": lat, "lon": lon}
print(json.dumps(out))
`;

function readExif(filePath) {
    try {
        const out = require('child_process').execFileSync(
            process.env.STW_PYTHON || '/opt/anaconda3/bin/python3',
            ['-c', EXIF_PY, filePath],
            { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] },
        );
        return JSON.parse(out.trim());
    } catch (e) {
        log('[EXIF] PIL 读取失败: ' + e.message);
        return null;
    }
}

// ── 取图：QQ 一条图片消息有多档（原图 / 大图 / 缩略图）──
// url 指向的是大图档；原图要用 file(md5) 调 /get_image 才拿得到。
// 拿不到原图再回退 url，不能让整条链路因为取原图失败而断掉。
async function fetchImageBytes(seg) {
    const key = seg.file || seg.file_id || '';
    if (key && !/^https?:/.test(String(key))) {
        try {
            const r = await fetch(cfg.napcat.httpUrl + '/get_image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + cfg.napcat.accessToken,
                },
                body: JSON.stringify({ file: key }),
                signal: AbortSignal.timeout(20000),
            });
            if (r.ok) {
                const j = await r.json();
                const f = j && j.data && (j.data.file || j.data.path);
                if (f && String(f).startsWith('base64://')) {
                    log('[取图] /get_image -> base64');
                    return Buffer.from(String(f).slice(9), 'base64');
                }
                if (f) {
                    const p = String(f).replace(/^file:\/\//, '');
                    if (fs.existsSync(p)) {
                        log('[取图] /get_image -> 本地 ' + p);
                        return fs.readFileSync(p);
                    }
                    log('[取图] /get_image 返回无法读取的路径: ' + p);
                } else {
                    log('[取图] /get_image 没有 file 字段: ' + JSON.stringify(j).slice(0, 200));
                }
            } else {
                log('[取图] /get_image HTTP ' + r.status);
            }
        } catch (e) {
            log('[取图] /get_image 失败: ' + e.message);
        }
    }
    const url = seg.url || (typeof seg.file === 'string' && /^https?:/.test(seg.file) ? seg.file : '');
    if (!url) return null;
    log('[取图] 回退 url');
    // 用 curl 而不是 fetch：QQ 的图链偶尔会把 undici 的 body 读取挂死
    // （signal 触发了也不 reject，整条消息就此消失）。curl 有硬超时。
    return await new Promise((resolve, reject) => {
        require('child_process').execFile(
            'curl', ['-sS', '--max-time', '25', '-L', url],
            { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 30000 },
            (err, stdout) => {
                if (err) return reject(new Error('curl: ' + err.message));
                if (!stdout || !stdout.length) return reject(new Error('curl: 空响应'));
                resolve(stdout);
            },
        );
    });
}

// ---------- 主处理 ----------
let lastCall = 0;
// [并发控制] llama 是 --parallel 1，一次只能算一条。
// 用户连发时（混沌测试 38 条 / 演示时领导连问）会同时打进来，
// 后面的排队到 90 秒超时，用户就看到「处理出错了」。
// 这里排成串行队列：同一时刻只跑一条，其余等着，不超时。
const _lastNum = new Map();   // 每个用户上一条是不是数字消息
let _handleChain = Promise.resolve();
let _queued = 0;

async function handle(userText, senderId, dest, imgs) {
    _queued++;
    if (_queued > 1) log(`[队列] 前面还有 ${_queued - 1} 条在等`);
    const run = _handleChain.then(() => _handleInner(userText, senderId, dest, imgs));
    _handleChain = run.catch(() => {}).finally(() => { _queued--; });
    return run;
}

async function _handleInner(userText, senderId, dest, imgs) {
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
        const seg = imgs[0];
        log('[存图] image段完整: ' + JSON.stringify(seg).slice(0, 600));
        const imgUrl = seg.url || seg.file || '';
        if (imgUrl && !String(imgUrl).includes('sticker')) {
            log('[存图] 收到照片');
            try {
                const buf = await fetchImageBytes(seg);
                if (!buf) throw new Error('取不到图片字节');

                // [EXIF 自动] 如果这张图还带着 EXIF（QQ「原图」可能保留），就不用问用户：
                // 时间来自 DateTimeOriginal，城市来自 GPS 反查。
                let autoParsed = null;
                let exifWhen = null;
                try {
                    const tmp = require('path').join(require('os').tmpdir(), `stw_${Date.now()}.jpg`);
                    require('fs').writeFileSync(tmp, buf);
                    const ex = readExif(tmp);
                    require('fs').unlinkSync(tmp);
                    if (ex && ex.dateTime) {
                        const m = String(ex.dateTime).match(/(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})/);
                        const when = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
                        const city = ex.gps ? cityFromGps(ex.gps.lat, ex.gps.lon) : null; // python 输出的是 lat/lon
                        if (when && city) {
                            // 只借 resolve 的「地名→相册路径」，时间由 EXIF 给，
                            // 所以判 cr.path 而不是 cr.ok（cr.ok 还要求文本里有日期，这里没有）
                            const cr = resolveAlbum(city, { homeProvince: (cfg.album && cfg.album.homeProvince) || '广东' });
                            if (cr.path) {
                                autoParsed = { ...cr, ok: true, path: cr.path, when, precision: 'day', fromExif: true, gps: ex.gps };
                                log(`[EXIF] 自动识别 ${cr.path} ${when.getFullYear()}-${when.getMonth() + 1}-${when.getDate()} (${ex.gps.lat},${ex.gps.lon})`);
                            } else {
                                log('[EXIF] 地点识别失败: city=' + city + ' path=' + cr.path);
                            }
                        } else if (when) {
                            // 有时间没坐标：时间先记下，追问时只问地点
                            exifWhen = when;
                            log(`[EXIF] 只拿到时间 ${when.toISOString().slice(0, 19)}，地点仍需口述`);
                        } else {
                            log(`[EXIF] 有数据但不够：time=${!!when} gps=${!!ex.gps}`);
                        }
                    }
                } catch (e) { log('[EXIF] 解析失败: ' + e.message); }

                if (autoParsed) {
                    await doIngest(buf, autoParsed, dest, '来自照片自带的信息');
                    return;
                }

                // [带字直存] 图和话在同一条消息里，能解析就直接收，不追问
                const parsedNow = resolveAlbum(userText || '', {
                    homeProvince: (cfg.album && cfg.album.homeProvince) || '广东',
                });
                if (userText && userText.trim() && parsedNow.ok) {
                    await doIngest(buf, parsedNow, dest, userText);
                    return;
                }

                pendingPhoto = { buf, senderId, dest, round: 0, maxRounds: 3, said: (userText || '').trim(), exifWhen };
                if (userText && userText.trim() && parsedNow.missing.length === 1) {
                    // 说了一半（只缺一样），点上缺的那一样就行，别让他重说
                    await replyTo(dest,
                        parsedNow.missing.includes('place')
                            ? '啥时候拍的记下了 🐳 还差个地方——在哪儿拍的呀？'
                            : '地方记下了 🐳 还差个日子——大概什么时候拍的？',
                        userText);
                } else {
                    await replyTo(dest,
                        '这张照片收到啦 🐳 要不要跟我说说它？什么时候、在哪儿拍的呀？',
                        userText);
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
        // 原图带了拍摄时间：用户只需要说地点，时间不用再问
        if (pendingPhoto.exifWhen && (!parsed.when || parsed.missing.includes('date'))) {
            parsed.when = pendingPhoto.exifWhen;
            parsed.precision = 'day';
            parsed.missing = parsed.missing.filter((m) => m !== 'date');
            parsed.ok = parsed.missing.length === 0;
        }
        pendingPhoto.said = combined;

        if (parsed.ok) {
            await doIngest(pendingPhoto.buf, parsed, dest, userText);
            pendingPhoto = null;
            return;
        }

        // 三轮拒收：第 3 次还说不清就不收了，但留一句"能捡回来"
        if (pendingPhoto.round >= pendingPhoto.maxRounds) {
            pendingPhoto = null;
            await replyTo(dest, '那这张我先替你放着，不着急 🐳 哪天想起来了，把图再发我一次，或者跟我说一句「收回刚才那张」，我再给它安家。', userText);
            return;
        }
        const both = parsed.missing.includes('place') && parsed.missing.includes('date');
        const tryText = both ? '「深圳南山 2023年4月29日」'
            : parsed.missing.includes('place') ? '「深圳南山」' : '「2023年4月29日」';
        await replyTo(dest,
            both ? `没关系，慢慢想～ 像这样说一句就好：${tryText}`
                : `还差${parsed.missing.includes('place') ? '在哪儿拍的' : '哪天拍的'}～ 比如 ${tryText}`,
            userText);
        return;
    }

    // 用户给我起名字（"以后叫你小鲸"）——记下来，之后每轮都注入
    const _newName = catchName(userText, senderId);

    // [地理问答] 本地地理库能直接答的，就不烧模型（4B 调工具不靠谱，本地判更快更准）
    try {
        const geo = geoAsk(userText);
        if (geo && geo.ok && geo.text) {
            chatLog({ event: 'chat', who: senderId, dest: dest.kind, in: userText, out: geo.text });
            await replyTo(dest, geo.text, userText);
            return;
        }
    } catch (e) { log('[地理] 查询失败: ' + e.message); }

    // [讲笑话] 4B 讲不出笑话——实测它只会输出「好，讲个短的：」然后就停。
    // 与其让它挤，不如直接给一个（也省一次推理）。
    if (/讲.{0,3}笑话|来.{0,3}笑话|说.{0,3}笑话/.test(userText)) {
        const jokes = [
            '昨天我问我哥要钱，他说"你先把上次的还了"。我说"我上次借的是你的爱，不是钱"。',
            '我妈让我整理相册，我说"相册里都是回忆"。她说"回忆能当饭吃吗"。我说"能，我这就翻"。',
            '有条鱼问另一条鱼：你相信光吗？另一条说：我只相信渔网。',
            '我这人记性特别好——好到连昨天忘带钥匙这件事，今天还记得清清楚楚。',
            '医生说我该多运动，我说我每天都在运动：早上上班赶地铁，晚上下班赶末班车。',
        ];
        const pick = jokes[Math.floor(Math.random() * jokes.length)];
        chatLog({ event: 'chat', who: senderId, dest: dest.kind, in: userText, out: pick });
        await replyTo(dest, pick, userText);
        return;
    }

    // [纯数字] 群里常见的编号/序号消息（16、17、35…），没有内容可答。
    // 交给模型只会得到「16 啥意思呀」这种模板句。只确认一次就够了。
    if (/^\d{1,3}$/.test(userText.trim())) {
        const key = 'num_' + senderId;
        const last = _lastNum.get(key);
        _lastNum.set(key, userText.trim());
        // 纯数字（"16" "35"）本身没有内容，第一次也别让模型猜——
        // 它会把 16 当成日期说"现在是 16 点"。
        void last;
        chatLog({ event: 'chat', who: senderId, dest: dest.kind, in: userText, out: '收到' });
        await replyTo(dest, '收到。', userText);
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
        await replyTo(dest, reply, userText);
    } catch (e) {
        log('[错误] ' + e.message);
        // 错误回复也记录chatLog
        chatLog({ event: 'chat', who: senderId, dest: 'private', in: userText, out: '处理出错了, 请稍后再试。', error: e.message });
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

