// EXIF解析模块 - 问题4核心修复
const fs = require('fs');
const path = require('path');
const exifReader = require('exif-reader');

/**
 * 解析照片EXIF数据
 * @param {string} photoPath - 照片文件路径
 * @returns {Object} EXIF数据对象
 */
function parseExif(photoPath) {
    try {
        const buffer = fs.readFileSync(photoPath);
        const exif = exifReader(buffer);
        
        return {
            // 原始拍摄时间
            dateTime: exif.image?.DateTime || exif.exif?.DateTimeOriginal || null,
            // GPS坐标
            gps: exif.gps ? {
                latitude: exif.gps.latitude,
                longitude: exif.gps.longitude,
                altitude: exif.gps.altitude || null
            } : null,
            // 相机信息
            camera: {
                make: exif.image?.Make || null,
                model: exif.image?.Model || null,
                software: exif.image?.Software || null
            },
            // 拍摄参数
            settings: {
                exposureTime: exif.exif?.ExposureTime || null,
                fNumber: exif.exif?.FNumber || null,
                iso: exif.exif?.ISOSpeedRatings || null,
                focalLength: exif.exif?.FocalLength || null
            },
            // 原始EXIF对象（备用）
            raw: exif
        };
    } catch (e) {
        console.error('[EXIF Parser] 解析失败:', e.message);
        return null;
    }
}

/**
 * 相对时间语义解析
 * @param {string} timeStr - 用户输入的时间描述
 * @param {Date} referenceDate - 参考时间（默认现在）
 * @returns {Object} 标准化时间对象
 */
function parseRelativeTime(timeStr, referenceDate = new Date()) {
    if (!timeStr) return null;
    
    const now = referenceDate;
    const timeStrLower = timeStr.toLowerCase().trim();
    
    // 精确时间格式匹配
    const exactPatterns = [
        { regex: /(\d{4})年(\d{1,2})月(\d{1,2})[日号]/, type: 'exact_date' },
        { regex: /(\d{4})年(\d{1,2})月/, type: 'exact_month' },
        { regex: /(\d{4})年/, type: 'exact_year' },
        { regex: /(\d{1,2})月(\d{1,2})[日号]/, type: 'month_day' },
    ];
    
    for (const { regex, type } of exactPatterns) {
        const match = timeStrLower.match(regex);
        if (match) {
            switch (type) {
                case 'exact_date':
                    return {
                        type: 'exact',
                        year: parseInt(match[1]),
                        month: parseInt(match[2]),
                        day: parseInt(match[3]),
                        description: timeStr
                    };
                case 'exact_month':
                    return {
                        type: 'month',
                        year: parseInt(match[1]),
                        month: parseInt(match[2]),
                        description: timeStr
                    };
                case 'exact_year':
                    return {
                        type: 'year',
                        year: parseInt(match[1]),
                        description: timeStr
                    };
                case 'month_day':
                    return {
                        type: 'month_day',
                        month: parseInt(match[1]),
                        day: parseInt(match[2]),
                        year: now.getFullYear(), // 假设是今年
                        description: timeStr
                    };
            }
        }
    }
    
    // 相对时间匹配
    const relativePatterns = [
        { regex: /昨天/, fn: () => { const d = new Date(now); d.setDate(d.getDate() - 1); return d; } },
        { regex: /前天/, fn: () => { const d = new Date(now); d.setDate(d.getDate() - 2); return d; } },
        { regex: /上周/, fn: () => { const d = new Date(now); d.setDate(d.getDate() - 7); return d; } },
        { regex: /上个月/, fn: () => { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d; } },
        { regex: /去年/, fn: () => { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; } },
        { regex: /今年/, fn: () => now },
        { regex: /上季度/, fn: () => { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d; } },
    ];
    
    for (const { regex, fn } of relativePatterns) {
        if (regex.test(timeStrLower)) {
            const date = fn();
            return {
                type: 'relative',
                date: date,
                year: date.getFullYear(),
                month: date.getMonth() + 1,
                day: date.getDate(),
                description: timeStr
            };
        }
    }
    
    return null; // 无法解析
}

/**
 * 合并EXIF数据和用户输入
 * @param {Object} exifData - EXIF解析结果
 * @param {string} userTime - 用户提供的时间描述
 * @returns {Object} 合并后的时间地点信息
 */
function mergeExifAndUserInput(exifData, userTime, userLocation) {
    const result = {
        location: userLocation || null,
        time: {
            userProvided: userTime || null,
            exifOriginal: null,
            standardized: null
        }
    };
    
    // 优先使用EXIF原始拍摄时间
    if (exifData?.dateTime) {
        result.time.exifOriginal = exifData.dateTime;
        // 尝试解析为标准时间
        const parsed = parseRelativeTime(exifData.dateTime);
        if (parsed) {
            result.time.standardized = parsed;
        }
    }
    
    // 如果用户提供了时间，解析相对时间
    if (userTime) {
        const userParsed = parseRelativeTime(userTime);
        if (userParsed) {
            result.time.userProvided = userParsed;
            // 如果没有EXIF时间，使用用户时间作为标准化时间
            if (!result.time.standardized) {
                result.time.standardized = userParsed;
            }
        }
    }
    
    return result;
}

module.exports = {
    parseExif,
    parseRelativeTime,
    mergeExifAndUserInput
};
