// bridge/stickers/sticker_map.js — 表情包配字↔语义名↔文件 双映射表(261106)
// 数据源: 000Notes/鲸鱼娘表情包/(80张webp) + 000Notes/考卷/024/025(zhx专属png) = 82张
// 用法: QQ收到表情图 → llama视觉读配字 → matchSticker()查语义名 → 文件名回发
// 匹配原则: 配字识别可靠(考卷实测qwen3.5读配字准), 键名匹配不可靠(2%-5%), 故以配字为锚

// 表1: 配字 → {语义名, 文件}
// 配字来源=图内文字(考卷实测模型能可靠读出); 别名/空耳梗追加到ALIAS
const STICKER_BY_TEXT = {
  '嗨!来啦': { name: 'Hi', file: '01_嗨！来啦.webp' },
  '稳了~': { name: 'ImDone', file: '02_稳了~.webp' },
  '加班中…': { name: 'Working', file: '03_加班中….webp' },
  '被夸了…': { name: 'BeingPhraised', file: '04_被夸了….webp' },
  '比心心': { name: 'FingerHeart', file: '05_比心心.webp' },
  '就是你!': { name: 'HeartFrog', file: '06_就是你！.webp' },
  '余额不足': { name: 'LackOfMoney', file: '07_余额不足.webp' },
  '冲冲冲': { name: 'Rush', file: '08_冲冲冲.webp' },
  '潜水中': { name: 'Diving', file: '09_潜水中.webp' },
  '晕了晕了': { name: 'Dizzy', file: '10_晕了晕了.webp' },
  '放开我!': { name: 'SetMeFree', file: '11_放开我！.webp' },
  '我很老实': { name: 'Cryin', file: '12_我很老实.webp' },
  '别惹我': { name: 'DontMessMe', file: '13_别惹我.webp' },
  '干饭!': { name: 'RiceEating', file: '14_干饭大盆版.webp' },
  '记小本本': { name: 'NoteYouDownInMyDiary', file: '15_记小本本.webp' },
  '不要看啦': { name: 'DontLookAtMeImShy', file: '16_不要看啦.webp' },
  '哇!好强': { name: 'Wow', file: '17_哇！好强.webp' },
  '酷不酷': { name: 'SoCool', file: '18_酷不酷.webp' },
  '让我想想': { name: 'LetMeThink', file: '19_让我想想.webp' },
  '服务器繁忙': { name: 'ServerBusy', file: '20_服务器繁忙.webp' },
  '欢迎光临': { name: 'Welcome', file: '21_欢迎光临.webp' },
  '出海啦': { name: 'SettingSail', file: '22_出海啦.webp' },
  '抱紧你': { name: 'SnowCoat', file: '23_抱紧你.webp' },
  '贴贴': { name: 'Hugging', file: '24_贴贴.webp' },
  '在线办公': { name: 'OnlineWorking', file: '25_在线办公.webp' },
  '晚安好梦': { name: 'GoodNight', file: '26_晚安好梦.webp' },
  '多喝水': { name: 'DrinkMoreWater', file: '27_多喝水.webp' },
  '施法中': { name: 'CastingMagic', file: '28_施法中.webp' },
  '学习中': { name: 'Learning', file: '29_学习中.webp' },
  '喵~招财': { name: 'WhiteCatWhale', file: '30_喵~招财.webp' },
  '再玩一把': { name: 'OneMoreGame', file: '31_再玩一把.webp' },
  '真的没招了': { name: 'Well', file: '32_真的没招了.webp' },
  '鳍都耷拉了': { name: 'UpsetWithTailDown', file: '33_鳍都耷拉了.webp' },
  '我先唱为敬': { name: 'LetMeSing', file: '34_我先唱为敬.webp' },
  '放大看看': { name: 'LetMeSee', file: '35_放大看看.webp' },
  '脑子烧了': { name: 'BrainBurned', file: '36_脑子烧了.webp' },
  '这就开干': { name: 'LetsWork', file: '37_这就开干.webp' },
  '我要黑化了': { name: 'Blacked_1', file: '38_我要黑化了.webp' },
  '气势漏完了': { name: 'Deflated', file: '39_气势漏完了.webp' },
  '你再说一遍': { name: 'SayItAgain', file: '40_你再说一遍.webp' },
  '没忍住': { name: 'BurstOutLaughing', file: '41_没忍住.webp' },
  '这题我会': { name: 'ICanDoThis', file: '42_这题我会.webp' },
  '好耶': { name: 'OhYeah', file: '43_好耶.webp' },
  '听我解释': { name: 'LetMeExplainIt', file: '44_听我解释.webp' },
  '嘿嘿': { name: 'Giggling', file: '45_嘿嘿.webp' },
  '来都来了': { name: 'SinceWeAreHere', file: '46_来都来了.webp' },
  '一起开工': { name: 'WorkTogether', file: '47_一起开工.webp' },
  '旧活新整': { name: 'ReworkOldStuff', file: '48_旧活新整.webp' },
  '万圣节·南瓜女仆': { name: 'PumpkinHead', file: '49_万圣节·南瓜女仆.webp' },
  '万圣节·床单幽灵': { name: 'SheetGhost', file: '50_万圣节·床单幽灵.webp' },
  '万圣节·吸血鬼': { name: 'VampireDuke', file: '51_万圣节·吸血鬼.webp' },
  '万圣节·木乃伊': { name: 'Mummy', file: '52_万圣节·木乃伊.webp' },
  '万圣节·黑猫': { name: 'BlackCatWhale', file: '53_万圣节·黑猫.webp' },
  '万圣节·女巫扫帚': { name: 'WitchBroom', file: '54_万圣节·女巫扫帚.webp' },
  '万圣节·骷髅睡衣': { name: 'BonePajamas', file: '55_万圣节·骷髅睡衣.webp' },
  '万圣节·小恶魔': { name: 'LittleDevil', file: '56_万圣节·小恶魔.webp' },
  '万圣节·南瓜头套': { name: 'PumpkinLantern', file: '57_万圣节·南瓜头套.webp' },
  '万圣节·讨糖': { name: 'CandyDelivery', file: '58_万圣节·讨糖.webp' },
  '万圣节·小僵尸': { name: 'Jiangshi2', file: '59_万圣节·小僵尸.webp' },
  '万圣节·古风女鬼': { name: 'WhiteRobe', file: '60_万圣节·古风女鬼.webp' },
  '万圣节·提灯夜巡': { name: 'NightWatchman', file: '61_万圣节·提灯夜巡.webp' },
  '万圣节·纸扎小人': { name: 'Jiangshi', file: '62_万圣节·纸扎小人.webp' },
  'ENFJ 守护骑士': { name: 'ENFJ_GuardianKnight', file: '63_ENFJ 守护骑士.webp' },
  'ENFP 背包冒险家': { name: 'ENFP_Backpacker', file: '64_ENFP 背包冒险家.webp' },
  'ENTJ 鲸群指挥官': { name: 'ENTJ_Commander', file: '65_ENTJ 鲸群指挥官.webp' },
  'ENTP 讲台抬杠大师': { name: 'ENTP_Debater', file: '66_ENTP 讲台抬杠大师.webp' },
  'ESFJ 送蛋糕的贴心鲸': { name: 'ESFJ_CaringWhale', file: '67_ESFJ 送蛋糕的贴心鲸.webp' },
  'ESFP 深海气氛组': { name: 'ESFP_Performer', file: '68_ESFP 深海气氛组.webp' },
  'ESTJ 审批局长': { name: 'ESTJ_Inspector', file: '69_ESTJ 审批局长.webp' },
  'ESTP 冲浪运动员': { name: 'ESTP_Surfer', file: '70_ESTP 冲浪运动员.webp' },
  'INFJ 绿袍贤者': { name: 'INFJ_Sage', file: '71_INFJ 绿袍贤者.webp' },
  'INFP 发呆小鲸': { name: 'INFP_Dreamer', file: '72_INFP 发呆小鲸.webp' },
  'INTJ 沙盘军师': { name: 'INTJ_Strategist', file: '73_INTJ 沙盘军师.webp' },
  'INTP 实验室研究员': { name: 'INTP_Researcher', file: '74_INTP 实验室研究员.webp' },
  'ISFJ 小护士鲸': { name: 'ISFJ_Nurse', file: '75_ISFJ 小护士鲸.webp' },
  'ISFP 调色板小画家': { name: 'ISFP_Painter', file: '76_ISFP 调色板小画家.webp' },
  'ISTJ 日更打卡员': { name: 'ISTJ_Logger', file: '77_ISTJ 日更打卡员.webp' },
  'ISTP 修理工鲸': { name: 'ISTP_Mechanic', file: '78_ISTP 修理工鲸.webp' },
  // zhx专属(考卷新增, 配字见图内题字)
  '摸鱼': { name: 'RubTheWhale', file: '025RubTheWhale.png' },
  '钱塘江畔大肥鱼': { name: 'AWhaleInLandscapePainting', file: '024AWhaleInLandscapePainting.png' },
};

