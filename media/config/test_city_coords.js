// media/config/test_city_coords.js — 城市坐标映射系统验证(261106)
// 用法: node media/config/test_city_coords.js
const fs = require('fs');
const path = require('path');

const COORDS_FILE = path.join(__dirname, 'city_coords.json');
const coords = JSON.parse(fs.readFileSync(COORDS_FILE, 'utf8'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('✅ ' + name); pass++; }
  catch (e) { console.log('❌ ' + name + ': ' + e.message); fail++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('\n=== 城市坐标映射验证 ===\n');

// 1. 总数验证
test('城市总数54', () => assert(Object.keys(coords).length === 54, `实际${Object.keys(coords).length}`));

// 2. 每个城市坐标范围合理(中国境内: 纬度18-54, 经度73-136)
const chinaCities = Object.entries(coords);
for (const [name, c] of chinaCities) {
  test(`${name} 坐标范围合理`, () => {
    assert(c.lat_min < c.lat_max, `${name} lat_min >= lat_max`);
    assert(c.lon_min < c.lon_max, `${name} lon_min >= lon_max`);
    assert(c.lat_min >= 18 && c.lat_max <= 54, `${name} 纬度越界`);
    assert(c.lon_min >= 73 && c.lon_max <= 136, `${name} 经度越界`);
  });
}

// 3. 城市间无重叠(相邻城市经纬度范围不应相交)
// 检查广东城市群(深圳/东莞/惠州/广州/佛山/中山/江门等是否重叠)
const gd = ['深圳','东莞','惠州','广州','佛山','中山','江门','珠海','肇庆'];
test('广东城市群无重叠', () => {
  for (let i = 0; i < gd.length; i++) {
    for (let j = i+1; j < gd.length; j++) {
      const a = coords[gd[i]], b = coords[gd[j]];
      if (!a || !b) continue;
      const overlap = a.lat_min < b.lat_max && b.lat_min < a.lat_max &&
                      a.lon_min < b.lon_max && b.lon_min < a.lon_max;
      assert(!overlap, `${gd[i]}与${gd[j]}坐标范围重叠`);
    }
  }
});

// 4. 核心城市匹配测试(模拟坐标→城市识别)
function getCity(lat, lon) {
  for (const [name, c] of Object.entries(coords)) {
    if (lat >= c.lat_min && lat <= c.lat_max && lon >= c.lon_min && lon <= c.lon_max) return name;
  }
  return '未知';
}

const matchTests = [
  [30.27, 120.15, '杭州'],
  [39.90, 116.40, '北京'],
  [22.54, 114.05, '深圳'],
  [23.12, 113.26, '广州'],
  [34.26, 108.95, '西安'],
  [30.57, 104.07, '成都'],
  [25.04, 102.71, '昆明'],
  [45.75, 126.65, '哈尔滨'],
  [22.52, 113.38, '中山'],
  [22.95, 113.85, '东莞'],
  [23.05, 113.05, '佛山'],
];
for (const [lat, lon, expect] of matchTests) {
  test(`坐标(${lat}, ${lon}) → ${expect}`, () => {
    const got = getCity(lat, lon);
    assert(got === expect, `预期${expect}, 实际${got}`);
  });
}

// 5. 未知坐标应返回'未知'
test('坐标(99, 99) → 未知', () => assert(getCity(99, 99) === '未知'));
test('坐标(0, 0) → 未知', () => assert(getCity(0, 0) === '未知'));

console.log(`\n=== 结果: ${pass}通过, ${fail}失败 ===\n`);
if (fail > 0) process.exit(1);
