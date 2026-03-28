#!/usr/bin/env node
/**
 * merge_places.js
 * 把 scripts/output/<name>.json 合併進 data/breakfasts.json
 *
 * 使用方式：
 *   node scripts/merge_places.js "早安有喜"
 *   node scripts/merge_places.js all          ← 合併 output/ 裡所有檔案
 */

const fs   = require('fs');
const path = require('path');

const arg      = process.argv[2];
const dataPath = path.join(__dirname, '../data/breakfasts.json');
const outDir   = path.join(__dirname, 'output');

if (!arg) {
  console.error('用法：node scripts/merge_places.js "搜尋詞" 或 all');
  process.exit(1);
}

let files = [];
if (arg === 'all') {
  files = fs.readdirSync(outDir).filter(f => f.endsWith('.json'));
} else {
  const fname = `${arg.replace(/\s/g, '_')}.json`;
  if (!fs.existsSync(path.join(outDir, fname))) {
    console.error(`❌ 找不到 output/${fname}，請先執行 fetch_places.js`);
    process.exit(1);
  }
  files = [fname];
}

const existing   = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const existingNames = new Set(existing.map(s => s.name));
let added = 0;

for (const f of files) {
  const newShops = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
  for (const shop of newShops) {
    if (existingNames.has(shop.name)) {
      console.log(`⏭  跳過（已存在）：${shop.name}`);
      continue;
    }
    existing.push(shop);
    existingNames.add(shop.name);
    console.log(`✅ 新增：${shop.name}（${shop.district}）`);
    added++;
  }
}

fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2), 'utf8');
console.log(`\n✅ 完成！新增 ${added} 間，目前共 ${existing.length} 間店`);
