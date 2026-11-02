#!/usr/bin/env node
// monitoring/metrics.js — SenTrixWhale Prometheus指标采集(261102)
// 职责: 采集请求数/延迟/错误率, 以Prometheus格式暴露在9090端口
// 用法: node metrics.js (启动指标服务 http://224:9090/metrics)

const http = require('http');
const { execSync } = require('child_process');

// 指标存储
const metrics = {
    whale_requests_total: { type: 'counter', help: 'Total requests to SenTrixWhale', labels: {}, value: 0 },
    whale_request_duration_seconds: { type: 'histogram', help: 'Request latency in seconds', buckets: [0.1, 0.25, 0.5, 1, 2.5, 5], samples: [] },
    whale_errors_total: { type: 'counter', help: 'Total errors', labels: {}, value: 0 },
    whale_active_connections: { type: 'gauge', help: 'Active connections', value: 0 },
    whale_shw_api_up: { type: 'gauge', help: 'SHW API health (1=up, 0=down)', value: 1 },
    whale_napcat_up: { type: 'gauge', help: 'NapCat health (1=up, 0=down)', value: 1 },
    whale_bridge_up: { type: 'gauge', help: 'Bridge process health', value: 1 },
    whale_memory_bytes: { type: 'gauge', help: 'Node.js heap used bytes', value: 0 },
    whale_uptime_seconds: { type: 'counter', help: 'Service uptime in seconds', value: 0 },
};

const startTime = Date.now();

function formatPrometheus() {
    let output = '# HELP senTrixWhale metrics\n';
    output += '# TYPE senTrixWhale metrics\n';

    for (const [name, m] of Object.entries(metrics)) {
        output += `# HELP ${name} ${m.help}\n`;
        output += `# TYPE ${name} ${m.type}\n`;

        if (m.type === 'counter' || m.type === 'gauge') {
            output += `${name} ${m.value}\n`;
        } else if (m.type === 'histogram') {
            const samples = m.samples;
            let count = 0;
            let sum = 0;
            for (const b of m.buckets) {
                const leCount = samples.filter(s => s <= b).length;
                output += `${name}_bucket{le="${b}"} ${leCount}\n`;
                count = leCount;
            }
            output += `${name}_bucket{le="+Inf"} ${samples.length}\n`;
            sum = samples.reduce((a, b) => a + b, 0);
            output += `${name}_sum ${sum.toFixed(3)}\n`;
            output += `${name}_count ${samples.length}\n`;
        }
        output += '\n';
    }

    // 动态更新值
    metrics.whale_uptime_seconds.value = Math.floor((Date.now() - startTime) / 1000);
    if (global.gc) { global.gc(); }
    const mem = process.memoryUsage();
    metrics.whale_memory_bytes.value = mem.heapUsed;

    return output;
}

// 健康检查采集器
setInterval(() => {
    // SHW API
    try {
        const res = execSync('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9598/api/health 2>/dev/null', { timeout: 5000 }).toString().trim();
        metrics.whale_shw_api_up.value = res === '200' ? 1 : 0;
    } catch { metrics.whale_shw_api_up.value = 0; }

    // NapCat
    try {
        const res = execSync('curl -s http://127.0.0.1:3001/ 2>/dev/null', { timeout: 5000 }).toString();
        metrics.whale_napcat_up.value = res.includes('ok') ? 1 : 0;
    } catch { metrics.whale_napcat_up.value = 0; }

    // Bridge
    try {
        execSync('pgrep -f "005SenTrixWhale/bridge" 2>/dev/null', { timeout: 2000 });
        metrics.whale_bridge_up.value = 1;
    } catch { metrics.whale_bridge_up.value = 0; }
}, 30000);

// 指标服务
const server = http.createServer((req, res) => {
    metrics.whale_requests_total.value++;
    const start = Date.now();

    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        metrics.whale_request_duration_seconds.samples.push(duration);
        // 保留最近1000个样本
        if (metrics.whale_request_duration_seconds.samples.length > 1000) {
            metrics.whale_request_duration_seconds.samples = metrics.whale_request_duration_seconds.samples.slice(-1000);
        }
        if (res.statusCode >= 400) {
            metrics.whale_errors_total.value++;
        }
    });

    if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(formatPrometheus());
    } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            uptime: metrics.whale_uptime_seconds.value,
            requests: metrics.whale_requests_total.value,
            errors: metrics.whale_errors_total.value,
        }));
    } else {
        res.writeHead(404);
        res.end('Not found. Try /metrics or /health');
    }
});

const PORT = 9090;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`📊 SenTrixWhale metrics server running on http://0.0.0.0:${PORT}/metrics`);
});

// 优雅退出
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
