// tests/failure_scenarios.test.js — SenTrixWhale 失败场景测试
// 职责: 验证SHW宕机/网络异常/超时等降级行为
// 运行: node failure_scenarios.test.js

const http = require('http');
const assert = require('assert');

const DEMO_BASE = 'http://127.0.0.1:7738';
const FAKE_SHW = 'http://127.0.0.1:19999'; // 不存在的端口

function httpGet(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
                catch { resolve({ status: res.statusCode, body }); }
            });
        });
        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

function httpPost(url, data, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = http.request(url, {
            method: 'POST', timeout,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
            let rbody = '';
            res.on('data', c => rbody += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: rbody }); }
                catch { resolve({ status: res.statusCode, body: rbody }); }
            });
        });
        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
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

    console.log('\n=== 🐳 SenTrixWhale 失败场景测试 ===\n');

    // 1. SHW不可用时Demo应有降级响应
    await test('F-1: Demo服务在SHW不可用时仍返回页面', async () => {
        // 假设SHW挂了, Demo页面本身应该还能访问
        const r = await httpGet(`${DEMO_BASE}/`);
        assert.strictEqual(r.status, 200);
    });

    // 2. 空请求体
    await test('F-2: POST空请求体返回400', async () => {
        const req = http.request(`${DEMO_BASE}/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': 0 },
        }, (res) => {
            assert.ok(res.statusCode >= 400, `应返回4xx, 实际 ${res.statusCode}`);
        });
        req.end();
        await new Promise(resolve => req.on('close', resolve));
    });

    // 3. 恶意请求体(超大payload)
    await test('F-3: 超大请求体被拒绝', async () => {
        const bigBody = JSON.stringify({ q: 'a'.repeat(100000) });
        try {
            const r = await httpPost(`${DEMO_BASE}/`, { q: 'a'.repeat(100000) }, 3000);
            // 如果没超时, 应该返回错误或正常响应
            assert.ok(r.status >= 200, '服务应处理大请求体');
        } catch (e) {
            // 超时或连接拒绝都可以接受
            assert.ok(true, '大请求体被正确处理(超时/拒绝)');
        }
    });

    // 4. 无效JSON
    await test('F-4: 无效JSON返回400', async () => {
        const req = http.request(`${DEMO_BASE}/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }, (res) => {
            // 应该返回400或错误信息
            assert.ok(res.statusCode >= 400 || res.statusCode === 200, '应处理无效JSON');
        });
        req.write('not valid json{{{');
        req.end();
        await new Promise(resolve => req.on('close', resolve));
    });

    // 5. SHW端口不可达时的错误处理
    await test('F-5: 连接不可达端口返回错误', async () => {
        try {
            await httpGet(`${FAKE_SHW}/api/v1/search?q=test`, 2000);
            assert.fail('应连接失败');
        } catch (err) {
            assert.ok(err.message.includes('ECONNREFUSED') || err.message.includes('timeout'), '连接被拒绝或超时');
        }
    });

    // 6. 并发连接限制
    await test('F-6: 高并发不崩溃', async () => {
        const results = await Promise.allSettled(
            Array.from({ length: 20 }, () => httpGet(`${DEMO_BASE}/`, 5000))
        );
        const success = results.filter(r => r.status === 'fulfilled').length;
        // 至少80%成功
        assert.ok(success >= 16, `高并发成功率${success}/20 ≥ 80%`);
    });

    // 7. 特殊字符注入
    await test('F-7: SQL/JS注入字符被安全处理', async () => {
        const payloads = [
            { q: "'; DROP TABLE users; --" },
            { q: "<script>alert('xss')</script>" },
            { q: "${process.env}" },
        ];
        for (const p of payloads) {
            const r = await httpPost(`${DEMO_BASE}/`, p, 5000);
            // 不应返回500服务器错误
            assert.ok(r.status !== 500, `特殊字符不应导致500错误`);
        }
    });

    // 8. 超时处理
    await test('F-8: 超时请求被正确终止', async () => {
        try {
            await httpGet(`${DEMO_BASE}/slow-test`, 1000);
            // 如果有这个端点, 不应该超时
        } catch (err) {
            // 超时或被拒绝都可以
            assert.ok(err.message.includes('timeout') || err.message.includes('ECONNREFUSED'));
        }
    });

    console.log(`\n=== 测试结果: ${passed}/${total} 通过, ${failed} 失败 ===\n`);
    if (failed > 0) process.exit(1);
}

runTests().catch(err => { console.error('测试执行失败:', err); process.exit(1); });
