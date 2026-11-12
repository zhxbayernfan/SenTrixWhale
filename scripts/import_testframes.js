#!/usr/bin/env node
// scripts/import_testframes.js — 把 00TestFrames 的前 N 组事件按 EXIF 入册
//
// 这批图的特别之处：**原图自带 EXIF（拍摄时间 + GPS）**，和 QQ 转发过的图完全不同。
// 所以这里不重写 EXIF，只是【按坐标归位 → 归档 → 交 SHW 读 EXIF】。
//
// 归属：照片里的人假定是弟弟和女朋友，所以 uploaded_by 统一记弟弟（1309459509）。
// 事件 10、11 不在这里导——那两组按哥哥/弟弟两条路径分别存，留给人来操作。
//
// 用法:
//   node scripts/import_testframes.js --dry      只跑归类，不落盘不导入
//   node scripts/import_testframes.js --limit 3  只导前 3 张（试跑）
//   node scripts/import_testframes.js            全量导入

const fs = require('fs');
const path = require('path');
const { CITIES, resolve: resolveAlbum } = require('../media/album_resolver');

const SRC = process.env.TF_DIR || '/Users/rm002/Desktop/00TestFrames';
const ROOT = path.join(__dirname, '..');
const PHOTO_ROOT = path.join(ROOT, 'media', 'photos');
const SHW = process.env.SHW_BASE || 'http://127.0.0.1:8191';
const UPLOADER = '1309459509'; // 弟弟

// 这批图涉及的城市（中心坐标）。不在表里的坐标一律拒绝，不猜。
const CITY_COORDS = {
    杭州: [30.2741, 120.1551], 绍兴: [30.0300, 120.5800], 上海: [31.2304, 121.4737],
    西安: [34.3416, 108.9398], 济南: [36.6512, 117.1201], 南京: [32.0603, 118.7969],
    厦门: [24.4798, 118.0894], 北京: [39.9042, 116.4074], 广州: [23.1291, 113.2644],
    深圳: [22.5431, 114.0579], 石家庄: [38.0428, 114.5149], 青岛: [36.0671, 120.3826],
};

// 前 9 组事件的照片号（md 里写的后四位）
const GROUPS = {
    '事件001-吃饭': ['0760', '0781', '0789', '0837', '0860', '4540', '4542', '4555', '4556'],
    '事件002-景观': ['1386', '1388', '1390', '1396', '1400'],
    '事件003-猫咪': ['1483', '1570', '4753', '4823', '4824', '4831', '5259', '5265'],
    '事件004-一顿饭': ['5254', '5255'],
    '事件005-紫色衣服': ['8637', '8890', '8808'],
    '事件006-情侣约会': ['2032', '2036', '2049', '2626', '2696', '2702', '3066', '3672', '3779', '3801', '7742'],
    '事件007-海边': ['6022', '6023'],
    '事件008-脱口秀': ['4146', '6222', '6227'],
    '事件009-商场': ['7954', '7955', '7996', '7999'],
};


function stampOf(dateStr) {
    // "2025-11-08T16:52:40" → "2025-11-08_165240"
    return String(dateStr).replace('T', '_').replace(/:/g, '').slice(0, 15);
}

function nearestCity(lat, lon) {
    let best = null;
    for (const [city, [clat, clon]] of Object.entries(CITY_COORDS)) {
        const d = Math.hypot(lat - clat, lon - clon);
        if (!best || d < best.d) best = { city, d };
    }
    return best && best.d < 0.8 ? best.city : null;
}

function provinceOf(city) {
    for (const [prov, list] of Object.entries(CITIES)) if (list.includes(city)) return prov;
    if (['北京', '上海', '天津', '重庆'].includes(city)) return city;
    return null;
}

