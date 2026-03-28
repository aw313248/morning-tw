#!/usr/bin/env node
/**
 * MORNING TW — Google Places Photo Fetcher
 *
 * 用法：
 *   node scripts/fetch_photos.js YOUR_GOOGLE_API_KEY
 *
 * 做什麼：
 *   1. 讀取 data/breakfasts.json
 *   2. 對每間還沒有 photo 的店，用 Places Text Search 找 place_id
 *   3. 用 Places Details 拿 photo_reference
 *   4. 下載照片到 photos/tc001.jpg 等
 *   5. 更新 breakfasts.json 的 photo 欄位
 *
 * Google API key 設定：
 *   https://console.cloud.google.com/apis/credentials
 *   需開啟：Places API (New) 或 Maps JavaScript API + Places API
 *   建議限制：HTTP referrers → morning-tw.vercel.app/*
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.argv[2];
if (!API_KEY) {
  console.error('Usage: node scripts/fetch_photos.js YOUR_GOOGLE_API_KEY');
  process.exit(1);
}

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const DATA_PATH  = path.join(__dirname, '../data/breakfasts.json');
const PHOTO_DIR  = path.join(__dirname, '../photos');

if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR);

// ─── HTTP helpers ───────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body));
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length, ...headers }
    };
    const req = https.request(url, opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ─── Places API (New) ───────────────────────────────────────
async function searchPlace(shop) {
  const query = `${shop.name} ${shop.address}`;
  const res = await httpsPost(
    PLACES_URL,
    { 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': 'places.id,places.photos' },
    { textQuery: query, locationBias: { circle: { center: { latitude: shop.lat, longitude: shop.lng }, radius: 500 } } }
  );
  const data = JSON.parse(res.body);
  if (!data.places?.length) return null;
  const place = data.places[0];
  if (!place.photos?.length) return null;
  // photo name format: "places/PLACE_ID/photos/PHOTO_REF"
  return place.photos[0].name;
}

// ─── Download photo ─────────────────────────────────────────
async function downloadPhoto(photoName, outputPath) {
  // Places API (New) media URL
  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=600&key=${API_KEY}`;
  let res = await httpsGet(url);

  // Follow redirects (up to 5)
  let redirects = 0;
  while ((res.status === 301 || res.status === 302 || res.status === 307) && res.headers.location && redirects < 5) {
    res = await httpsGet(res.headers.location);
    redirects++;
  }

  if (res.status !== 200) throw new Error(`Photo download failed: ${res.status}`);

  // Detect format from content-type
  const ct = (res.headers['content-type'] || '').toLowerCase();
  const ext = ct.includes('jpeg') || ct.includes('jpg') ? '.jpg' : ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
  const finalPath = outputPath.replace(/\.[^.]+$/, ext);

  fs.writeFileSync(finalPath, res.body);
  return finalPath;
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  const shops = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let updated = 0;

  for (const shop of shops) {
    if (shop.photo) {
      console.log(`⏭  ${shop.id} ${shop.name} — already has photo`);
      continue;
    }

    process.stdout.write(`🔍 ${shop.id} ${shop.name} … `);
    try {
      const photoName = await searchPlace(shop);
      if (!photoName) {
        console.log('no photo found');
        continue;
      }

      const tmpPath = path.join(PHOTO_DIR, shop.id + '.jpg');
      const finalPath = await downloadPhoto(photoName, tmpPath);
      const relativePath = '/photos/' + path.basename(finalPath);
      shop.photo = relativePath;
      updated++;
      console.log(`✅  saved → ${relativePath}`);
    } catch (e) {
      console.log(`❌  error: ${e.message}`);
    }

    // Polite rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(shops, null, 2));
  console.log(`\n✅  Done — ${updated} photos added.`);
}

main().catch(e => { console.error(e); process.exit(1); });
