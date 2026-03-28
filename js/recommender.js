// ── MORNING TW — 夭獸 AI 早餐助手 (Tinder Edition) ──

const PREF_KEY = 'mw_ai_pref';
function loadPref() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } }
function savePref(u) { localStorage.setItem(PREF_KEY, JSON.stringify({ ...loadPref(), ...u, updatedAt: Date.now() })); }

// ── 夭獸台詞庫 ──
const YAO_LINES = {
  greet: [
    ['你好！我是夭獸 🦁', '超餓的！', '現在幫你找台中最想吃的早餐～'],
    ['哦！有人要吃早餐了！', '太好了！我是夭獸 🦁', '快告訴我你有多餓？'],
  ],
  greet_return: [
    ['你回來了！🥰 夭獸歡喜～', '上次你選了不錯的早餐，這次要換個口味嗎？'],
  ],
  tinder_intro: [
    ['好！現在來玩滑牌！🦁', '右滑 ❤️ 想去，左滑 ✕ 跳過', '選完夭獸幫你決定！'],
    ['精選店家出現了！', '看到喜歡的往右滑！', '一起找到今天的早餐 🦁'],
  ],
  result: [
    (name) => [`找到了！就是${name}！🦁`, '夭獸保證這間值得！'],
    (name) => [`${name}！絕對沒錯！`, '夭獸用肚子保證！🦁'],
  ],
  no_like: ['一間都沒心動嗎？！', '夭獸親自幫你決定好了 🦁'],
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
  let pool = [...shops].filter(s => !s.chain);
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

// ── STATE ──
let chatEl, optionsEl, progressBar;
let hunger = null, allShops = [], userLat = null, userLng = null;

// Tinder state
let tinderPool = [], tinderIdx = 0, tinderLiked = [];
let dragState = null, dragStartX = 0, dragCurrentX = 0;

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

  await new Promise(r => setTimeout(r, 200));
  optionsEl.innerHTML = '';
  await showTinderStep();
}

// ── Step 2: Tinder 滑牌 ──
async function showTinderStep() {
  setProgress(45);
  const lines = randLine(YAO_LINES.tinder_intro);
  for (let i = 0; i < lines.length; i++) await typingBubble(lines[i], i * 100);

  await ensureShops();

  // Build pool: prefer matching hunger type, with photos, non-chain
  let pool = allShops.filter(s => s.photo && !s.chain);
  if (hunger === 'light') {
    const f = pool.filter(s => s.category === 'western' || s.types?.includes('egg'));
    if (f.length >= 5) pool = f;
  }
  // Shuffle
  pool = pool.sort(() => Math.random() - 0.5).slice(0, 8);

  tinderPool = pool;
  tinderIdx = 0;
  tinderLiked = [];

  renderTinderStack();
}

// ── Tinder Stack ──
function renderTinderStack() {
  optionsEl.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'tinder-wrapper';

  // Progress bar + counter
  const header = document.createElement('div');
  header.className = 'tinder-header';
  header.innerHTML = `
    <span class="tinder-header__hint">右滑 ❤️ 想去 · 左滑 ✕ 跳過</span>
    <span class="tinder-header__count"><span id="tinder-liked-count">0</span> 間想去</span>
  `;
  wrapper.appendChild(header);

  // Stack
  const stack = document.createElement('div');
  stack.className = 'tinder-stack';
  stack.id = 'tinder-stack';

  // Render cards bottom→top so top card is last in DOM (highest z-index via CSS)
  [...tinderPool].reverse().forEach((shop, revIdx) => {
    const idx = tinderPool.length - 1 - revIdx;
    const card = buildTinderCard(shop, idx);
    stack.appendChild(card);
  });

  wrapper.appendChild(stack);

  // Action buttons
  const btns = document.createElement('div');
  btns.className = 'tinder-btns';
  btns.innerHTML = `
    <button class="tinder-btn tinder-btn--nope" id="tinder-nope" title="跳過">✕</button>
    <button class="tinder-btn tinder-btn--surprise" id="tinder-surprise" title="夭獸決定">🦁</button>
    <button class="tinder-btn tinder-btn--like" id="tinder-like" title="想去">❤️</button>
  `;
  wrapper.appendChild(btns);

  optionsEl.appendChild(wrapper);

  document.getElementById('tinder-nope')?.addEventListener('click', () => swipeCard('left'));
  document.getElementById('tinder-like')?.addEventListener('click', () => swipeCard('right'));
  document.getElementById('tinder-surprise')?.addEventListener('click', () => finishTinder(true));

  updateStackVisual();
  initCardDrag();
}

