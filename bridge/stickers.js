// bridge/stickers.js — SenTrixWhale表情包匹配
// 关键词→表情包映射，后续可扩展更多贴纸包

const path = require('path');
const STICKER_DIR = __dirname + '/stickers';

// 关键词→表情包映射
const STICKER_MAP = {
    '你好': '01_嗨！来啦.webp',
    '早上好': '01_嗨！来啦.webp',
    '晚上好': '26_晚安好梦.webp',
    '晚安': '26_晚安好梦.webp',
    '谢谢': '05_比心心.webp',
    '感谢': '05_比心心.webp',
    '厉害': '17_哇！好强.webp',
    '强': '17_哇！好强.webp',
    '加油': '08_冲冲冲.webp',
    '冲': '08_冲冲冲.webp',
    '不知道': '19_让我想想.webp',
    '想想': '19_让我想想.webp',
    '哈哈': '45_嘿嘿.webp',
    '笑': '43_好耶.webp',
    '累': '33_鳍都耷拉了.webp',
    '忙': '03_加班中….webp',
    '饿了': '14_干饭大盆版.webp',
    '吃饭': '14_干饭大盆版.webp',
    '水': '27_多喝水.webp',
    '抱': '23_抱紧你.webp',
    '贴贴': '24_贴贴.webp',
    '生气': '13_别惹我.webp',
    '烦': '13_别惹我.webp',
    '酷': '18_酷不酷.webp',
    '猫': '30_喵~招财.webp',
    '喵': '30_喵~招财.webp',
    '错误': '20_服务器繁忙.webp',
    '坏了': '36_脑子烧了.webp',
    '不行': '32_真的没招了.webp',
    '开工': '37_这就开干.webp',
    '干': '37_这就开干.webp',
    '记忆': '15_记小本本.webp',
    '记下来': '15_记小本本.webp',
};

// 随机日常表情（无匹配时用）
const RANDOM_STICKERS = [
    '22_出海啦.webp',
    '46_来都来了.webp',
    '16_不要看啦.webp',
];

/**
 * 根据回复内容匹配表情包
 * @param {string} replyText - whale的回复文本
 * @param {string} userInput - 用户输入
 * @returns {string|null} 表情包文件名或null
 */
function matchSticker(replyText, userInput) {
    // 先匹配用户输入
    if (userInput) {
        for (const [keyword, sticker] of Object.entries(STICKER_MAP)) {
            if (userInput.includes(keyword)) {
                return path.join(STICKER_DIR, sticker);
            }
        }
    }
    // 再匹配回复内容
    if (replyText) {
        for (const [keyword, sticker] of Object.entries(STICKER_MAP)) {
            if (replyText.includes(keyword)) {
                return path.join(STICKER_DIR, sticker);
            }
        }
    }
    // 无匹配→30%概率随机给一个
    if (Math.random() < 0.3) {
        const r = RANDOM_STICKERS[Math.floor(Math.random() * RANDOM_STICKERS.length)];
        return path.join(STICKER_DIR, r);
    }
    return null;
}

module.exports = { matchSticker, STICKER_DIR };
