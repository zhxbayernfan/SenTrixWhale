// media/shw_ingest.js — 存图入库（QQ 图 → 本地归档 → 写 EXIF → 传 SHW）
//
// 设计前提（zhx 定的）：
//   QQ 传过来的图，EXIF 必然丢失，所以**不能信原图 EXIF**。
//   我们只复现两个查询必需的元素：时间、地点。
//     时间 → 文件名   YYYY-MM-DD_HHmmss_<hash>.jpg
//     地点 → 目录名   media/photos/<相册>/
//   入库前往图片里补写 EXIF(DateTimeOriginal)，让 SHW 的 captured_at 落到真日期上；
//   目录名直接当 scope_id，等于"一个地区一本相册"。
//
// 这一步是派生，不是真相：文件名和目录才是归档层的事实，EXIF 是喂给 SHW 的格式。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PY = process.env.STW_PYTHON || '/opt/anaconda3/bin/python3';
const PHOTO_ROOT = process.env.STW_PHOTO_ROOT || path.join(__dirname, 'photos');

const PY_EXIF = `
import sys
from PIL import Image
src, dst, when = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src)
im = im.convert("RGB")
ex = im.getexif()
ex[306] = when
ex[36867] = when
im.save(dst, exif=ex, quality=95)
`;

// '2023-04-29' / '2023年4月29日' / '2023-04-29 16:50' → Date
function parseWhen(text) {
    if (!text) return null;
    const m = String(text).match(/(\d{4})\D(\d{1,2})(?:\D(\d{1,2}))?(?:\D+(\d{1,2})\D(\d{1,2}))?/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1),
        Number(m[4] || 12), Number(m[5] || 0), 0);
    return isNaN(d.getTime()) ? null : d;
}

function stamp(d) {
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_`
        + `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

function exifStamp(d) {
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}:${p2(d.getMonth() + 1)}:${p2(d.getDate())} `
        + `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/**
 * 存一张图：归档 + 入库 SHW
 * @param {Buffer} buf 图片字节
 * @param {{album: string, when?: Date, scopeId?: string, shwBase: string, note?: string}} opts
 */
async function ingestPhoto(buf, opts) {
    const album = String(opts.album || '未分类').replace(/^\/+|\/+$/g, '').trim() || '未分类';
    // 时间必须来自用户口述或原图 EXIF。拿不到就不入库。
    // 以前这里是 `opts.when instanceof Date ? opts.when : new Date()`，后果是：
    // 补传的图被记成"今天拍的"，而且这个假时间还会被写进 JPEG 的 DateTimeOriginal，
    // 原始时间从此不可逆地丢失（2026-11-17 巴伐利亚那条就是被这么污染的）。
    // 产品口径：时间解析不出来就留空，绝不猜"今天"。
    const when = opts.when instanceof Date ? opts.when : null;
    if (!when) {
        return {
            ok: false,
            undated: true,
            album,
            error: '这张还没记准时间，先没入库——跟我说说它是哪年拍的，我再收。',
        };
    }
    const scopeId = opts.scopeId || album;
    const dir = path.join(PHOTO_ROOT, album);
    fs.mkdirSync(dir, { recursive: true });

    const hash = require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 8);
    const base = `${stamp(when)}_${hash}`;
    const rawPath = path.join(dir, base + '.raw.jpg');
    const outPath = path.join(dir, base + '.jpg');

    fs.writeFileSync(rawPath, buf);

    // 补写 EXIF；PIL 不可用时退化为原图——此时 SHW 会用自己的导入时间，
    // 和文件名里的时间对不上。保留退化路径，但要留日志，不静默地错。
    let exifOk = true;
    try {
        execFileSync(PY, ['-c', PY_EXIF, rawPath, outPath, exifStamp(when)], { stdio: 'pipe' });
    } catch (e) {
        exifOk = false;
        fs.copyFileSync(rawPath, outPath);
    }
    fs.unlinkSync(rawPath);

    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(outPath)], { type: 'image/jpeg' }), path.basename(outPath));
    form.append('scope_id', scopeId);

    const r = await fetch(String(opts.shwBase || 'http://127.0.0.1:8191') + '/api/v1/media/import', {
        method: 'POST',
        body: form,
    });
    if (!r.ok) {
        const t = await r.text();
        return { ok: false, file: outPath, exifOk, error: `SHW ${r.status}: ${t.slice(0, 120)}` };
    }
    const j = await r.json();

    // sidecar：EXIF 只能存一个时间点，精度(月/年)和原始说法存在旁边
    try {
        fs.writeFileSync(outPath.replace(/\.jpg$/, '.json'), JSON.stringify({
            album,
            scope_id: scopeId,
            captured_at: exifStamp(when),
            precision: opts.precision || 'day',
            said: opts.said || '',
            place: opts.place || null,
            asset_id: j.asset_id,
            ingested_at: new Date().toISOString(),
        }, null, 2));
    } catch (e) { /* sidecar 失败不影响入库 */ }

    return {
        ok: true,
        file: outPath,
        relFile: path.relative(PHOTO_ROOT, outPath),
        assetId: j.asset_id,
        dedup: !!j.deduplicated,
        exifOk,
        album,
        when: exifStamp(when),
    };
}

module.exports = { ingestPhoto, parseWhen, PHOTO_ROOT };

// 自测: node media/shw_ingest.js media/photos/xx.jpg 广东 2023-04-29
// 时间必须显式给出。以前这里是 `parseWhen(whenText) || new Date()`，
// 一个解析失败就会被当成"现在拍的"写进库里和 EXIF 里。
if (require.main === module) {
    const [file, album = '未分类', whenText = ''] = process.argv.slice(2);
    if (!whenText.trim()) {
        console.error('用法: node media/shw_ingest.js <图片> <相册> <时间>\n时间必须显式给出，不猜。');
        process.exit(2);
    }
    const when = parseWhen(whenText);
    if (!when) {
        console.error('时间解析不出来: ' + whenText + '\n支持的形式见 media/album_resolver.js 的用例。');
        process.exit(2);
    }
    const buf = fs.readFileSync(file);
    ingestPhoto(buf, { album, when, shwBase: 'http://127.0.0.1:8191' })
        .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); });
}
