#!/usr/bin/env node
const { matchSticker, STICKER_FILES } = require('../stickers_bridge.js');
const { savePhoto, checkFixedLocation } = require('../../media/photo_manager');
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
let shwStats={total:0};async function fetchSHWStats(){if(!cfg.shw||!cfg.shw.enabled)return;try{const d=await(await fetch(cfg.shw.apiBase+'/api/v1/search?q=frame00&top_k=100')).json();shwStats.total=(d.items||[]).length;log('[SHW统计] '+shwStats.total)}catch(e){log('[SHW统计] 失败')}}
function familySum(){try{const CL=path.join(ROOT,'state','chat_log_sentrix.jsonl');if(!fs.existsSync(CL))return'';const byU={};fs.readFileSync(CL,'utf8').trim().split('\n').filter(l=>l.startsWith('{')).slice(-20).forEach(l=>{try{const d=JSON.parse(l),q=String(d.who||'');if(!byU[q])byU[q]=[];if(d.in)byU[q].push(d.in.slice(0,30))}catch(e){}});return Object.entries(byU).map(([q,m])=>{const k=Object.entries(mem).find(([kk])=>kk===q);return'- '+(k?k[0]:q)+': '+m.join('; ')}).join('\n')}catch(e){return''}}


// ---------- 对话历史(最近5轮) ----------
const chatHistory = {};
const MAX_HISTORY = 5;
function getHistory(who) {
    // 返回空数组，避免历史混淆
    return [];
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
async function shwSearch(query) {
    if (!cfg.shw || !cfg.shw.enabled) return null;  // 未启用: 走本地记忆
    try {
        const r = await fetch(cfg.shw.apiBase + cfg.shw.retrievalEndpoint + '?q=' + encodeURIComponent(query) + '&top_k=5');
        if (!r.ok) { log('[SHW] HTTP ' + r.status); return null; }
        const j = await r.json();
        const items = (j.items || []).slice(0, 5).map(it => ({
            file: it.asset && it.asset.file_name,
            time: it.asset && it.asset.captured_at,
            type: it.asset && it.asset.media_type,
        })).filter(x => x.file);
        return { count: (j.items || []).length, items };  // 精简素材给DS
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
        return '今天电量不足, 明天再见 [whale]';
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
        const firstItem = hits.items[0];
        const timeHint = firstItem?.time ? `${firstItem.time.split(' ')[0]}那天` : '之前';
        memBlock = `我好像记得一些相关的事情... (${timeHint}的记录)`;
    } else {
        memBlock = memText() ? `我认识家里这些人：\n${memText()}\n\n最近大家聊的：\n${famSum || '还没什么人聊过天呢'}` : '我的记忆还空着呢';
    }

    let sys = roleText() + identityNote + chatNote + '\n\n回答规则: 像老朋友聊天——轻松、自然、简短。记得的事情就说"我记得/好像有印象"，不记得就老实说"这个我好像没存"。不报数字、不甩文件名、不列清单、不说"检索到"。';
    sys = filterSurrogates(sys);

    const _bodyStr = JSON.stringify({ model: cfg.ds.model, max_tokens: 2048, thinking: { type: 'disabled' }, messages: [
            { role: 'user', content: sys + '\n\n---\n\n' + userText },
        ] });
    log('[DBG] bodyLen:'+_bodyStr.length+' sysLen:'+sys.length);
    try{require('fs').writeFileSync('/tmp/llama_body.json',_bodyStr)}catch(e){}
    // 再次确保所有message content都清理过
    const cleanHistory = getHistory(who).map(h => ({
        role: h.role,
        content: filterSurrogates(h.content)
    }));
    
    const _fetchBody = JSON.stringify({ model: cfg.ds.model, max_tokens: 2048, thinking: { type: 'disabled' }, messages: [
            { role: 'system', content: filterSurrogates(sys) },
            ...cleanHistory,
            { role: 'user', content: filterSurrogates(userText) },
        ] });
    try{require('fs').writeFileSync('/tmp/actual_fetch_body.json', _fetchBody)}catch(e){}
    log('[FETCH] bodyLen:'+_fetchBody.length+' histLen:'+getHistory(who).length+' histJSON:'+JSON.stringify(getHistory(who)).slice(0,200));
    log('[think] 准备调用llama: ' + cfg.ds.baseUrl + '/chat/completions');
    const r = await fetch(cfg.ds.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.ds.apiKey },
        body: _fetchBody,
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
        log('[WS] 收到原始消息: ' + ev.data.toString().slice(0,100));
        try {
            const m = JSON.parse(ev.data);
            log('[WS] 解析后: post_type=' + m.post_type + ' user_id=' + m.user_id);
            if (m.post_type !== 'message') return;
            const text = (m.message || []).filter(p => p.type === 'text').map(p => p.data.text).join('');
            if ((!text.trim()) || !isKnown(m.user_id)) return;
            const dest = m.message_type === 'group' ? { kind: 'group', id: String(m.group_id), atQQ: m.user_id } : { kind: 'private', id: m.user_id };
            const atMe = (m.message || []).some(p => p.type === 'at' && String(p.data.qq) === String(m.self_id));
            if (m.message_type === 'group' && !atMe) return;
            const imgs = (m.message || []).filter(p => p.type === 'image').map(p => p.data).slice(0, 3);
            log('[WS] 准备调用handle: text=' + text.trim().slice(0,30) + ' user=' + m.user_id + ' imgs=' + imgs.length);
            handle(text.trim(), m.user_id, dest, imgs).catch(e => log('[handle错误] ' + e.message));
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
async function handle(userText, senderId, dest, imgs) {
    // 处理照片计数查询
    if (userText.includes('几张') || userText.includes('多少张') || userText.includes('照片数量') || userText.includes('count')) {
        const count = await countPhotos();
        if (count !== null) {
            await replyTo(dest, `记忆库里现在有${count}张照片呢～`, userText);
            return;
        }
    }
    
    // 处理照片接收
    if (imgs && imgs.length > 0) {
        const imgUrl = imgs[0].url || imgs[0].file || '';
        if (imgUrl && !imgUrl.includes('sticker')) {
            log('[handle] 收到照片');
            pendingPhoto = { url: imgUrl, senderId, dest, round: 0, maxRounds: 3 };
            await replyTo(dest, '收到照片啦 这是在哪里拍的呢？告诉我城市就好～', userText);
            return;
        }
    }
    
    // 检查是否在等待照片地点
    if (pendingPhoto && pendingPhoto.senderId === senderId) {
        pendingPhoto.round++;
        const locationMatch = userText.match(/在(.{1,10}?)(市|省|区|县|家里|学校|公司)?/);
        
        if (locationMatch || pendingPhoto.round > pendingPhoto.maxRounds) {
            if (locationMatch) {
                try {
                    const result = await savePhoto(pendingPhoto.url, {
                        city: locationMatch[1],
                        description: userText
                    }, userText);
                    if (result.success) {
                        await replyTo(dest, `照片存好啦 地点记作${result.coords.locationName}～`, userText);
                    } else {
                        await replyTo(dest, '照片保存失败了呢', userText);
                    }
                } catch(e) {
                    await replyTo(dest, '照片处理出错了', userText);
                }
            } else {
                await replyTo(dest, '这张图没能存入系统呢 下次记得告诉我地点哦～', userText);
            }
            pendingPhoto = null;
            return;
        } else {
            const remaining = pendingPhoto.maxRounds - pendingPhoto.round;
            await replyTo(dest, `还没告诉我地点呢～再不说这张图就存不进去啦（还剩${remaining}次机会）`, userText);
            return;
        }
    }
    
    if (tryMemoryWrite(userText)) {
        await replyTo(dest, '记住了 [whale] 已入库并生成抽查问答。');
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
        await replyTo(dest, '处理出错了, 请稍后再试。');
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
log("[启动] SenTrixWhale bridge | 护栏=10元/500次 | SHW检索=启用 | 模型=本地");
fetchSHWStats();
connect();

