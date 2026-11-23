// stickers_bridge.js - SenTrixWhale表情包注册表
const path = require('path');
const ROOT = process.env.WHALE_HOME || path.join(__dirname, '..');
const STICKER_DIR = path.join(ROOT, 'bridge', 'stickers');



// 自动扫描目录，不再硬编码。以前写死 78 个，目录里实际 134 个（冬装那批一直没注册）。
const fs = require('fs');
const STICKER_FILES = (() => {
    const map = {};
    try {
        for (const f of fs.readdirSync(STICKER_DIR)) {
            if (!/\.(webp|png|jpg|jpeg|gif)$/i.test(f)) continue;
            const name = f.replace(/^\d+_/, '').replace(/\.(webp|png|jpg|jpeg|gif)$/i, '');
            map[name] = f;
        }
    } catch (e) { /* 目录不存在就空表 */ }
    return map;
})();

// 展示用的"名字 → 编号名"，同样从目录生成
const STICKERS = Object.fromEntries(
    Object.entries(STICKER_FILES).map(([name, f]) => [name, f.replace(/\.(webp|png|jpg|jpeg|gif)$/i, '')])
);

// 关键词→语义名映射（用于自动匹配）
const KEYWORD_MAP = {
    "嗨！来啦": "嗨！来啦",
    "稳了~": "稳了~",
    "加班中…": "加班中…",
    "被夸了…": "被夸了…",
    "比心心": "比心心",
    "就是你！": "就是你！",
    "余额不足": "余额不足",
    "冲冲冲": "冲冲冲",
    "潜水中": "潜水中",
    "晕了晕了": "晕了晕了",
    "放开我！": "放开我！",
    "我很老实": "我很老实",
    "别惹我": "别惹我",
    "干饭大盆版": "干饭大盆版",
    "记小本本": "记小本本",
    "不要看啦": "不要看啦",
    "哇！好强": "哇！好强",
    "酷不酷": "酷不酷",
    "让我想想": "让我想想",
    "服务器繁忙": "服务器繁忙",
    "欢迎光临": "欢迎光临",
    "出海啦": "出海啦",
    "抱紧你": "抱紧你",
    "贴贴": "贴贴",
    "在线办公": "在线办公",
    "晚安好梦": "晚安好梦",
    "多喝水": "多喝水",
    "施法中": "施法中",
    "学习中": "学习中",
    "喵~招财": "喵~招财",
    "再玩一把": "再玩一把",
    "真的没招了": "真的没招了",
    "鳍都耷拉了": "鳍都耷拉了",
    "我先唱为敬": "我先唱为敬",
    "放大看看": "放大看看",
    "脑子烧了": "脑子烧了",
    "这就开干": "这就开干",
    "我要黑化了": "我要黑化了",
    "气势漏完了": "气势漏完了",
    "你再说一遍": "你再说一遍",
    "没忍住": "没忍住",
    "这题我会": "这题我会",
    "好耶": "好耶",
    "听我解释": "听我解释",
    "嘿嘿": "嘿嘿",
    "来都来了": "来都来了",
    "一起开工": "一起开工",
    "旧活新整": "旧活新整",
    "万圣节·南瓜女仆": "万圣节·南瓜女仆",
    "万圣节·床单幽灵": "万圣节·床单幽灵",
    "万圣节·吸血鬼": "万圣节·吸血鬼",
    "万圣节·木乃伊": "万圣节·木乃伊",
    "万圣节·黑猫": "万圣节·黑猫",
    "万圣节·女巫扫帚": "万圣节·女巫扫帚",
    "万圣节·骷髅睡衣": "万圣节·骷髅睡衣",
    "万圣节·小恶魔": "万圣节·小恶魔",
    "万圣节·南瓜头套": "万圣节·南瓜头套",
    "万圣节·讨糖": "万圣节·讨糖",
    "万圣节·小僵尸": "万圣节·小僵尸",
    "万圣节·古风女鬼": "万圣节·古风女鬼",
    "万圣节·提灯夜巡": "万圣节·提灯夜巡",
    "万圣节·纸扎小人": "万圣节·纸扎小人",
    "ENFJ 守护骑士": "ENFJ 守护骑士",
    "ENFP 背包冒险家": "ENFP 背包冒险家",
    "ENTJ 鲸群指挥官": "ENTJ 鲸群指挥官",
    "ENTP 讲台抬杠大师": "ENTP 讲台抬杠大师",
    "ESFJ 送蛋糕的贴心鲸": "ESFJ 送蛋糕的贴心鲸",
    "ESFP 深海气氛组": "ESFP 深海气氛组",
    "ESTJ 审批局长": "ESTJ 审批局长",
    "ESTP 冲浪运动员": "ESTP 冲浪运动员",
    "INFJ 绿袍贤者": "INFJ 绿袍贤者",
    "INFP 发呆小鲸": "INFP 发呆小鲸",
    "INTJ 沙盘军师": "INTJ 沙盘军师",
    "INTP 实验室研究员": "INTP 实验室研究员",
    "ISFJ 小护士鲸": "ISFJ 小护士鲸",
    "ISFP 调色板小画家": "ISFP 调色板小画家",
    "ISTJ 日更打卡员": "ISTJ 日更打卡员",
    "ISTP 修理工鲸": "ISTP 修理工鲸",
};

