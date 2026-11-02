const http = require('http');
const fs = require('fs');
const SHW = 'http://127.0.0.1:9598/api/v1/search';

function search(q) {
    return new Promise((resolve, reject) => {
        http.get(SHW + '?q=' + encodeURIComponent(q) + '&top_k=20', (r) => {
            let body = '';
            r.on('data', c => body += c);
            r.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
        }).on('error', reject);
    });
}

http.createServer(async (req, res) => {
    if (req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                const j = JSON.parse(body);
                const r = await search(j.q || '海边');
                const items = (r.items || []).map(x => ({
                    file: x.asset?.file_name, time: x.asset?.captured_at, type: x.asset?.media_type
                })).filter(x => x.file);
                res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
                const html = `<html><head><title>SentrixWhale 检索演示</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px}h2{color:#0A1628}.item{border-left:3px solid #4D6BFE;padding:10px;margin:10px 0;background:#f5f7ff}.file{font-weight:bold}.meta{color:#666;font-size:14px}pre{background:#f0f0f0;padding:10px;border-radius:4px;font-size:12px}</style></head><body><h2> SentrixWhale 记忆大坝检索演示</h2><p>SHW 2.0 四通道检索(visual/text/episodic/semantic) — 当前后端: ${r.backend}</p><p>命中: <b>${r.items.length}</b> 条 | 降级: ${r.degraded ? '是(' + r.degraded_reason + ')' : '否'}</p><h3>检索结果</h3>${items.map(x => '<div class="item"><span class="file">' + x.file + '</span><div class="meta">' + (x.time||'') + ' | ' + (x.type||'') + '</div></div>').join('')}<h3>原始响应(证据链)</h3><pre>' + JSON.stringify(r, null, 2).slice(0, 4000) + '</pre></body></html>`;
                res.end(html);
            } catch(e) {
                res.writeHead(500); res.end('Error: ' + e.message);
            }
        });
    } else {
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.end(`<html><head><title>SentrixWhale Demo</title><style>body{font-family:sans-serif;max-width:600px;margin:40px auto;padding:0 20px}input{padding:8px 12px;width:300px;font-size:16px}button{padding:8px 20px;font-size:16px;background:#4D6BFE;color:#fff;border:none;border-radius:4px;cursor:pointer}</style></head><body><h2>🐳 SentrixWhale 记忆大坝</h2><p>输入记忆关键词，查看SHW四通道检索结果</p><form method="POST" action="/" onsubmit="document.querySelector('input').disabled=true;document.querySelector('button').textContent='检索中...'"><input name="q" placeholder="例如: 海边 / 桥 / 红色" required><button>检索</button></form></body></html>`);
    }
}).listen(7738, '0.0.0.0');
console.log('SentrixWhale检索演示服务启动: http://192.168.0.224:7738');
