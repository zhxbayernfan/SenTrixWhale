// media/ingest.js — 媒体入库管线
// 职责: 照片/视频 → caption生成(DS vision) → SHW入库 → 索引更新
// 阶段: 阶段2(DS vision + SHW import API + 本地索引)

const fs = require('fs');
const https = require('https');
const path = require('path');

class MediaIngest {
    constructor(options = {}) {
        this.storageDir = options.storageDir || '/home/sscy/lingbot-map/005SenTrixWhale/storage';
        this.shwClient = options.shwClient; // api/shw_client.js实例
        this.captionGenerator = options.captionGenerator || this._dsVisionCaption.bind(this); // DS vision优先
        this.queue = [];
        this.processing = false;
        this.logger = options.logger || { log: () => {}, error: () => {} };

        fs.mkdirSync(this.storageDir, { recursive: true });
        fs.mkdirSync(path.join(this.storageDir, 'photos'), { recursive: true });
        fs.mkdirSync(path.join(this.storageDir, 'videos'), { recursive: true });
        fs.mkdirSync(path.join(this.storageDir, 'deadletter'), { recursive: true });
    }

    /**
     * 照片入库(阶段2完整实现)
     * @param {string} filePath - 本地照片路径
     * @param {Object} metadata - {userId, source, tags}
     * @returns {Promise<{success, assetId, caption, shwSynced}>}
     */
    async ingestPhoto(filePath, metadata = {}) {
        const assetId = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const destPath = path.join(this.storageDir, 'photos', assetId + path.extname(filePath));

        try {
            // 1. 复制文件到storage
            fs.copyFileSync(filePath, destPath);

            // 2. 生成caption(DS vision)
            const caption = await this.captionGenerator(destPath);

            // 3. 构造入库记录
            const record = {
                assetId,
                type: 'photo',
                file: destPath,
                caption,
                metadata: {
                    userId: metadata.userId || 'unknown',
                    source: metadata.source || 'qq',
                    tags: metadata.tags || [],
                    ingestedAt: new Date().toISOString(),
                    ...metadata,
                },
            };

            // 4. 写入本地存储
            const recordPath = path.join(this.storageDir, 'photos', assetId + '.json');
            fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));

            // 5. SHW同步(阶段2核心)
            let shwSynced = false;
            if (this.shwClient) {
                const result = await this.shwClient.importSingleMedia(destPath, {
                    metadata: { caption, source: 'qq', ...metadata },
                });
                if (result.success) {
                    shwSynced = true;
                    this.logger.log(`[Ingest] ${assetId} SHW同步成功, assetId=${result.assetId}`);
                } else {
                    this.logger.error(`[Ingest] ${assetId} SHW同步失败: ${result.error}`);
                }
            }

            // 6. 更新本地索引
            await this._updateIndex(assetId, { ...record, shwSynced });