function loadExif() {
    const p = path.join(SRC, 'Exif_MetaData.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findFile(code) {
    const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.jpg'));
    return files.find((f) => f.replace(/^frame/, '').replace(/\.jpg$/, '').endsWith(code)) || null;
}

function sidecarFor(album, meta, group, file, storedAs) {
    return {
        album,
        scope_id: album,
        captured_at: meta.time.replace('T', ' ').slice(0, 19),
        precision: 'day',
        uploaded_by: UPLOADER,
        uploader_role: '弟弟',
        source: 'testframe',
        event_group: group,
        gps: { lat: meta.latitude, lon: meta.longitude },
        original: file,
        stored_as: storedAs,
        ingested_at: new Date().toISOString(),
    };
}

async function main() {
    const dry = process.argv.includes('--dry');
    const archiveOnly = process.argv.includes('--archive-only');
    const limitArg = process.argv.indexOf('--limit');
    const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;

    const exif = loadExif();
    const plan = [];
    const skipped = [];

    for (const [group, codes] of Object.entries(GROUPS)) {
        for (const code of codes) {
            const file = findFile(code);
            if (!file) { skipped.push(`${code} 找不到文件`); continue; }
            const key = 'frame' + file.replace(/^frame|\.jpg$/g, '');
            const meta = exif[key];
            if (!meta) { skipped.push(`${file} 没有 EXIF 记录`); continue; }
            const city = nearestCity(meta.latitude, meta.longitude);
            const prov = city ? provinceOf(city) : null;
            if (!city || !prov) { skipped.push(`${file} 坐标(${meta.latitude},${meta.longitude}) 归不了城`); continue; }
            // 统一交给 resolver：直辖市（上海/北京/天津/重庆）省=市，不会重复成 全国/上海/上海
            const cr = resolveAlbum(city, { homeProvince: '广东' });
            const album = cr.ok ? cr.path : (prov === city ? `全国/${prov}` : `全国/${prov}/${city}`);
            plan.push({ group, code, file, meta, city, album });
        }
    }

    console.log(`计划导入 ${plan.length} 张，跳过 ${skipped.length} 张`);
    for (const s of skipped) console.log('  跳过:', s);

    const byAlbum = {};
    for (const p of plan) (byAlbum[p.album] = byAlbum[p.album] || []).push(p);
    for (const [album, list] of Object.entries(byAlbum)) {
        console.log(`  ${album}: ${list.length} 张`);
    }

    if (dry) { console.log('（--dry，不落盘）'); return; }

    const todo = limit ? plan.slice(0, limit) : plan;
    const touched = new Set();
    for (const p of todo) {
        const dir = path.join(PHOTO_ROOT, p.album);
        fs.mkdirSync(dir, { recursive: true });
        // 按 EXIF 时间命名：文件名即时间，和 QQ 存图同一套规范
        const sha = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(SRC, p.file))).digest('hex').slice(0, 8);
        const base = `${stampOf(p.meta.time)}_${sha}`;
        const dst = path.join(dir, base + '.jpg');
        if (!fs.existsSync(dst)) fs.copyFileSync(path.join(SRC, p.file), dst);
        fs.writeFileSync(dst.replace(/\.jpg$/, '.json'),
            JSON.stringify(sidecarFor(p.album, p.meta, p.group, p.file, path.basename(dst)), null, 2));
        touched.add(p.album);
        console.log('  归档:', p.album + '/' + p.file);
    }

    if (archiveOnly) { console.log('（--archive-only，不调 SHW）'); return; }

    // 一个相册一次批量导入，SHW 自己读 EXIF 的时间与 GPS
    // 注意：这里用 node fetch 调整册会撞 300s body 超时，实际导入请用 curl 逐册跑
    for (const album of touched) {
        const body = JSON.stringify({ directory: path.join(PHOTO_ROOT, album), scope_id: album, limit: 200 });
        const t0 = Date.now();
        const r = await fetch(SHW + '/api/v1/imports', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
            signal: AbortSignal.timeout(1800000),
        });
        const j = await r.json().catch(() => ({}));
        console.log(`  导入 ${album}: ${r.status} 新增${j.imported ?? '?'} 去重${j.deduplicated ?? '?'} 事件${j.events ?? '?'} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    console.log('完成');
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
