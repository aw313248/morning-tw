// ── MORNING TW — 夭獸 AI 早餐助手 ──

const PREF_KEY = 'mw_ai_pref';
function loadPref() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } }
function savePref(u) { localStorage.setItem(PREF_KEY, JSON.stringify({ ...loadPref(), ...u, updatedAt: Date.now() })); }

// 每種類型的菜名池（隨機抽）
const DISH_POOL = {
  egg:      ['手工粉漿蛋餅', '酥脆古早味蛋餅', '厚切蔥蛋餅', '傳統炒蛋餅', '煎蛋餅'],
  rice:     ['紫米肉鬆飯糰', '鹹蛋飯糰', '五穀飯糰', '傳統飯糰', '炸物飯糰'],
  soup:     ['現熬廣東粥', '菜頭粿湯', '清燉米粉湯', '台式鹹粥', '滷味粥'],
  local:    ['古早味肉圓', '炒麵肉燥飯', '嘉義米糕', '紅燒肉', '碗粿'],
  drink:    ['現磨鹹豆漿', '甜豆漿油條', '杏仁豆漿'],
  western:  ['碳烤土司', '越南法棍麵包', '帕里尼三明治', '蔥抓餅', '蜂蜜奶油土司'],
};

function randDishName(types) {
  const t = (types || ['egg'])[0];
  const pool = DISH_POOL[t] || DISH_POOL.egg;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 夭獸台詞庫 ──
const YAO_LINES = {
  greet: [
    ['你好！我是夭獸 🦁', '超餓的！', '現在幫你找台中最想吃的早餐～'],
    ['哦！有人要吃早餐了！', '太好了！我是夭獸 🦁', '快告訴我你有多餓？'],
  ],
  greet_return: [
    ['你回來了！🦁 夭獸好高興！', '上次你選了不錯的早餐，這次要換個口味嗎？'],
  ],
  hunger_light: ['輕食嘛～', '夭獸覺得也很好吃！'],
  hunger_medium: ['普通份量正好！', '夭獸也這樣！'],
  hunger_full: ['哦！要吃超飽！🦁', '夭獸最喜歡這種決心了！'],
  dish_ask: [
    ['好了！現在最重要的問題 👇', '哪一個看起來最想咬一口？'],
    ['夭獸精選菜單出現！🦁', '哪個讓你流口水了？'],
    ['看！這些都是今天的選擇！', '哪一個最打動你的胃？'],
  ],
  result: [
    (name) => [`找到了！就是${name}！🦁`, '夭獸保證這間值得！'],
    (name) => [`${name}！絕對沒錯！`, '夭獸用肚子保證！🦁'],
  ],
};

function randLine(arr) {
  return Array.isArray(arr[0]) ? arr[Math.floor(Math.random() * arr.length)] : arr;
}

// ── 推薦引擎 ──
function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (lat2-lat1)*d2r, dLng = (lng2-lng1)*d2r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*d2r)*Math.cos(lat2*d2r)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function recommend(targetType, hunger, shops, userLat, userLng) {
  let pool = [...shops];
  if (targetType) {
    const matched = pool.filter(s => s.types?.includes(targetType));
    if (matched.length >= 3) pool = matched;
  }
  if (hunger === 'light') {
    const f = pool.filter(s => s.category === 'western' || s.types?.includes('egg'));
    if (f.length >= 3) pool = f;
  }
  if (userLat && userLng) {
    pool = pool.map(s => ({ ...s, _dist: distKm(userLat, userLng, s.lat, s.lng) }))
      .sort((a, b) => a._dist - b._dist);
  } else {
    pool = pool.sort((a, b) => (b.popularity || 5) - (a.popularity || 5));
  }
  return pool.slice(0, 3);
}

