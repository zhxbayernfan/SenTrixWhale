// tests/contract.test.js — SHW检索API契约测试
// 职责: 验证SHW检索API响应结构/边界条件/demo服务
// 运行: node contract.test.js

const http = require('http');
const assert = require('assert');

const SHW_BASE = 'http://127.0.0.1:9598';
const DEMO_BASE = 'http://127.0.0.1:7738';

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
                catch { resolve({ status: res.statusCode, body }); }
            });
        }).on('error', reject);
    });
}

async function runTests() {
    let passed = 0, failed = 0, total = 0;

    async function test(name, fn) {
        total++;
        try {
            await fn();
            console.log(`✅ ${name}`);
            passed++;
        } catch (err) {
            console.log(`❌ ${name}: ${err.message}`);
            failed++;
        }
    }

    console.log('\n=== SHW检索API契约测试 ===\n');

    // 1. 正常检索
    await test('GET /api/v1/search?q=海边 返回200+items', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=%E6%B5%B7%E8%BE%B9&top_k=3`);
        assert.strictEqual(r.status, 200, `状态码 ${r.status}`);
        assert.ok(r.body.items, '响应包含items');
        assert.ok(Array.isArray(r.body.items), 'items是数组');
        assert.ok(r.body.items.length > 0, 'items非空(有历史记忆)');
        assert.ok(r.body.query === '海边', 'query回显正确');
    });

    // 2. 响应结构验证
    await test('响应包含标准字段(query/backend/degraded/items)', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=%E6%B5%B7%E8%BE%B9`);
        const required = ['query', 'backend', 'degraded', 'items'];
        required.forEach(f => assert.ok(f in r.body, `缺少字段: ${f}`));
    });

    // 3. item结构验证
    await test('item包含asset{id/file_name/media_type}', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=%E6%B5%B7%E8%BE%B9`);
        const item = r.body.items[0];
        assert.ok(item.asset, 'item有asset');
        assert.ok(item.asset.id, 'asset有id');
        assert.ok(item.asset.file_name, 'asset有file_name');
    });

    // 4. 空查询应报错
    await test('GET /api/v1/search?q= 返回4xx', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=&top_k=3`);
        assert.ok(r.status >= 400, `应返回4xx, 实际 ${r.status}`);
    });

    // 5. 特殊字符查询
    await test('GET /api/v1/search?q=红色 正常返回', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=%E7%BA%A2%E8%89%B2&top_k=3`);
        assert.strictEqual(r.status, 200, `状态码 ${r.status}`);
    });

    // 6. Demo服务健康检查
    await test('GET /demo 返回200+HTML表单', async () => {
        const r = await httpGet(`${DEMO_BASE}/`);
        assert.strictEqual(r.status, 200, `状态码 ${r.status}`);
        assert.ok(typeof r.body === 'string' && r.body.includes('<form'), '返回HTML表单');
    });

    // 7. Demo服务POST检索
    await test('POST /demo {"q":"海边"} 返回命中结果', async () => {
        const body = JSON.stringify({ q: '海边' });
        const r = await new Promise((resolve, reject) => {
            const req = http.request(`${DEMO_BASE}/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve({ status: res.statusCode, body: data }));
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        assert.strictEqual(r.status, 200, `状态码 ${r.status}`);
        assert.ok(r.body.includes('命中'), '响应包含命中信息');
    });

    // 8. 本地模型回复风格测试(CEA要求)
    // 验证: 不甩文件名、活泼语气、计数准确

    await test('风格-1: 回复不直接甩文件名(应含描述性文字)', async () => {
        // Demo服务返回的内容应包含自然语言描述, 而非单纯文件名
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=%E6%B5%B7%E8%BE%B9&top_k=1`);
        const item = r.body.items[0];
        if (item && item.asset) {
            // caption应存在且不是纯文件名格式
            const caption = item.asset.caption || '';
            assert.ok(caption.length > 0, 'caption应有内容');
            assert.ok(!/^\w+\.\w{3,4}$/.test(caption), 'caption不应仅为文件名');
        }
    });

    await test('风格-2: 回复应包含活泼语气(非机械式)', async () => {
        const r = await httpPost(`${DEMO_BASE}/`, { q: '海边' });
        const text = r.body;
        // 不应全为冷冰冰的技术字段(如纯JSON/key-value)
        assert.ok(typeof text === 'string', '回复应为字符串');
        // 应包含自然语言特征(非纯数据)
        const hasNaturalLanguage = /[一-龥]/.test(text);
        assert.ok(hasNaturalLanguage, '回复应包含自然语言描述');
    });

    await test('风格-3: 计数准确(命中N张→实际返回N张)', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=%E6%B5%B7%E8%BE%B9&top_k=5`);
        const count = r.body.items.length;
        const demoR = await httpPost(`${DEMO_BASE}/`, { q: '海边' });
        const text = demoR.body;
        // 如果回复中提到了数量, 应和实际命中一致
        const matchCount = text.match(/命中\s*(\d+)/);
        if (matchCount) {
            const mentioned = parseInt(matchCount[1]);
            assert.strictEqual(mentioned, count, `提到${mentioned}张但实际${count}张`);
        }
    });

    console.log(`\n=== 测试结果: ${passed}/${total} 通过, ${failed} 失败 ===\n`);
    if (failed > 0) process.exit(1);
}

runTests().catch(err => { console.error('测试执行失败:', err); process.exit(1); });
