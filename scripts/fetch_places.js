#!/usr/bin/env node
/**
 * fetch_places.js
 * 用 Google Maps Places API 搜尋台中早餐店，輸出 breakfasts.json 相容格式
 *
 * 使用方式：
 *   node scripts/fetch_places.js "早安有喜"          ← 搜尋特定連鎖品牌
 *   node scripts/fetch_places.js "早餐店 台中"        ← 搜全台中早餐店
 *   node scripts/fetch_places.js "阿寶晨食館"
 *
 * 需要環境變數：
 *   GOOGLE_PLACES_API_KEY=你的API金鑰
 *
 * 輸出：
 *   scripts/output/<搜尋詞>.json   ← 可直接 merge 進 breakfasts.json
 *
 * 取得免費 API Key 步驟：
 *   1. console.cloud.google.com → 建立專案
 *   2. 啟用「Places API」
 *   3. 建立 API Key → 複製
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── 設定 ──────────────────────────────────────────────
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const QUERY   = process.argv[2];
const REGION  = '台中市';  // 預設限縮在台中

// 台中市中心座標（用來 bias 搜尋結果）
const LOCATION = '24.1477,120.6736';
const RADIUS   = 25000; // 25km 涵蓋整個台中市

// 各行政區對應表（address → district 萃取用）
const DISTRICT_MAP = [
  '中區','東區','西區','南區','北區',
  '西屯區','南屯區','北屯區',
  '豐原區','大里區','太平區','大甲區',
  '清水區','沙鹿區','梧棲區','后里區',
  '神岡區','潭子區','大雅區','新社區',
  '石岡區','外埔區','大安區','烏日區',
  '大肚區','龍井區','霧峰區','和平區',
  '東勢區','卓蘭鎮',
];

// ── 工具函式 ──────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractDistrict(address) {
  for (const d of DISTRICT_MAP) {
    if (address.includes(d)) return d;
  }
  return '台中';
}

function guessCategory(name, types) {
  const n = name + (types || []).join(' ');
  if (/漢堡|吐司|三明治|薯餅|培根/.test(n)) return 'western';
  if (/飯糰|湯包|小籠|爌肉|肉燥|麵|粥|豆漿/.test(n)) return 'traditional';
  return 'western';
}

function toShopEntry(place, existingIds) {
  const address   = place.formatted_address || place.vicinity || '';
  const district  = extractDistrict(address);
  const lat       = place.geometry.location.lat;
  const lng       = place.geometry.location.lng;
  const name      = place.name;
  const rating    = place.rating || null;
  const category  = guessCategory(name, place.types);

  // 生成新 ID（從現有最大值往後加）
  const maxId = Math.max(...existingIds.map(id => parseInt(id.replace('tc','')) || 0));
  const newId = `tc${String(maxId + 1).padStart(3, '0')}`;
  existingIds.push(newId);

  return {
    id:         newId,
    name:       name,
    nameEn:     '',
    city:       '台中市',
    district:   district,
    region:     '台中',
    address:    address.replace(/^台灣/, ''),
    lat:        lat,
    lng:        lng,
    hours:      '06:00–13:00',   // 預設，需人工確認
    closedDay:  '',
    types:      [category === 'western' ? 'western' : 'local'],
    tags:       [],
    specialty:  '',
    price:      '50–120',
    desc:       '',
    descEn:     '',
    specialtyEn:'',
    featured:   false,
    userFavorite: false,
    popularity: rating ? Math.min(10, Math.round(rating * 2)) : 6,
    icon:       category === 'western' ? '🍔' : '🍳',
    color:      '#FFF8E1',
    category:   category,
    chain:      true,
    hook:       '',
    _rating:    rating,          // 原始評分，供人工參考
    _google_place_id: place.place_id,
  };
}

// ── 主程式 ────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    console.error('❌ 請先設定 GOOGLE_PLACES_API_KEY 環境變數');
    console.error('   範例：GOOGLE_PLACES_API_KEY=AIza... node scripts/fetch_places.js "早安有喜"');
    process.exit(1);
  }
  if (!QUERY) {
    console.error('❌ 請提供搜尋詞，例如：node scripts/fetch_places.js "早安有喜"');
    process.exit(1);
  }

  // 讀取現有資料，取得已用 ID 清單
  const dataPath = path.join(__dirname, '../data/breakfasts.json');
  const existing = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const existingIds = existing.map(s => s.id);
  const existingNames = new Set(existing.map(s => s.name));

  const searchQuery = QUERY.includes('台中') ? QUERY : `${QUERY} ${REGION}`;
  console.log(`\n🔍 搜尋：${searchQuery}`);
  console.log(`📍 已有 ${existing.length} 間店\n`);

  const results = [];
  let pageToken = null;
  let page = 1;

  do {
    let url = `https://maps.googleapis.com/maps/api/place/textsearch/json`
            + `?query=${encodeURIComponent(searchQuery)}`
            + `&location=${LOCATION}`
            + `&radius=${RADIUS}`
            + `&language=zh-TW`
            + `&key=${API_KEY}`;

    if (pageToken) {
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json`
          + `?pagetoken=${pageToken}`
          + `&key=${API_KEY}`;
      await sleep(2200); // API 要求換頁前等 2 秒
    }

    console.log(`📄 第 ${page} 頁...`);
    const data = await fetchJson(url);

    if (data.status === 'REQUEST_DENIED') {
      console.error('❌ API Key 無效或未啟用 Places API');
      console.error(data.error_message);
      process.exit(1);
    }
    if (data.status === 'ZERO_RESULTS') {
      console.log('⚠️  沒有搜尋結果');
      break;
    }

    const places = data.results || [];
    let newCount = 0;
    for (const p of places) {
      // 只保留台中市的結果
      const addr = p.formatted_address || p.vicinity || '';
      if (!addr.includes('台中') && !addr.includes('臺中')) continue;
      // 跳過已有的店
      if (existingNames.has(p.name)) {
        console.log(`  ⏭  已有：${p.name}`);
        continue;
      }
      results.push(toShopEntry(p, existingIds));
      existingNames.add(p.name);
      newCount++;
      console.log(`  ✅ ${p.name}（${extractDistrict(addr)}）★${p.rating || '-'}`);
    }
    console.log(`   本頁新增 ${newCount} 間\n`);

    pageToken = data.next_page_token || null;
    page++;
  } while (pageToken && page <= 3); // 最多 3 頁 = 60 筆

  if (results.length === 0) {
    console.log('✨ 沒有新店家需要新增');
    return;
  }

  // 輸出到 scripts/output/
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
  const outFile = path.join(outputDir, `${QUERY.replace(/\s/g, '_')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');

  console.log(`\n✅ 找到 ${results.length} 間新店家`);
  console.log(`📁 已存到：${outFile}`);
  console.log(`\n⚠️  注意：hours/closedDay/specialty/desc 為預設值，建議人工補充後再 merge`);
  console.log(`\n合併指令：`);
  console.log(`  node scripts/merge_places.js "${QUERY.replace(/\s/g, '_')}"`);
}

main().catch(err => {
  console.error('❌ 錯誤：', err.message);
  process.exit(1);
});