// 從資料庫隨機選出 5 間有照片的店，生成「今日誘惑菜單」
function generateDishOptions(shops) {
  let pool = shops.filter(s => s.photo);
  if (filterType) pool = pool.filter(s => s.types?.includes(filterType));
  // 優先選沒顯示過的
  const fresh = pool.filter(s => !shownShopIds.has(s.id));
  const src = fresh.length >= 4 ? fresh : pool; // 不夠時放寬
  const shuffled = [...src].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 4);
  picked.forEach(s => shownShopIds.add(s.id));
  return picked.map(shop => ({
    shop,
    dishName: randDishName(shop.types),
    value: shop.types?.[0] || 'egg',
  }));
}

// ── STATE ──
let chatEl, optionsEl, progressBar;
let hunger = null, allShops = [], userLat = null, userLng = null;
let dishOptions = [], shownShopIds = new Set(), filterType = null;

async function ensureShops() {
  if (allShops.length) return;
  allShops = window._morningTWData || [];
  if (!allShops.length) {
    try { const r = await fetch('/data/breakfasts.json'); allShops = await r.json(); } catch {}
  }
}

function getUserLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null), { timeout: 4000, maximumAge: 60000 }
    );
  });
}

// ── 夭獸表情控制 ──
function setMood(mood) {
  const avatar = document.getElementById('yaoshou-avatar');
  if (!avatar) return;
  avatar.className = 'yaoshou-avatar yaoshou--' + mood;
}

// ── Chat UI ──
function typingBubble(text, delay = 0) {
  return new Promise(resolve => {
    setTimeout(() => {
      const b = document.createElement('div');
      b.className = 'ai-bubble ai-bubble--bot ai-bubble--typing';
      b.innerHTML = '<span></span><span></span><span></span>';
      chatEl.appendChild(b); scrollChat();
      setTimeout(() => {
        b.className = 'ai-bubble ai-bubble--bot';
        b.textContent = text; scrollChat(); resolve();
      }, 600 + text.length * 12);
    }, delay);
  });
}

function userBubble(text) {
  const b = document.createElement('div');
  b.className = 'ai-bubble ai-bubble--user';
  b.textContent = text;
  chatEl.appendChild(b); scrollChat();
}

