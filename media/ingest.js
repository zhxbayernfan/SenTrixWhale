// media/ingest.js — 媒体入库管线
// 职责: 照片/视频 → caption生成 → SHW入库 → 索引更新
// 阶段: Alpha(骨架), 阶段2完整实现

const fs = require('fs');
const path = require('path');

class MediaIngest {
    constructor(options = {}) {
        this.storageDir = options.storageDir || '/home/sscy/lingbot-map/005SenTrixWhale/storage';
        this.shwClient = options.shwClient; // api/shw_client.js实例
        this.captionGenerator = options.captionGenerator || this._defaultCaption; // MC/DS vision
        this.queue = [];
        this.processing = false;
        this.logger = options.logger || { log: () => {}, error: () => {} };

        fs.mkdirSync(this.storageDir, { recursive: true });
        fs.mkdirSync(path.join(this.storageDir, 'photos'), { recursive: true });
        fs.mkdirSync(path.join(this.storageDir, 'videos'), { recursive: true });
        fs.mkdirSync(path.join(this.storageDir, 'deadletter'), { recursive: true });
    }

    /**
     * 照片入库
     * @param {string} filePath - 本地照片路径
     * @param {Object} metadata - {userId, source, tags, timestamp}
     * @returns {Promise<{success, assetId, error}>}
     */
    async ingestPhoto(filePath, metadata = {}) {
        const assetId = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const destPath = path.join(this.storageDir, 'photos', assetId + path.extname(filePath));

        try {
            // 1. 复制文件到storage
            fs.copyFileSync(filePath, destPath);

            // 2. 生成caption(调用MC/DS vision)
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

            // 4. 写入本地存储(阶段2: 调用SHW import API)
            const recordPath = path.join(this.storageDir, 'photos', assetId + '.json');
            fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));

            // 5. 如果SHW客户端可用, 同步到SHW
            if (this.shwClient) {
                // TODO: 调用SHW import API(待SHW接口文档)
                this.logger.log(`[Ingest] ${assetId} 已写入本地, SHW同步待实现`);
            } else {
                this.logger.log(`[Ingest] ${assetId} 已写入本地(无SHW客户端)`);
            }

            return { success: true, assetId, caption: caption.slice(0, 100) };
        } catch (err) {
            this.logger.error(`[Ingest] 照片入库失败: ${err.message}`);
            // 死信队列
            fs.writeFileSync(
                path.join(this.storageDir, 'deadletter', assetId + '.error.json'),
                JSON.stringify({ error: err.message, record: { filePath, metadata }, ts: new Date().toISOString() })
            );
            return { success: false, error: err.message };
        }
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
     * 默认caption生成(占位: 实际接MC/DS vision)
     * @private
     */
    async _defaultCaption(filePath) {
        // 阶段2: 调用MiniCPM(6276)或DS vision生成描述
        return `[待生成描述: ${path.basename(filePath)}]`;
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