// 空耳/梗别名 → 主键(06的「真実はいつもひとつ」空耳等)
const ALIAS = {
  '心机之蛙一直摸你肚子': '就是你!',
  '真実はいつもひとつ': '就是你!',
  '招财': '喵~招财',
  '干饭': '干饭!',
  '贴贴~': '贴贴',
  '摸摸鱼': '摸鱼',
};

// 表2: 语义名 → 文件 (主动发送用)
const STICKER_BY_NAME = Object.fromEntries(
  Object.entries(STICKER_BY_TEXT).map(([, v]) => [v.name, v.file])
);

// 匹配函数: llama读出的配字 → 贴纸对象
function matchSticker(textRead) {
  if (!textRead) return null;
  // 归一化: 全角→半角标点, 截空白
  let t = String(textRead).trim()
    .replace(/[！]/g, '!').replace(/[～]/g, '~').replace(/[？]/g, '?')
    .replace(/…+/g, '…').replace(/·/g, '·');
  // 别名归一
  if (ALIAS[t]) t = ALIAS[t];
  // 精确匹配
  if (STICKER_BY_TEXT[t]) return { ...STICKER_BY_TEXT[t], matched: t, fuzzy: false };
  // 包含匹配(模型读配字可能多字/漏字)
  for (const [k, v] of Object.entries(STICKER_BY_TEXT)) {
    if (t.includes(k) || k.includes(t)) return { ...v, matched: k, fuzzy: true };
  }
  return null;
}

// 随机发一张(聊天气氛用)
function randomSticker() {
  const entries = Object.values(STICKER_BY_TEXT);
  return entries[Math.floor(Math.random() * entries.length)];
}

module.exports = { STICKER_BY_TEXT, STICKER_BY_NAME, ALIAS, matchSticker, randomSticker };