// 编号清单（注入system prompt用）
const STICKER_LISTING = Object.entries(STICKERS).map(([k,v]) => v).join('\n');

// 解析表情包：语义名或编号→文件路径
function resolveSticker(nm) {
    nm = String(nm || '').trim();
    // 编号匹配（如"01"）
    if (/^\d{2}$/.test(nm)) {
        const byNum = Object.keys(STICKER_FILES).find(k => STICKER_FILES[k].startsWith(nm));
        if (byNum) nm = byNum;
    }
    if (!Object.prototype.hasOwnProperty.call(STICKERS, nm)) return { err: '没有这张表情:' + nm };
    const fname = STICKER_FILES[nm];
    if (!fname) return { err: '表情文件丢失:' + nm };
    const fp = path.join(STICKER_DIR, fname);
    return { fp, name: nm };
}

// 关键词匹配
// [vibe] 按"聊天氛围"选，不按"回复里有没有表情名"选。
// 原来 KEYWORD_MAP 是"表情名 → 表情名"，只有回复恰好写成"嗨！来啦"才会触发，
// 所以从来没发出去过（1123 实测：日志里 [表情] 0 次）。
const VIBES = [
    // 告别放最前：明确的"晚安/睡了"优先级最高，否则会被安慰类的"困"抢走
    ['bye', /晚安|睡了|明天见|拜拜|先这样|回头/, ['晚安好梦']],
    // 打招呼
    ['greet', /你好|嗨|在吗|早上好|晚上好|来啦|初次/, ['嗨！来啦', '欢迎光临', '就是你！']],
    // 安慰/关心
    ['comfort', /累|难受|不开心|烦|辛苦|熬夜|难过|心疼/, ['抱紧你', '贴贴', '多喝水']],
    // 被夸
    ['praise', /厉害|棒|强|好看|可爱|夸|牛|优秀|聪明/, ['被夸了…', '比心心', '好耶', '哇！好强']],
    // 玩笑
    ['playful', /哈哈|笑死|逗|好玩|有趣|离谱|扯/, ['酷不酷', '嘿嘿', '这题我会', '没忍住']],
    // 忙/处理中
    ['busy', /稍等|马上|处理中|忙着|正在|等等/, ['加班中…', '潜水中', '在线办公', '让我想想']],
];

// 控制发不发的概率：不是每次情绪都配图，配多了就成了表情包轰炸
const STICKER_RATE = Number(process.env.STW_STICKER_RATE ?? '0.35');
const STICKER_OFF = process.env.STW_STICKER === '0';   // 测试时关掉，保证可复现

function matchSticker(replyText, userInput) {
    if (STICKER_OFF) return null;
    const text = String(replyText || '') + ' ' + String(userInput || '');
    for (const [, re, names] of VIBES) {
        if (!re.test(text)) continue;
        if (Math.random() > STICKER_RATE) return null;
        const pick = names[Math.floor(Math.random() * names.length)];
        const r = resolveSticker(pick);
        return r.fp || null;
    }
    return null;
}

// 每轮限流（防止刷屏）
let roundTicketUsed = false;
function takeRoundTicket() {
    if (roundTicketUsed) return false;
    roundTicketUsed = true;
    return true;
}
function resetStickerRound() { roundTicketUsed = false; }

module.exports = { STICKERS, STICKER_FILES, STICKER_LISTING, resolveSticker, matchSticker, takeRoundTicket, resetStickerRound };