function scrollChat() { chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' }); }

function setProgress(pct) {
  if (progressBar) progressBar.style.width = pct + '%';
}

// ── Step 1: 飽足感 ──
async function showHungerStep() {
  setMood('happy');
  setProgress(10);
  const pref = loadPref();
  const lines = pref.hunger ? randLine(YAO_LINES.greet_return) : randLine(YAO_LINES.greet);
  for (let i = 0; i < lines.length; i++) await typingBubble(lines[i], i * 80);

  optionsEl.innerHTML = '';
  const opts = [
    { label: '🌿 小餓一下', sub: 'Light snack', value: 'light', bg: '#E8F5E9' },
    { label: '🍽️ 普通份量', sub: 'Regular meal', value: 'medium', bg: '#FFF8E1' },
    { label: '💪 超餓！全力以赴', sub: 'Full meal, bring it!', value: 'full', bg: '#FCE4EC' },
  ];
  opts.forEach((opt, i) => {
    const el = document.createElement('button');
    el.className = 'ai-opt-card';
    el.style.background = opt.bg;
    el.style.animationDelay = `${i * 0.09}s`;
    el.innerHTML = `<span class="ai-opt-card__label">${opt.label}</span><span class="ai-opt-card__sub">${opt.sub}</span>`;
    el.addEventListener('click', () => pickHunger(opt));
    optionsEl.appendChild(el);
    requestAnimationFrame(() => el.classList.add('ai-opt--in'));
  });
}

async function pickHunger(opt) {
  hunger = opt.value;
  savePref({ hunger: opt.value });
  disableOptions();
  userBubble(opt.label.replace(/^[^\s]+ /, ''));
  setMood(opt.value === 'full' ? 'excited' : 'happy');

  const reaction = YAO_LINES['hunger_' + opt.value];
  await new Promise(r => setTimeout(r, 200));
  optionsEl.innerHTML = '';
  await showDishStep();
}

// ── Step 2: 餐點視覺誘惑 ──
async function showDishStep() {
  setProgress(50);
  shownShopIds.clear();
  filterType = null;
  dishOptions = generateDishOptions(allShops);
  const lines = randLine(YAO_LINES.dish_ask);
  for (let i = 0; i < lines.length; i++) await typingBubble(lines[i], i * 100);
  renderDishGrid();
}

function renderDishGrid(isRefresh = false) {
  optionsEl.innerHTML = '';

  // 類型快速篩選列
  const typeRow = document.createElement('div');
  typeRow.className = 'ai-type-row';
  const types = [
    { label: '全部', value: null },
    { label: '🥚 蛋餅', value: 'egg' },
    { label: '🍙 飯糰', value: 'rice' },
    { label: '🥙 燒餅', value: 'bread' },
    { label: '🍲 湯品', value: 'soup' },
    { label: '🥐 西式', value: 'western' },
  ];
  types.forEach(t => {
    const chip = document.createElement('button');
    chip.className = 'ai-type-chip' + (filterType === t.value ? ' ai-type-chip--active' : '');
    chip.textContent = t.label;
    chip.addEventListener('click', () => {
      filterType = t.value;
      dishOptions = generateDishOptions(allShops);
      renderDishGrid(true);
    });
    typeRow.appendChild(chip);
  });
  optionsEl.appendChild(typeRow);

  // 圖片 grid
  const grid = document.createElement('div');
  grid.className = 'ai-dish-grid';

  dishOptions.forEach((item, i) => {
    const el = document.createElement('button');
    el.className = 'ai-dish-card' + (isRefresh ? ' ai-dish-card--refresh' : '');
    el.style.animationDelay = `${i * 0.07}s`;
    el.innerHTML = `
      <div class="ai-dish-card__thumb">
        <img src="${item.shop.photo}" alt="${item.dishName}" loading="lazy">
        <div class="ai-dish-card__overlay"></div>
      </div>
      <div class="ai-dish-card__info">
        <div class="ai-dish-card__dish">${item.dishName}</div>
        <div class="ai-dish-card__shop">${item.shop.name}</div>
      </div>
    `;
    el.addEventListener('click', () => pickDish(item));
    grid.appendChild(el);
    requestAnimationFrame(() => el.classList.add('ai-opt--in'));
  });

  optionsEl.appendChild(grid);

  // 底部行動列
  const actions = document.createElement('div');
  actions.className = 'ai-dish-actions';

  const next = document.createElement('button');
  next.className = 'ai-next-batch';
  next.innerHTML = '🔄 換一批';
  next.addEventListener('click', () => {
    dishOptions = generateDishOptions(allShops);
    renderDishGrid(true);
  });

  const surprise = document.createElement('button');
  surprise.className = 'ai-surprise-btn';
  surprise.innerHTML = '🦁 夭獸幫我決定';
  surprise.addEventListener('click', () => pickDish(null));

  actions.appendChild(next);
  actions.appendChild(surprise);
  optionsEl.appendChild(actions);
}

async function pickDish(item) {
  disableOptions();
  setMood('excited');
  if (item) {
    userBubble(`${item.dishName}！`);
    savePref({ lastDishType: item.value, lastDishName: item.dishName });
  } else {
    userBubble('夭獸幫我決定！');
  }

  await new Promise(r => setTimeout(r, 220));
  optionsEl.innerHTML = '';
  await showResults(item);
}

// ── 結果 ──
function fmtDist(shop) {
  if (!userLat || !shop._dist) return '';
  const km = shop._dist * 1.35;
  return km < 0.3 ? `步行 ${Math.round(km/5*60)} 分` : `騎車 ${Math.round(km/13*60)} 分`;
}

async function showResults(chosenDish) {
  setProgress(100);
  const targetType = chosenDish?.value || null;
  const results = recommend(targetType, hunger, allShops, userLat, userLng);
  const topName = results[0]?.name || '這間';

  const resultLine = YAO_LINES.result[Math.floor(Math.random() * YAO_LINES.result.length)](topName);
  await typingBubble(resultLine[0], 0);
  await typingBubble(resultLine[1], 200);
  await new Promise(r => setTimeout(r, 150));

  const scroll = document.createElement('div');
  scroll.className = 'ai-results-scroll';

  results.forEach((shop, i) => {
    const dist = fmtDist(shop);
    const card = document.createElement('div');
    card.className = 'ai-res-card';
    card.style.animationDelay = `${i * 0.14}s`;
    card.innerHTML = `
      <div class="ai-res-card__thumb">
        ${shop.photo ? `<img src="${shop.photo}" alt="${shop.name}" loading="lazy">` : `<div class="ai-res-card__emoji">${shop.icon}</div>`}
        ${i === 0 ? '<span class="ai-res-card__badge">🦁 夭獸推薦</span>' : ''}
      </div>
      <div class="ai-res-card__body">
        <div class="ai-res-card__name">${shop.name}</div>
        ${shop.nameEn ? `<div class="ai-res-card__en">${shop.nameEn}</div>` : ''}
        ${shop.hook ? `<p class="ai-res-card__hook">${shop.hook}</p>` : ''}
        <div class="ai-res-card__meta">
          <span>${shop.district}</span>
          ${dist ? `<span class="ai-res-card__dist">🚴 ${dist}</span>` : ''}
        </div>
        <button class="ai-res-card__cta">查看詳情 →</button>
      </div>
    `;
    card.querySelector('.ai-res-card__cta').addEventListener('click', () => {
      savePref({ lastClicked: shop.id, lastClickedAt: Date.now() });
      window.dispatchEvent(new CustomEvent('ai:openShop', { detail: shop.id }));
      closePanel();
    });
    scroll.appendChild(card);
  });

  chatEl.appendChild(scroll);
  scrollChat();
  optionsEl.innerHTML = '';

  const restart = document.createElement('button');
  restart.className = 'ai-restart';
  restart.textContent = '↩ 重新選';
  restart.addEventListener('click', startFlow);
  optionsEl.appendChild(restart);

  spawnSparkles();
  setMood('celebrate');
}

// ── utils ──
function disableOptions() {
  optionsEl.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '0.45'; });
}

