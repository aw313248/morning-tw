#!/usr/bin/env node
/**
 * fetch_photos.js — 自動為沒有照片的店家從 Google Places 下載照片
 *
 * 使用方式：
 *   GOOGLE_PLACES_API_KEY=AIza... node scripts/fetch_photos.js
 *   GOOGLE_PLACES_API_KEY=AIza... node scripts/fetch_photos.js tc086
 */

const https   = require('https');
const fs      = require('fs');
const path    = require('path');

const API_KEY   = process.env.GOOGLE_PLACES_API_KEY;
const TARGET_ID = process.argv[2];
const DATA_PATH = path.join(__dirname, '../data/breakfasts.json');
const PHOTO_DIR = path.join(__dirname, '../photos');

if (!API_KEY) { console.error('❌ 請設定 GOOGLE_PLACES_API_KEY'); process.exit(1); }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlink(dest, () => {});
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR);

  let shops = data.filter(s => !s.photo && !s.chain);
  if (TARGET_ID) shops = shops.filter(s => s.id === TARGET_ID);
  console.log(`\n📷 補照片：${shops.length} 間\n`);

  let updated = 0;
  for (const shop of shops) {
    console.log(`🔍 ${shop.id} ${shop.name}`);
    try {
      const q   = encodeURIComponent(`${shop.name} ${shop.address}`);
      const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${q}&inputtype=textquery&fields=place_id,photos&language=zh-TW&key=${API_KEY}`;
      const res = await fetchJson(url);
      if (res.status !== 'OK' || !res.candidates?.length) { console.log('   ⚠️  找不到'); await sleep(400); continue; }
      const photos = res.candidates[0].photos;
      if (!photos?.length) { console.log('   ⚠️  無照片'); await sleep(400); continue; }

      const ref  = photos[0].photo_reference;
      const dest = path.join(PHOTO_DIR, `${shop.id}.jpg`);
      const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${API_KEY}`;
      await downloadFile(photoUrl, dest);
      data.find(s => s.id === shop.id).photo = `/photos/${shop.id}.jpg`;
      console.log(`   ✅ photos/${shop.id}.jpg`);
      updated++;
    } catch(err) { console.log(`   ❌ ${err.message}`); }
    await sleep(300);
  }

  if (updated) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
    console.log(`\n✅ 共更新 ${updated} 間，執行 git add photos/ data/breakfasts.json && git push`);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