function buildTinderCard(shop, idx) {
  const card = document.createElement('div');
  card.className = 'tinder-card';
  card.dataset.idx = idx;
  card.innerHTML = `
    <div class="tinder-card__img">
      ${shop.photo
        ? `<img src="${shop.photo}" alt="${shop.name}" loading="lazy" draggable="false">`
        : `<div class="tinder-card__img-placeholder">${shop.icon || '🍳'}</div>`
      }
    </div>
    <div class="tinder-card__gradient"></div>
    <div class="tinder-card__like-stamp">LIKE ❤️</div>
    <div class="tinder-card__nope-stamp">NOPE ✕</div>
    <div class="tinder-card__info">
      <div class="tinder-card__name">${shop.name}</div>
      ${shop.nameEn ? `<div class="tinder-card__en">${shop.nameEn}</div>` : ''}
      <div class="tinder-card__meta">📍 ${shop.district}　✨ ${shop.specialty || shop.types?.[0] || ''}</div>
      <div class="tinder-card__price-row">
        <span class="tinder-card__price">💰 均消 NT$${shop.price || '?'}</span>
        <span class="tinder-card__hours">${shop.hours || ''}</span>
      </div>
    </div>
  `;
  return card;
}

function updateStackVisual() {
  const stack = document.getElementById('tinder-stack');
  if (!stack) return;
  const cards = Array.from(stack.querySelectorAll('.tinder-card:not(.tinder-card--gone)'));
  // cards[0] is the bottom of visible stack, last is front
  const front = cards.findLast(c => parseInt(c.dataset.idx) === tinderIdx);
  if (!front) return;

  cards.forEach(card => {
    const cardIdx = parseInt(card.dataset.idx);
    const depth = cardIdx - tinderIdx; // 0 = front, 1 = next, etc.
    if (depth < 0) return;
    const scale = 1 - depth * 0.04;
    const translateY = depth * 8;
    const rotate = depth === 0 ? 0 : (depth % 2 === 0 ? -1 : 1) * depth * 1.2;
    card.style.transition = 'transform 0.3s ease';
    card.style.transform = `translateY(${translateY}px) scale(${scale}) rotate(${rotate}deg)`;
    card.style.zIndex = 20 - depth;
    card.style.opacity = depth > 2 ? '0' : '1';
  });
}

function swipeCard(direction) {
  const stack = document.getElementById('tinder-stack');
  if (!stack) return;
  const card = stack.querySelector(`.tinder-card[data-idx="${tinderIdx}"]`);
  if (!card) return;

  const shop = tinderPool[tinderIdx];

  // Show stamp
  const like = card.querySelector('.tinder-card__like-stamp');
  const nope = card.querySelector('.tinder-card__nope-stamp');
  if (direction === 'right' && like) like.style.opacity = '1';
  if (direction === 'left'  && nope) nope.style.opacity = '1';

  // Fly animation
  card.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.45s';
  card.style.transform = direction === 'right'
    ? 'translateX(140%) rotate(20deg)'
    : 'translateX(-140%) rotate(-20deg)';
  card.style.opacity = '0';
  card.classList.add('tinder-card--gone');

  if (direction === 'right') {
    tinderLiked.push(shop);
    const counter = document.getElementById('tinder-liked-count');
    if (counter) counter.textContent = tinderLiked.length;
  }

  tinderIdx++;
  setTimeout(() => updateStackVisual(), 50);

  // End conditions
  const remaining = tinderPool.length - tinderIdx;
  if (remaining <= 0 || tinderLiked.length >= 5) {
    setTimeout(() => finishTinder(false), 500);
  }
}

