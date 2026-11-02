// api/shw_client.js — SHW检索API适配器
// 职责: 封装SHW 2.0检索API, 提供类型安全/重试/多通道路由/证据链格式化
// 契约: GET /api/v1/search?q={词}&top_k=N | 响应: {query, backend, degraded, items, channel_trace}

const http = require('http');
const https = require('https');

class SHWClient {
    constructor(options = {}) {
        this.baseURL = options.baseURL || 'http://127.0.0.1:9598';
        this.timeout = options.timeout || 10000;
        this.retries = options.retries || 2;
        this.channels = options.channels || ['metadata', 'entity', 'lexical', 'visual_ann'];
        this.logger = options.logger || { log: () => {}, error: () => {} };
    }

    /**
     * 记忆检索 — 四通道联合查询
     * @param {string} query - 检索词(1-200字)
     * @param {Object} options - {top_k, channels, includeTrace}
     * @returns {Promise<{success, data, error, meta}>}
     */
    async search(query, options = {}) {
        const { top_k = 10, channels = this.channels, includeTrace = false } = options;

        if (!query || query.length > 200) {
            return { success: false, error: 'query必须为1-200字符', meta: {} };
        }

        const params = new URLSearchParams({ q: query, top_k: String(top_k) });
        if (channels.length < 4) params.append('channels', channels.join(','));

        const url = `${this.baseURL}/api/v1/search?${params}`;

        for (let attempt = 1; attempt <= this.retries + 1; attempt++) {
            try {
                this.logger.log(`[SHW] 检索尝试 ${attempt}/${this.retries + 1}: "${query}"`);
                const data = await this._httpGet(url);

                // 格式化响应
                const items = (data.items || []).map(x => ({
                    id: x.asset?.id,
                    file: x.asset?.file_name,
                    time: x.asset?.captured_at,
                    type: x.asset?.media_type,
                    size: x.asset?.size_bytes,
                })).filter(x => x.file);

                return {
                    success: true,
                    data: {
                        query: data.query,
                        count: items.length,
                        total: data.items?.length || 0,
                        items,
                        backend: data.backend,
                        degraded: data.degraded || false,
                        degradedReason: data.degraded_reason,
                    },
                    meta: {
                        attempt,
                        latency: Date.now(),
                        trace: includeTrace ? data.channel_trace : undefined,
                    },
                };
            } catch (err) {
                this.logger.error(`[SHW] 检索失败(尝试${attempt}): ${err.message}`);
                if (attempt === this.retries + 1) {
                    return { success: false, error: `检索失败: ${err.message}`, meta: { attempt } };
                }
                await new Promise(r => setTimeout(r, 500 * attempt)); // 指数退避
            }
        }
    }

    /**
     * 获取资产详情(证据链)
     * @param {string} assetId - asset_xxx
     * @returns {Promise<{success, data, error}>}
     */
    async getAsset(assetId) {
        const url = `${this.baseURL}/api/v1/assets/${assetId}`;
        try {
            const data = await this._httpGet(url);
            return { success: true, data };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * 健康检查
     * @returns {Promise<{success, data, error}>}
     */
    async health() {
        const url = `${this.baseURL}/api/health`;
        try {
            const data = await this._httpGet(url);
            return { success: true, data };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // 内部: HTTP GET(自动处理JSON/超时)
    _httpGet(url) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            const req = client.get(url, { timeout: this.timeout }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try { resolve(JSON.parse(body)); } catch { reject(new Error('非JSON响应')); }
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
        });
    }
}

// 导出
module.exports = { SHWClient };

// 快速测试: node shw_client.js
if (require.main === module) {
    const client = new SHWClient({ logger: console });
    client.search('海边', { top_k: 3, includeTrace: true }).then(r => {
        console.log('✅ 检索成功:', r.data.count, '条');
        r.data.items.slice(0, 3).forEach(x => console.log('  -', x.file, x.time));
    });
}
