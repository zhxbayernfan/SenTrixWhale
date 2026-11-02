// storage/cache_manager.js — 本地缓存管理(SenTrixWhale工程鲸)
// 职责: 快照管理/清理策略/磁盘监控, 与SHW索引保持同步

const fs = require('fs');
const path = require('path');

class CacheManager {
    constructor(options = {}) {
        this.storageDir = options.storageDir || path.join(__dirname, '..', 'storage');
        this.maxSizeGB = options.maxSizeGB || 10;
        this.maxAgeDays = options.maxAgeDays || 30;
        this.snapshotIntervalMs = options.snapshotIntervalMs || 3600000; // 1小时
        this.logger = options.logger || { log: () => {}, error: () => {} };

        // 确保子目录存在
        ['photos', 'videos', 'deadletter'].forEach(sub => {
            fs.mkdirSync(path.join(this.storageDir, sub), { recursive: true });
        });
    }

    // ---- 快照管理 -----------------------------------------------------------

    /**
     * 创建本地索引快照
     * @param {string} label - 快照标签(如'daily'、'before-sync')
     * @returns {Promise<{success, snapshotPath, error}>}
     */
    async createSnapshot(label = 'manual') {
        const indexPath = path.join(this.storageDir, 'index.json');
        if (!fs.existsSync(indexPath)) {
            return { success: false, error: '索引文件不存在' };
        }

        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const snapshotPath = path.join(this.storageDir, 'snapshots', `index-${label}-${ts}.json`);

        try {
            fs.mkdirSync(path.join(this.storageDir, 'snapshots'), { recursive: true });
            const indexData = fs.readFileSync(indexPath, 'utf8');
            fs.writeFileSync(snapshotPath, indexData);
            this.logger.log(`[Cache] 快照已创建: ${label} -> ${path.basename(snapshotPath)}`);
            return { success: true, snapshotPath };
        } catch (err) {
            this.logger.error(`[Cache] 快照创建失败: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * 从快照恢复索引
     * @param {string} snapshotPath - 快照文件路径
     * @returns {Promise<{success, restoredEntries, error}>}
     */
    async restoreSnapshot(snapshotPath) {
        try {
            const data = fs.readFileSync(snapshotPath, 'utf8');
            const index = JSON.parse(data);
            const indexPath = path.join(this.storageDir, 'index.json');
            const tmpPath = indexPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2));
            fs.renameSync(tmpPath, indexPath);
            this.logger.log(`[Cache] 索引已从快照恢复: ${path.basename(snapshotPath)} (${Object.keys(index).length}条)`);
            return { success: true, restoredEntries: Object.keys(index).length };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * 列出所有快照
     * @returns {Array<{path, label, timestamp, size, entries}>}
     */
    listSnapshots() {
        const snapDir = path.join(this.storageDir, 'snapshots');
        if (!fs.existsSync(snapDir)) return [];

        return fs.readdirSync(snapDir)
            .filter(f => f.startsWith('index-') && f.endsWith('.json'))
            .map(f => {
                const fullPath = path.join(snapDir, f);
                const stat = fs.statSync(fullPath);
                const match = f.match(/^index-(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.json$/);
                let label = 'unknown', timestamp = '';
                if (match) { label = match[1]; timestamp = match[2]; }
                let entries = 0;
                try { entries = Object.keys(JSON.parse(fs.readFileSync(fullPath, 'utf8'))).length; } catch { entries = -1; }
                return { path: fullPath, label, timestamp, size: stat.size, entries };
            })
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }

    // ---- 清理策略 -----------------------------------------------------------

    /**
     * 按策略清理缓存(大小/时间阈值)
     * @param {Object} options - {dryRun, maxSizeGB, maxAgeDays}
     * @returns {Promise<{success, removedCount, freedBytes, removed: [{assetId, reason}]}>}
     */
    async clean(options = {}) {
        const dryRun = options.dryRun || false;
        const maxSizeGB = options.maxSizeGB ?? this.maxSizeGB;
        const maxAgeDays = options.maxAgeDays ?? this.maxAgeDays;
        const maxBytes = maxSizeGB * 1024 * 1024 * 1024;
        const cutoff = new Date(Date.now() - maxAgeDays * 86400000);

        const indexPath = path.join(this.storageDir, 'index.json');
        if (!fs.existsSync(indexPath)) return { success: true, removedCount: 0, freedBytes: 0, removed: [] };

        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        const removed = [];
        let totalSize = 0;
        let freedBytes = 0;

        // 计算当前总大小
        const mediaDirs = ['photos', 'videos'];
        for (const dir of mediaDirs) {
            const dirPath = path.join(this.storageDir, dir);
            if (fs.existsSync(dirPath)) {
                for (const f of fs.readdirSync(dirPath)) {
                    const fp = path.join(dirPath, f);
                    if (fs.statSync(fp).isFile() && !f.endsWith('.json')) {
                        totalSize += fs.statSync(fp).size;
                    }
                }
            }
        }

        // 按年龄排序， oldest first
        const entries = Object.entries(index).sort((a, b) => {
            const da = new Date(a[1].ingestedAt || 0);
            const db = new Date(b[1].ingestedAt || 0);
            return da - db;
        });

        for (const [assetId, entry] of entries) {
            const ingestedAt = new Date(entry.ingestedAt || 0);
            const isExpired = ingestedAt < cutoff;
            const isOverLimit = totalSize > maxBytes;

            if (isExpired || isOverLimit) {
                const reason = isExpired ? 'age' : 'size_limit';
                removed.push({ assetId, reason });

                if (!dryRun) {
                    // 删除媒体文件
                    const mediaPath = entry.file;
                    if (mediaPath && fs.existsSync(mediaPath)) {
                        const stat = fs.statSync(mediaPath);
                        freedBytes += stat.size;
                        fs.unlinkSync(mediaPath);
                        totalSize -= stat.size;
                    }
                    // 删除记录文件
                    const recordPath = path.join(this.storageDir, entry.type === 'photo' ? 'photos' : 'videos', assetId + '.json');
                    if (fs.existsSync(recordPath)) fs.unlinkSync(recordPath);
                    // 从索引移除
                    delete index[assetId];
                }
            }

            if (totalSize <= maxBytes && !isExpired) break;
        }

        // 原子写入更新后的索引
        if (!dryRun && removed.length > 0) {
            const tmpPath = indexPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2));
            fs.renameSync(tmpPath, indexPath);
            this.logger.log(`[Cache] 清理完成: 移除${removed.length}项, 释放${(freedBytes / 1024 / 1024).toFixed(1)}MB`);
        }

        return { success: true, removedCount: removed.length, freedBytes, removed };
    }

    // ---- 磁盘监控 -----------------------------------------------------------

    /**
     * 获取存储状态
     * @returns {{totalEntries, totalSizeGB, maxAgeDays, snapshots, diskUsage}}
     */
    getStatus() {
        const indexPath = path.join(this.storageDir, 'index.json');
        let index = {};
        if (fs.existsSync(indexPath)) {
            try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { index = {}; }
        }

        let totalBytes = 0;
        let oldestDate = null;
        const mediaDirs = ['photos', 'videos'];
        for (const dir of mediaDirs) {
            const dirPath = path.join(this.storageDir, dir);
            if (fs.existsSync(dirPath)) {
                for (const f of fs.readdirSync(dirPath)) {
                    const fp = path.join(dirPath, f);
                    if (fs.statSync(fp).isFile() && !f.endsWith('.json')) {
                        totalBytes += fs.statSync(fp).size;
                    }
                }
            }
        }

        for (const entry of Object.values(index)) {
            const d = new Date(entry.ingestedAt || 0);
            if (!oldestDate || d < oldestDate) oldestDate = d;
        }

        const maxAgeDays = oldestDate
            ? Math.round((Date.now() - oldestDate.getTime()) / 86400000)
            : 0;

        // 磁盘使用量(简单df替代, Linux)
        let diskUsage = null;
        try {
            const df = require('child_process').execSync(`df -BG "${this.storageDir}"`).toString();
            const lines = df.trim().split('\n');
            if (lines.length >= 2) {
                const parts = lines[1].split(/\s+/);
                diskUsage = { total: parts[1], used: parts[2], available: parts[3], usePercent: parts[4] };
            }
        } catch { diskUsage = { note: 'df不可用' }; }

        return {
            totalEntries: Object.keys(index).length,
            totalSizeGB: (totalBytes / 1024 / 1024 / 1024).toFixed(3),
            maxAgeDays,
            snapshots: this.listSnapshots().length,
            diskUsage,
            thresholds: { maxSizeGB: this.maxSizeGB, maxAgeDays: this.maxAgeDays },
        };
    }
}

module.exports = { CacheManager };
