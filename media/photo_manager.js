// photo_manager.js - 照片存储管理
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.WHALE_HOME || path.join(__dirname, '..');
const PHOTO_DIR = path.join(ROOT, 'media', 'photos');
const EXIF_DIR = path.join(ROOT, 'media', 'exif');
const CONFIG_DIR = path.join(ROOT, 'media', 'config');

// 加载配置
let fixedLocations = {};
let cityRanges = {};

try {
    fixedLocations = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'fixed_locations.json'), 'utf8'));
    cityRanges = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'city_ranges.json'), 'utf8'));
} catch (e) {
    console.error('加载配置失败:', e.message);
}

// 确保目录存在
fs.mkdirSync(PHOTO_DIR, { recursive: true });
fs.mkdirSync(EXIF_DIR, { recursive: true });

// 生成随机经纬度（在城市范围内）
function randomCoord(city, district) {
    const range = cityRanges[city];
    if (!range) {
        // 默认范围（杭州）
        return { lat: 30.0415, lon: 120.5363 };
    }
    
    // 在城市范围内随机
    const lat = range.lat_min + Math.random() * (range.lat_max - range.lat_min);
    const lon = range.lon_min + Math.random() * (range.lon_max - range.lon_min);
    
    // 如果有区，进一步缩小范围（简化处理）
    if (district) {
        // 可以添加更精细的区级坐标范围
    }
    
    return {
        lat: Math.round(lat * 10000) / 10000,
        lon: Math.round(lon * 10000) / 10000
    };
}

// 检查是否是固定地点
function checkFixedLocation(description) {
    // 只匹配完整的固定地点名称，不匹配城市名
    // 例如：必须说深圳学校或杭州家，只说深圳或杭州不匹配
    for (const [name, coords] of Object.entries(fixedLocations)) {
        if (description.includes(name)) {
            return { ...coords, isFixed: true };
        }
    }
    return null;
}

// 保存照片
async function savePhoto(imageUrl, locationInfo, description) {
    try {
        // 下载图片
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error('下载失败: ' + response.status);
        
        const buffer = await response.arrayBuffer();
        const photoId = crypto.randomBytes(8).toString('hex');
        const fileName = `photo_${photoId}.jpg`;
        const photoPath = path.join(PHOTO_DIR, fileName);
        
        // 保存图片
        fs.writeFileSync(photoPath, Buffer.from(buffer));
        
        // 确定坐标
        let coords;
        const fixed = checkFixedLocation(locationInfo.description || '');
        if (fixed) {
            coords = { lat: fixed.lat, lon: fixed.lon, isFixed: true, locationName: fixed.desc };
        } else {
            const random = randomCoord(locationInfo.city, locationInfo.district);
            coords = { ...random, isFixed: false, locationName: locationInfo.description || locationInfo.city };
        }
        
        // 保存EXIF
        const exifData = {
            photoId,
            fileName,
            time: new Date().toISOString(),
            location: locationInfo.city || '未知',
            district: locationInfo.district || '',
            description: description || '',
            lat: coords.lat,
            lon: coords.lon,
            isFixed: coords.isFixed,
            locationName: coords.locationName,
            source: 'user_upload'
        };
        
        fs.writeFileSync(
            path.join(EXIF_DIR, `${photoId}.json`),
            JSON.stringify(exifData, null, 2)
        );
        
        console.log(`[Photo] 保存成功: ${fileName} (${coords.locationName})`);
        return { success: true, photoId, fileName, coords };
        
    } catch (e) {
        console.error('[Photo] 保存失败:', e.message);
        return { success: false, error: e.message };
    }
}

module.exports = { savePhoto, randomCoord, checkFixedLocation, fixedLocations, cityRanges };
