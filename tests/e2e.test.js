// tests/e2e.test.js — SenTrixWhale 端到端测试(261102)
// 职责: 发照片→检索→验证完整链路
// 运行: node e2e.test.js

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

function httpPost(url, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = http.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
            let rbody = '';
            res.on('data', c => rbody += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(rbody) }); }
                catch { resolve({ status: res.statusCode, body: rbody }); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
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

    console.log('\n=== 🐳 SenTrixWhale 端到端测试 ===\n');

    // 1. SHW检索基本功能
    await test('E2E-1: SHW检索返回有效结果', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=test&top_k=5`);
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.items);
    });

    // 2. Demo服务检索
    await test('E2E-2: Demo服务POST检索', async () => {
        const r = await httpPost(`${DEMO_BASE}/`, { q: 'test' });
        assert.strictEqual(r.status, 200);
        assert.ok(typeof r.body === 'string' && r.body.includes('命中'));
    });

    // 3. 空查询应报错
    await test('E2E-3: 空查询返回4xx', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=&top_k=1`);
        assert.ok(r.status >= 400, `应返回4xx, 实际 ${r.status}`);
    });

    // 4. 中文查询
    await test('E2E-4: 中文查询正常', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=%E6%B5%B7%E8%BE%B9&top_k=3`);
        assert.strictEqual(r.status, 200);
    });

    // 5. top_k参数生效
    await test('E2E-5: top_k限制返回数量', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=test&top_k=2`);
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.items.length <= 2, `返回${r.body.items.length}条, 应≤2`);
    });

    // 6. 响应结构完整
    await test('E2E-6: 响应包含query/backend/degraded/items', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=test`);
        ['query', 'backend', 'degraded', 'items'].forEach(f => {
            assert.ok(f in r.body, `缺少字段: ${f}`);
        });
    });

    // 7. 多通道检索(如果enabled)
    await test('E2E-7: 多通道检索响应结构', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=test&top_k=1`);
        const item = r.body.items[0];
        if (item) {
            assert.ok(item.asset, 'item有asset');
            assert.ok(item.asset.id, 'asset有id');
        }
    });

    // 8. 服务间连通性
    await test('E2E-8: SHW API可达', async () => {
        const r = await httpGet(`${SHW_BASE}/api/health`);
        assert.strictEqual(r.status, 200);
    });

    // 9. Demo页面可访问
    await test('E2E-9: Demo页面返回HTML表单', async () => {
        const r = await httpGet(`${DEMO_BASE}/`);
        assert.strictEqual(r.status, 200);
        assert.ok(typeof r.body === 'string' && r.body.includes('<form'));
    });

    // 10. 检索退化模式
    await test('E2E-10: degraded模式正常', async () => {
        const r = await httpGet(`${SHW_BASE}/api/v1/search?q=test`);
        assert.strictEqual(typeof r.body.degraded, 'boolean');
    });

    console.log(`\n=== 测试结果: ${passed}/${total} 通过, ${failed} 失败 ===\n`);
    if (failed > 0) process.exit(1);
}

runTests().catch(err => { console.error('测试执行失败:', err); process.exit(1); });