            return { success: true, assetId, caption: caption.slice(0, 100), shwSynced };
        } catch (err) {
            this.logger.error(`[Ingest] 照片入库失败: ${err.message}`);
            fs.writeFileSync(
                path.join(this.storageDir, 'deadletter', assetId + '.error.json'),
                JSON.stringify({ error: err.message, record: { filePath, metadata }, ts: new Date().toISOString() })
            );
            return { success: false, error: err.message };
        }
    }

    // ---- 阶段2: DS Vision caption生成 ----------------------------------------

    /**
     * DS Vision生成图片描述(阶段2, 替代_defaultCaption)
     * @param {string} imagePath - 本地图片路径
     * @param {Object} options - {apiKey, model, temperature}
     * @returns {Promise<string>}
     */
    async _dsVisionCaption(imagePath, options = {}) {
        const apiKey = options.apiKey || process.env.DS_API_KEY || '';
        const model = options.model || 'deepseek-chat';
        const temperature = options.temperature ?? 0.7;

        if (!apiKey) {
            return `[DS Vision不可用: 缺少apiKey]`;
        }

        const imageBase64 = fs.readFileSync(imagePath).toString('base64');
        const ext = path.extname(imagePath).toLowerCase().slice(1);
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

        const body = JSON.stringify({
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: '请简要描述这张图片的内容，包括场景、人物、动作、文字等关键信息。100字以内。' },
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
                ],
            }],
            temperature,
            max_tokens: 300,
        });

        return new Promise((resolve, reject) => {
            const req = https.request('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Length': Buffer.byteLength(body),
                },
                timeout: 30000,
            }, (res) => {
                let responseBody = '';
                res.on('data', chunk => responseBody += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const data = JSON.parse(responseBody);
                            const caption = data.choices?.[0]?.message?.content || '';
                            resolve(caption.trim());
                        } catch { reject(new Error('DS Vision返回非JSON')); }
                    } else {
                        reject(new Error(`DS Vision HTTP ${res.statusCode}: ${responseBody.slice(0, 200)}`));
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('DS Vision超时(30s)')); });
            req.write(body);
            req.end();
        });
    }

    // ---- 阶段2: 本地索引管理 ------------------------------------------------

    /**
     * 更新本地索引(阶段2, 追加写入)
     * @param {string} assetId - 资产ID
     * @param {Object} entry - 索引条目
     */
    async _updateIndex(assetId, entry) {
        const indexPath = path.join(this.storageDir, 'index.json');
        let index = {};
        if (fs.existsSync(indexPath)) {
            try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { index = {}; }
        }
        index[assetId] = {
            assetId,
            type: entry.type,
            caption: entry.caption,
            file: entry.file,
            source: entry.metadata?.source,
            ingestedAt: entry.metadata?.ingestedAt,
            shwSynced: entry.shwSynced,
        };
        // 原子写入
        const tmpPath = indexPath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2));
        fs.renameSync(tmpPath, indexPath);
    }

    /**
     * 视频入库(调用video_to_text.py转文字 → caption)
     * @param {string} videoUrlOrPath - 视频URL或本地路径
     * @param {Object} metadata
     * @returns {Promise<{success, assetId, transcript}>}
     */
    async ingestVideo(videoUrlOrPath, metadata = {}) {
        const assetId = `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const destPath = path.join(this.storageDir, 'videos', assetId);

        try {
            // TODO: 下载视频(如果是URL) + 调用video_to_text.py
            // 阶段2实现: spawn python video_to_text.py --file ... --out ...
            this.logger.log(`[Ingest] 视频入库待实现: ${videoUrlOrPath}`);
            return { success: false, error: '视频入库管线阶段2实现中' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * 备用caption生成(占位, 当DS vision不可用时回退)
     * @private
     */
    async _fallbackCaption(filePath) {
        const stat = fs.statSync(filePath);
        return `媒体文件 ${path.basename(filePath)} (${Math.round(stat.size / 1024)}KB)`;
    }

    /**
     * 队列处理(后台消费)
     */
    startQueueProcessor() {
        if (this.processing) return;
        this.processing = true;
        this._processQueue();
    }

    async _processQueue() {
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            try {
                if (task.type === 'photo') {
                    await this.ingestPhoto(task.filePath, task.metadata);
                } else if (task.type === 'video') {
                    await this.ingestVideo(task.filePath, task.metadata);
                }
            } catch (err) {
                this.logger.error(`[Queue] 任务失败: ${err.message}`);
            }
        }
        this.processing = false;
    }

    addToQueue(task) {
        this.queue.push(task);
        if (!this.processing) this.startQueueProcessor();
    }
}

module.exports = { MediaIngest };

// 快速测试: node ingest.js
if (require.main === module) {
    const ingest = new MediaIngest({ logger: console });
    console.log('✅ MediaIngest 初始化完成');
    console.log('   storage:', ingest.storageDir);
    console.log('   队列任务数:', ingest.queue.length);
}