function spawnSparkles() {
  const panel = document.querySelector('.ai-pick-panel');
  if (!panel) return;
  ['✨','⭐','🌟','💛','🦁'].forEach((ch, i) => {
    const s = document.createElement('div');
    s.className = 'ai-sparkle';
    s.style.cssText = `left:${15+i*18}%;top:${20+Math.random()*20}%;animation-delay:${i*0.1}s;font-size:${14+Math.random()*8}px;`;
    s.textContent = ch;
    panel.appendChild(s);
    setTimeout(() => s.remove(), 1800);
  });
}

// ── FLOW ──
async function startFlow() {
  hunger = null;
  chatEl.innerHTML = ''; optionsEl.innerHTML = '';
  setProgress(0); setMood('happy');
  await ensureShops();
  getUserLocation().then(loc => { if (loc) { userLat = loc.lat; userLng = loc.lng; } });
  showHungerStep();
}

function openPanel() {
  document.getElementById('ai-pick-overlay').setAttribute('aria-hidden', 'false');
  document.getElementById('ai-pick-overlay').classList.add('ai-pick-overlay--open');
  document.body.style.overflow = 'hidden';
  startFlow();
}

function closePanel() {
  document.getElementById('ai-pick-overlay').classList.remove('ai-pick-overlay--open');
  document.getElementById('ai-pick-overlay').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

document.addEventListener('DOMContentLoaded', () => {
  chatEl = document.getElementById('ai-pick-chat');
  optionsEl = document.getElementById('ai-pick-options');
  progressBar = document.getElementById('ai-progress-bar');

  document.getElementById('btn-ai-pick').addEventListener('click', openPanel);
  document.getElementById('btn-ai-close').addEventListener('click', closePanel);
  document.getElementById('ai-pick-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closePanel();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
  window.addEventListener('morning:dataLoaded', e => { allShops = e.detail; });
});
