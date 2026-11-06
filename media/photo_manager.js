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

// 加载城市坐标映射
try {
    const cityCoordsPath = path.join(CONFIG_DIR, 'city_coords.json');
    if (fs.existsSync(cityCoordsPath)) {
        cityRanges = JSON.parse(fs.readFileSync(cityCoordsPath, 'utf8'));
        console.log(`[Photo] 加载了 ${Object.keys(cityRanges).length} 个城市坐标`);
    }
} catch (e) {
    console.error('[Photo] 加载城市坐标失败:', e.message);
}

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
        // 未知城市，使用默认范围（杭州）
        console.log('[Photo] 未知城市: ' + city + '，使用默认坐标');
        return { lat: 30.0415, lon: 120.5363, locationName: city || '未知地点' };
    }
    
    // 在城市范围内随机
    const lat = range.lat_min + Math.random() * (range.lat_max - range.lat_min);
    const lon = range.lon_min + Math.random() * (range.lon_max - range.lon_min);
    
    return {
        lat: Math.round(lat * 10000) / 10000,
        lon: Math.round(lon * 10000) / 10000,
        locationName: city
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


// ---------- 照片检索功能 ----------
// 根据关键词检索照片（时间、地点、描述）
async function searchPhotos(query) {
    try {
        const exifPath = path.join(ROOT, 'media', 'exif', 'Exif_MetaData.json');
        if (!fs.existsSync(exifPath)) {
            return { success: false, error: 'EXIF数据不存在' };
        }
        
        const exifData = JSON.parse(fs.readFileSync(exifPath, 'utf8'));
        const queryLower = query.toLowerCase();
        
        // 匹配逻辑：
        // 1. 地点匹配
        // 2. 时间匹配（年份、月份）
        // 3. 帧ID匹配
        
        const results = [];
        for (const [frameId, info] of Object.entries(exifData)) {
            let match = false;
            let matchType = '';
            
            // 地点匹配
            const city = getCityFromCoords(info.latitude, info.longitude);
            if (city && query.includes(city)) {
                match = true;
                matchType = '地点';
            }
            
            // 时间匹配
            if (info.time) {
                const year = info.time.split('-')[0];
                const month = info.time.split('-')[1];
                if (query.includes(year) || query.includes(month)) {
                    match = true;
                    matchType = matchType ? matchType + '+时间' : '时间';
                }
            }
            
            if (match) {
                results.push({
                    frameId,
                    time: info.time,
                    city,
                    lat: info.latitude,
                    lon: info.longitude,
                    matchType
                });
            }
        }
        
        return {
            success: true,
            count: results.length,
            photos: results.slice(0, 10) // 最多返回10张
        };
    } catch (e) {
        console.error('[Photo Search] 错误:', e.message);
        return { success: false, error: e.message };
    }
}

// 根据坐标获取城市名（使用精确城市范围）
function getCityFromCoords(lat, lon) {
    for (const [city, range] of Object.entries(cityRanges)) {
        if (range.lat_min <= lat <= range.lat_max && 
            range.lon_min <= lon <= range.lon_max) {
            return city;
        }
    }
    return null;
}

module.exports = { savePhoto, randomCoord, checkFixedLocation, searchPhotos, fixedLocations, cityRanges };

