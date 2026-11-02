// tests/performance.test.js — SenTrixWhale 性能测试(261102)
// 职责: 并发100检索延迟<500ms, 吞吐量测试
// 运行: node performance.test.js

const http = require('http');

const SHW_BASE = 'http://127.0.0.1:9598';

function httpGet(url) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        http.get(url, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                const duration = Date.now() - start;
                try {
                    const parsed = JSON.parse(body);
                    resolve({ status: res.statusCode, duration, body: parsed });
                } catch {
                    resolve({ status: res.statusCode, duration, body });
                }
            });
        }).on('error', (err) => {
            const duration = Date.now() - start;
            reject({ error: err.message, duration });
        });
    });
}

async function runTests() {
    console.log('\n=== 🐳 SenTrixWhale 性能测试 ===\n');

    // 1. 单请求基线延迟
    console.log('--- 单请求基线 ---');
    const baseline = [];
    for (let i = 0; i < 10; i++) {
        try {
            const r = await httpGet(`${SHW_BASE}/api/v1/search?q=test&top_k=5`);
            baseline.push(r.duration);
        } catch (e) { baseline.push(-1); }
    }
    const avg = baseline.filter(d => d > 0).reduce((a, b) => a + b, 0) / baseline.filter(d => d > 0).length;
    const min = Math.min(...baseline.filter(d => d > 0));
    const max = Math.max(...baseline.filter(d => d > 0));
    console.log(`平均: ${avg.toFixed(0)}ms | 最小: ${min}ms | 最大: ${max}ms`);
    console.log(avg < 500 ? '✅ 基线延迟 < 500ms' : `❌ 基线延迟 ${avg.toFixed(0)}ms > 500ms`);

    // 2. 并发10请求
    console.log('\n--- 并发10 ---');
    const start10 = Date.now();
    const results10 = await Promise.allSettled(
        Array.from({ length: 10 }, () => httpGet(`${SHW_BASE}/api/v1/search?q=test&top_k=3`))
    );
    const duration10 = Date.now() - start10;
    const success10 = results10.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
    console.log(`完成: ${success10}/10 | 总耗时: ${duration10}ms`);
    console.log(success10 === 10 ? '✅ 并发10全部成功' : `⚠️ 并发10成功${success10}/10`);

    // 3. 并发50请求
    console.log('\n--- 并发50 ---');
    const start50 = Date.now();
    const results50 = await Promise.allSettled(
        Array.from({ length: 50 }, () => httpGet(`${SHW_BASE}/api/v1/search?q=test&top_k=3`))
    );
    const duration50 = Date.now() - start50;
    const success50 = results50.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
    console.log(`完成: ${success50}/50 | 总耗时: ${duration50}ms`);
    console.log(success50 >= 45 ? '✅ 并发50≥90%成功' : `⚠️ 并发50成功${success50}/50`);

    // 4. 并发100请求(目标: 延迟<500ms)
    console.log('\n--- 并发100 ---');
    const start100 = Date.now();
    const results100 = await Promise.allSettled(
        Array.from({ length: 100 }, () => httpGet(`${SHW_BASE}/api/v1/search?q=test&top_k=3`))
    );
    const duration100 = Date.now() - start100;
    const success100 = results100.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
    const durations100 = results100.filter(r => r.status === 'fulfilled').map(r => r.value.duration);
    const avg100 = durations100.length > 0 ? durations100.reduce((a, b) => a + b, 0) / durations100.length : -1;
    const p95_100 = durations100.length > 0 ? durations100.sort((a, b) => a - b)[Math.floor(durations100.length * 0.95)] : -1;

    console.log(`完成: ${success100}/100 | 总耗时: ${duration100}ms`);
    console.log(`平均延迟: ${avg100.toFixed(0)}ms | P95延迟: ${p95_100}ms`);
    console.log(p95_100 < 500 ? '✅ P95延迟 < 500ms' : `⚠️ P95延迟 ${p95_100}ms ≥ 500ms`);

    // 5. 持续压力测试(30秒)
    console.log('\n--- 持续压力(30秒, 每秒10请求) ---');
    const pressureStart = Date.now();
    let pressureCount = 0;
    let pressureSuccess = 0;
    const pressureDuration = 30000;
    const pressureInterval = 100; // 每100ms发10个

    const pressurePromise = new Promise(async (resolve) => {
        const timer = setInterval(async () => {
            if (Date.now() - pressureStart > pressureDuration) {
                clearInterval(timer);
                resolve();
                return;
            }
            const batch = await Promise.allSettled(
                Array.from({ length: 10 }, () => httpGet(`${SHW_BASE}/api/v1/search?q=test&top_k=1`))
            );
            pressureCount += batch.length;
            pressureSuccess += batch.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
        }, pressureInterval);
    });

    await pressurePromise;
    const pressureRate = pressureCount > 0 ? (pressureSuccess / pressureCount * 100).toFixed(1) : 0;
    console.log(`总请求: ${pressureCount} | 成功: ${pressureSuccess} | 成功率: ${pressureRate}%`);
    console.log(parseFloat(pressureRate) >= 95 ? '✅ 压力测试成功率≥95%' : `⚠️ 压力测试成功率${pressureRate}%`);

    // 汇总
    console.log('\n=== 性能测试汇总 ===');
    console.log(`基线延迟: ${avg.toFixed(0)}ms`);
    console.log(`并发100 P95: ${p95_100}ms`);
    console.log(`压力测试成功率: ${pressureRate}%`);
}

runTests().catch(err => { console.error('性能测试失败:', err); process.exit(1); });