async function finishTinder(isSurprise) {
  disableOptions();
  setMood('excited');
  setProgress(80);

  if (isSurprise || tinderLiked.length === 0) {
    userBubble('夭獸幫我決定！🦁');
    await typingBubble('交給夭獸了！馬上幫你選！', 0);
    setTimeout(() => showResults(null), 500);
    return;
  }

  userBubble(`選了 ${tinderLiked.length} 間 ❤️`);
  const topType = tinderLiked[0].types?.[0] || null;
  await typingBubble(`夭獸幫你從 ${tinderLiked.length} 間裡挑最適合的！🦁`, 0);
  setTimeout(() => showResults({ value: topType, likedShops: tinderLiked }), 500);
}

// ── 結果 ──
function fmtDist(shop) {
  if (!userLat || !shop._dist) return '';
  const km = shop._dist * 1.35;
  return km < 0.3 ? `步行 ${Math.round(km/5*60)} 分` : `騎車 ${Math.round(km/13*60)} 分`;
}

async function showResults(choice) {
  setProgress(100);

  let resultPool;
  if (choice?.likedShops?.length) {
    // Sort liked shops by distance if available, else popularity
    resultPool = choice.likedShops.map(s =>
      (userLat && s.lat) ? { ...s, _dist: distKm(userLat, userLng, s.lat, s.lng) } : s
    ).sort((a, b) => a._dist != null && b._dist != null ? a._dist - b._dist : (b.popularity||5)-(a.popularity||5));
  } else {
    resultPool = recommend(choice?.value || null, hunger, allShops, userLat, userLng);
  }

  const results = resultPool.slice(0, 3);
  const topName = results[0]?.name || '這間';
  const resultLine = YAO_LINES.result[Math.floor(Math.random() * YAO_LINES.result.length)](topName);
  await typingBubble(resultLine[0], 0);
  await typingBubble(resultLine[1], 250);
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

// ── 拖曳 / Touch ──
function initCardDrag() {
  const stack = document.getElementById('tinder-stack');
  if (!stack) return;

  const getTopCard = () => stack.querySelector(`.tinder-card[data-idx="${tinderIdx}"]`);

  const onStart = (x) => {
    const card = getTopCard();
    if (!card) return;
    dragStartX = x;
    dragCurrentX = 0;
    dragState = 'dragging';
    card.style.transition = 'none';
  };

  const onMove = (x) => {
    if (dragState !== 'dragging') return;
    const card = getTopCard();
    if (!card) return;
    dragCurrentX = x - dragStartX;
    const rot = dragCurrentX * 0.07;
    card.style.transform = `translateX(${dragCurrentX}px) rotate(${rot}deg)`;

    const like = card.querySelector('.tinder-card__like-stamp');
    const nope = card.querySelector('.tinder-card__nope-stamp');
    if (like) like.style.opacity = Math.min(1, Math.max(0, dragCurrentX / 70)).toString();
    if (nope) nope.style.opacity = Math.min(1, Math.max(0, -dragCurrentX / 70)).toString();
  };

  const onEnd = () => {
    if (dragState !== 'dragging') return;
    dragState = null;
    const card = getTopCard();
    if (!card) return;

    if (dragCurrentX > 60) {
      swipeCard('right');
    } else if (dragCurrentX < -60) {
      swipeCard('left');
    } else {
      // Snap back
      card.style.transition = 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)';
      card.style.transform = 'none';
      const like = card.querySelector('.tinder-card__like-stamp');
      const nope = card.querySelector('.tinder-card__nope-stamp');
      if (like) like.style.opacity = '0';
      if (nope) nope.style.opacity = '0';
    }
  };

  stack.addEventListener('touchstart', e => onStart(e.touches[0].clientX), { passive: true });
  stack.addEventListener('touchmove',  e => onMove(e.touches[0].clientX),  { passive: true });
  stack.addEventListener('touchend',   () => onEnd());

  stack.addEventListener('mousedown', e => { e.preventDefault(); onStart(e.clientX); });
  document.addEventListener('mousemove', e => { if (dragState === 'dragging') onMove(e.clientX); });
  document.addEventListener('mouseup',   () => { if (dragState === 'dragging') onEnd(); });
}

// ── Utils ──
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
  tinderLiked = []; tinderIdx = 0;
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
