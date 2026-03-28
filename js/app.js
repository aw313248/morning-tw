// ── MORNING TW — App ──
import { initMap, renderMarkers, focusShop, resetView, invalidateSize } from './map.js';
import { initAuth, onAuthChange, loginWithGoogle, logout, getUser } from './auth.js';

// Supabase 懶加載，不阻塞主程式
let _supabase = null;
async function getSupabase() {
  if (_supabase) return _supabase;
  try {
    _supabase = await import('./supabase.js');
  } catch(e) {
    console.warn('Supabase 載入失敗，留言板暫時停用', e);
    _supabase = {
      fetchComments: async () => [],
      addComment: async () => { throw new Error('offline'); },
      loadFavsCloud: async () => [],
      saveFavsCloud: async () => {},
    };
  }
  return _supabase;
}
async function fetchComments(id) { return (await getSupabase()).fetchComments(id); }
async function addComment(payload) { return (await getSupabase()).addComment(payload); }
async function loadFavsCloud(uid) { return (await getSupabase()).loadFavsCloud(uid); }
async function saveFavsCloud(uid, ids) { return (await getSupabase()).saveFavsCloud(uid, ids); }
async function submitClaim(payload) { return (await getSupabase()).submitClaim(payload); }
async function fetchAllRatings() {
  try { return (await getSupabase()).fetchAllRatings(); } catch { return {}; }
}

const TYPE_LABELS = {
  egg:         { label: '蛋餅',   icon: '🍳', cls: 'tag--egg' },
  rice:        { label: '飯糰',   icon: '🍙', cls: 'tag--rice' },
  soup:        { label: '湯品',   icon: '🥣', cls: 'tag--soup' },
  local:       { label: '在地',   icon: '🏮', cls: 'tag--local' },
  drink:       { label: '豆漿',   icon: '☕', cls: 'tag--drink' },
  traditional: { label: '傳統',   icon: '🍳', cls: 'tag--egg' },
  western:     { label: '西式',   icon: '🥐', cls: 'tag--local' },
};

// ── HAVERSINE ──
function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
// 直線距離 × 道路修正係數（台中市區約 1.35）
const ROAD_FACTOR = 1.35;
const TRAVEL_MODES = {
  walk:    { kmh: 4.5,  icon: '🚶', label: '走路' },
  scooter: { kmh: 13,   icon: '🛵', label: '機車' },
  car:     { kmh: 22,   icon: '🚗', label: '開車' },
};
let travelMode = localStorage.getItem('mw_travel_mode') || 'scooter';

function fmtDist(straightKm) {
  const km = straightKm * ROAD_FACTOR;
  const mode = TRAVEL_MODES[travelMode];
  const min = Math.round(km / mode.kmh * 60);
  const mLabel = mode.label;
  const mIcon = mode.icon;
  if (km < 0.12) return `${mIcon} ${mLabel}約 1 分鐘以內`;
  if (min <= 2) return `${mIcon} ${mLabel}約 ${min} 分鐘（${Math.round(km * 1000)} 公尺）`;
  return `${mIcon} ${mLabel}約 ${min} 分鐘`;
}

// ── STATE ──
let allData = [], filtered = [];
let activeType = 'all', activeDistrict = 'all', searchQuery = '';
let activeSort = 'popular';
let showOpenOnly = false;
let activeRadius = null; // null = 全部, 數字 = km
let userLat = null, userLng = null;
let favorites = JSON.parse(localStorage.getItem('mw_favs') || '[]');
let routeShops = []; // 路線規劃：選中的店家 IDs
let ratingsCache = {}; // shop_id → { avg, count }

// ── DOM ──
const listEl        = document.getElementById('breakfast-list');
const statsCount    = document.getElementById('stats-count');
const statsLabel    = document.getElementById('stats-label');
const searchInput   = document.getElementById('search-input');
const searchBtn     = document.getElementById('search-btn');
const typeChips     = document.getElementById('type-chips');
const districtChips = document.getElementById('district-chips');
const sortBar       = document.getElementById('sort-bar');
const btnLocate     = document.getElementById('btn-locate');
const btnOpenNow    = document.getElementById('btn-open-now');
const sheetOverlay  = document.getElementById('sheet-overlay');
const bottomSheet   = document.getElementById('bottom-sheet');

// ── INIT ──
(async () => {
  const res = await fetch('data/breakfasts.json');
  allData = await res.json();
  window._morningTWData = allData;
  window.dispatchEvent(new CustomEvent('morning:dataLoaded', { detail: allData }));
  const browseLink = document.querySelector('.hero__browse');
  if (browseLink) browseLink.textContent = `瀏覽全部 ${allData.length} 間早餐店 ↓`;

  buildDistrictCounts(allData);
  buildDailyPicks(allData);
  buildMarquee(allData);
  tryAutoLocate();
  setupEvents();
  initRouteFab();

  // Auth 初始化（延後，不阻塞首次渲染）
  setTimeout(async () => {
    await initAuth();
    onAuthChange(handleAuthChange);
  }, 100);

  // 評分懶加載（不阻塞首次渲染）
  setTimeout(async () => {
    ratingsCache = await fetchAllRatings();
    if (Object.keys(ratingsCache).length) renderList(filtered.length ? filtered : allData);
  }, 800);

  // 推播通知：收藏店家有開門時提醒
  setTimeout(() => initPushHint(), 3000);

  // AI recommender: 開啟店家 sheet
  window.addEventListener('ai:openShop', e => {
    const shop = allData.find(s => s.id === e.detail);
    if (shop) openSheet(shop);
  });
})();

// ── AUTH HANDLER ──
async function handleAuthChange(user) {
  updateNavAuth(user);
  if (user) {
    // 登入時：合併 localStorage 收藏 + 雲端收藏
    const cloud = await loadFavsCloud(user.id);
    const merged = [...new Set([...favorites, ...cloud])];
    favorites = merged;
    saveFavs();
    await saveFavsCloud(user.id, favorites);
    renderList(filtered.length ? filtered : allData);
  }
}

function updateNavAuth(user) {
  const navAuth = document.getElementById('nav-auth');
  if (!navAuth) return;
  if (user) {
    const avatar = user.user_metadata?.avatar_url;
    const name = user.user_metadata?.full_name || user.email || '會員';
    navAuth.innerHTML = `
      <button class="nav__avatar" id="btn-member" title="${name}" aria-label="會員資料">
        ${avatar
          ? `<img src="${avatar}" alt="${name}" class="nav__avatar-img">`
          : `<span class="nav__avatar-initial">${name[0]}</span>`
        }
      </button>`;
    document.getElementById('btn-member')?.addEventListener('click', () => openMemberPanel(user));
  } else {
    navAuth.innerHTML = `<button class="nav__login-btn" id="btn-login">登入</button>`;
    document.getElementById('btn-login')?.addEventListener('click', handleLogin);
  }
}

async function handleLogin() {
  const btn = document.getElementById('btn-login');
  if (btn) { btn.textContent = '連接中…'; btn.disabled = true; }
  try {
    await loginWithGoogle();
  } catch {
    if (btn) { btn.textContent = '登入'; btn.disabled = false; }
    showToast('登入失敗，請稍後再試');
  }
}

// ── FAVORITES ──
function saveFavs() { localStorage.setItem('mw_favs', JSON.stringify(favorites)); }
function isFav(id) { return favorites.includes(id); }
function toggleFav(id) {
  favorites = isFav(id) ? favorites.filter(x => x !== id) : [...favorites, id];
  saveFavs();
  const user = getUser();
  if (user) saveFavsCloud(user.id, favorites);
}

// ── AUTO LOCATE ──
function tryAutoLocate() {
  if (!navigator.geolocation) { applyFilters(); return; }
  // 安靜嘗試定位（不強迫 prompt，maximumAge 讓快取的位置直接使用）
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude; userLng = pos.coords.longitude;
      updateLocateBtn(true); applyFilters();
    },
    () => applyFilters(), // 拒絕或逾時 → 正常顯示全部
    { timeout: 4000, maximumAge: 300000 } // 5 分鐘快取
  );
  applyFilters(); // 先顯示全部，定位成功後再更新
}

function updateLocateBtn(located) {
  if (btnLocate) {
    btnLocate.textContent = located ? '📍 已定位' : '📍 找我附近的';
    btnLocate.classList.toggle('btn-locate--active', located);
  }
  const dot = document.getElementById('nearby-dot');
  const label = document.getElementById('nearby-loc-label');
  if (dot) dot.className = 'nearby-strip__dot' + (located ? ' nearby-strip__dot--located' : '');
  if (label) label.textContent = located ? '已定位 ✓' : '點選定位';
}

function setLocating(isLocating) {
  const dot = document.getElementById('nearby-dot');
  const label = document.getElementById('nearby-loc-label');
  if (dot) dot.className = 'nearby-strip__dot' + (isLocating ? ' nearby-strip__dot--loading' : '');
  if (label) label.textContent = isLocating ? '定位中…' : '點選定位';
}

// 請求定位，回傳 Promise
function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('no geo')); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        userLat = pos.coords.latitude; userLng = pos.coords.longitude;
        updateLocateBtn(true); resolve();
      },
      err => { setLocating(false); reject(err); },
      { timeout: 8000, maximumAge: 60000 }
    );
  });
}

// ── FILTERS ──
function applyFilters() {
  const q = searchQuery.trim().toLowerCase();
  filtered = allData
    .filter(s => {
      let matchType;
      if (activeType === 'all') matchType = true;
      else if (activeType === 'traditional' || activeType === 'western') matchType = s.category === activeType;
      else if (activeType === 'favorites') matchType = isFav(s.id);
      else if (activeType === 'ac') matchType = s.ac === true;
      else matchType = s.types.includes(activeType);
      const matchDistrict = activeDistrict === 'all' || s.district === activeDistrict;
      const matchSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        s.district.toLowerCase().includes(q) ||
        (s.address || '').toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q)) ||
        (s.specialty || '').toLowerCase().includes(q);
      const matchOpen = !showOpenOnly || isOpenNow(s.hours);
      const dist = (userLat && s.lat) ? distKm(userLat, userLng, s.lat, s.lng) : null;
      // +0.25km 容忍值：店家座標從地址估算，誤差可達 200m
      const matchRadius = !activeRadius || !userLat || (dist !== null && dist <= activeRadius + 0.25);
      return matchType && matchDistrict && matchSearch && matchOpen && matchRadius;
    })
    .map(s => ({
      ...s,
      dist:  (userLat && s.lat) ? distKm(userLat, userLng, s.lat, s.lng) : null,
      _open: isOpenNow(s.hours),
    }));

  // Sort: sponsored → open → non-chain → sortFn → chain last
  const sortFn = (() => {
    if (activeSort === 'distance' && userLat) return (a, b) => (a.dist ?? 999) - (b.dist ?? 999);
    if (activeSort === 'featured') return (a, b) =>
      (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.popularity || 0) - (a.popularity || 0);
    return (a, b) => (b.popularity || 0) - (a.popularity || 0);
  })();

  filtered.sort((a, b) => {
    if (a.sponsored !== b.sponsored) return a.sponsored ? -1 : 1;
    if (a._open !== b._open) return a._open ? -1 : 1;   // 開門排前面
    if (a.chain !== b.chain) return a.chain ? 1 : -1;
    return sortFn(a, b);
  });

  statsCount.textContent = filtered.length;
  if (statsLabel) {
    const labels = { distance: ' 間 · 依距離', featured: ' 間 · 精選優先', popular: ' 間 · 依人氣' };
    statsLabel.textContent = labels[activeSort] || ' 間';
  }
  renderList(filtered);
  renderMarkers(filtered);
}

// ── RESET ALL FILTERS ──
function resetAllFilters() {
  showOpenOnly = false;
  activeType = 'all';
  activeDistrict = 'all';
  searchQuery = '';
  activeRadius = null;
  activeSort = 'popular';

  if (searchInput) searchInput.value = '';
  if (btnOpenNow) { btnOpenNow.classList.remove('sort-tab--active'); btnOpenNow.textContent = '🕐 現在營業'; }

  typeChips?.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
  typeChips?.querySelector('[data-type="all"]')?.classList.add('chip--active');
  districtChips?.querySelectorAll('.chip--district').forEach(c => c.classList.remove('chip--active'));
  districtChips?.querySelector('[data-district="all"]')?.classList.add('chip--active');
  sortBar?.querySelectorAll('.sort-tab[data-sort]').forEach(t => t.classList.remove('sort-tab--active'));
  sortBar?.querySelector('[data-sort="popular"]')?.classList.add('sort-tab--active');
  document.querySelectorAll('#radius-bar .nearby-btn').forEach(b => b.classList.remove('nearby-btn--active'));
  document.querySelector('#radius-bar .nearby-btn[data-radius="all"]')?.classList.add('nearby-btn--active');

  applyFilters();
}

// ── RENDER CARDS ──
function renderList(data) {
  if (!data.length) {
    const hasFilters = showOpenOnly || activeType !== 'all' || activeDistrict !== 'all' || searchQuery || activeRadius;
    const resetHint = hasFilters
      ? `<br><button class="expand-btn" id="btn-reset-filters">🔄 清除所有篩選</button>`
      : '';
    const radiusMsg = activeRadius
      ? `附近 <strong>${activeRadius < 1 ? activeRadius * 1000 + '公尺' : activeRadius + '公里'}</strong> 內找不到早餐店`
      : '找不到符合的早餐店';
    listEl.innerHTML = `<p class="loading-msg">${radiusMsg}<br><small>持續新增中，歡迎投稿推薦！</small>${resetHint}</p>`;
    document.getElementById('btn-reset-filters')?.addEventListener('click', resetAllFilters);
    return;
  }
  listEl.innerHTML = data.map(s => {
    const open = isOpenNow(s.hours);
    const distBadge = s.dist !== null ? `<span class="shop-card__dist">${fmtDist(s.dist)}</span>` : '';
    const favIcon = isFav(s.id) ? '❤️' : '🤍';
    const featuredBadge = s.sponsored
      ? `<span class="shop-card__featured shop-card__featured--sponsored">✦ 贊助推薦</span>`
      : s.userFavorite
        ? `<span class="shop-card__featured shop-card__featured--fav">♥ 編輯精選</span>`
        : s.featured ? `<span class="shop-card__featured">精選</span>` : '';

    return `
      <div class="shop-card${s.chain ? ' shop-card--chain' : ''}${!open ? ' shop-card--closed' : ''}" data-id="${s.id}" role="button" tabindex="0" aria-label="${s.nameEn || s.name}">
        <div class="shop-card__thumb">
          ${s.photo
            ? `<img src="${s.photo}" alt="${s.name}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=shop-card__thumb-emoji>${s.icon}</div><span class=shop-card__status-badge ${open ? 'open' : 'close'}>${open ? '● 營業中' : '○ 休息中'}</span>'">`
            : `<div class="shop-card__thumb-emoji">${s.icon}</div>`
          }
          <span class="shop-card__status-badge ${open ? 'open' : 'close'}">${open ? '● 營業中' : '○ 休息中'}</span>
          ${featuredBadge}
          <button class="shop-card__fav" data-fav="${s.id}" title="Save">${favIcon}</button>
        </div>
        <div class="shop-card__info">
          <div class="shop-card__name">${highlightText(s.name, searchQuery)}</div>
          ${s.nameEn ? `<div class="shop-card__name-en">${s.nameEn}</div>` : ''}
          ${s.hook ? `<p class="shop-card__hook">${highlightText(s.hook, searchQuery)}</p>` : ''}
          <div class="shop-card__meta">
            <span>${s.district}</span>
            ${distBadge ? `<span class="shop-card__dot">·</span>${distBadge}` : ''}
          </div>
          <div class="shop-card__bottom-row">
            ${ratingsCache[s.id] ? `<span class="shop-card__rating">⭐ ${ratingsCache[s.id].avg} <span class="shop-card__rating-count">(${ratingsCache[s.id].count}則)</span></span>` : ''}
            <button class="shop-card__route-btn ${routeShops.includes(s.id) ? 'shop-card__route-btn--active' : ''}" data-route="${s.id}" title="加入路線">＋路線</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.shop-card').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.shop-card__fav')) return;
      if (e.target.closest('.shop-card__route-btn')) return;
      const shop = filtered.find(s => s.id === el.dataset.id);
      if (shop) openSheet(shop);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.click(); });
  });

  listEl.querySelectorAll('.shop-card__route-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleRoute(btn.dataset.route, btn);
    });
  });

  listEl.querySelectorAll('.shop-card__fav').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.fav;
      toggleFav(id);
      const nowFav = isFav(id);
      btn.textContent = nowFav ? '❤️' : '🤍';
      btn.classList.remove('fav-bounce');
      void btn.offsetWidth; // reflow
      btn.classList.add('fav-bounce');
      if (nowFav) showToast('已收藏 ❤️');
    });
  });
}

// ── TOAST ──
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast--in'));
  setTimeout(() => { t.classList.remove('toast--in'); setTimeout(() => t.remove(), 300); }, 1800);
}

// ── BOTTOM SHEET ──
let currentShopId = null;

function openSheet(shop) {
  currentShopId = shop.id;
  focusShop(shop);
  const open = isOpenNow(shop.hours);
  const tags = shop.types.map(t => {
    const info = TYPE_LABELS[t];
    return info ? `<span class="tag ${info.cls}">${info.icon} ${info.label}</span>` : '';
  }).join('');
  const distLine = shop.dist !== null
    ? `<div class="info-item"><div class="info-item__label">距你</div><div class="info-item__value">${fmtDist(shop.dist)}</div></div>`
    : '';

  bottomSheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-body">
      ${shop.photo ? `<img class="sheet-photo-hero" src="${shop.photo}" alt="${shop.name}" loading="eager" onerror="this.remove()">` : ''}
      <div class="sheet-header-row">
        <div class="sheet-icon-wrap">
          ${shop.icon}
          ${shop.photo ? `<img class="sheet-icon-photo" src="${shop.photo}" alt="${shop.name}" loading="eager" onerror="this.remove()">` : ''}
        </div>
        <div class="sheet-header-info">
          <div class="sheet-name">${shop.name}</div>
          ${shop.nameEn ? `<div class="sheet-name-en">${shop.nameEn}</div>` : ''}
          <div class="sheet-location">📍 台中 ${shop.district}</div>
        </div>
        <button class="sheet-fav-btn" id="sheet-fav" data-id="${shop.id}">${isFav(shop.id) ? '❤️' : '🤍'}</button>
      </div>
      <div class="sheet-tags">${tags}</div>
      <p class="sheet-desc">${shop.desc}</p>
      ${shop.descEn ? `<p class="sheet-desc sheet-desc--en">${shop.descEn}</p>` : ''}
      <div class="sheet-info">
        <div class="info-item">
          <div class="info-item__label">招牌必點</div>
          <div class="info-item__value">${shop.specialty}</div>
        </div>
        <div class="info-item">
          <div class="info-item__label">均消</div>
          <div class="info-item__value">NT$${shop.price}</div>
        </div>
        <div class="info-item">
          <div class="info-item__label">營業時間</div>
          <div class="info-item__value">${shop.hours}</div>
        </div>
        <div class="info-item">
          <div class="info-item__label">目前狀態</div>
          <div class="info-item__value" style="color:${open ? '#2E7D32' : '#999'}">${open ? '● 營業中' : '○ 休息中'}</div>
        </div>
        ${shop.closedDay ? `<div class="info-item"><div class="info-item__label">公休</div><div class="info-item__value">${shop.closedDay}</div></div>` : ''}
        <div class="info-item">
          <div class="info-item__label">冷氣</div>
          <div class="info-item__value">${
            shop.ac === true  ? '❄️ 有冷氣（已確認）' :
            shop.ac === false ? '☀️ 無冷氣（已確認）' :
                                '⬜ 未確認'
          }</div>
        </div>
        ${distLine}
      </div>
      ${ratingsCache[shop.id] ? `
      <div class="sheet-rating-bar">
        <span class="sheet-rating-stars">${'★'.repeat(Math.round(ratingsCache[shop.id].avg))}${'☆'.repeat(5 - Math.round(ratingsCache[shop.id].avg))}</span>
        <span class="sheet-rating-avg">${ratingsCache[shop.id].avg}</span>
        <span class="sheet-rating-count">${ratingsCache[shop.id].count} 則評分</span>
      </div>` : ''}
      <div class="sheet-actions">
        <a class="sheet-btn sheet-btn--primary"
           href="https://www.google.com/maps/dir/?api=1&destination=${shop.lat},${shop.lng}"
           target="_blank" rel="noopener">🗺️ 導航</a>
        <a class="sheet-btn sheet-btn--ghost"
           href="https://www.google.com/maps/search/${encodeURIComponent(shop.name + ' ' + shop.district + ' 台中')}"
           target="_blank" rel="noopener">📋 菜單</a>
        <button class="sheet-btn sheet-btn--ghost" id="sheet-route">${routeShops.includes(shop.id) ? '✓ 路線中' : '＋加入路線'}</button>
        <button class="sheet-btn sheet-btn--ghost" id="sheet-share">↗ 分享</button>
        <button class="sheet-btn sheet-btn--ghost" id="sheet-close">✕ 關閉</button>
      </div>
      <button class="sheet-claim-btn" id="sheet-claim">🏪 我是這間店的老闆</button>

      <!-- COMMENTS -->
      <div class="sheet-comments">
        <div class="comments-title">💬 留言板</div>
        <div class="comments-list" id="comments-list"><p class="comments-loading">載入中…</p></div>
        <div class="comment-form">
          <div class="comment-form__row">
            <input class="comment-input" id="c-nick" placeholder="暱稱" maxlength="20">
            <div class="star-rating" id="star-rating">
              ${[1,2,3,4,5].map(n => `<button class="star${n <= 5 ? ' star--on' : ''}" data-star="${n}">★</button>`).join('')}
            </div>
          </div>
          <textarea class="comment-textarea" id="c-content" placeholder="分享你的早餐心得…" maxlength="300" rows="3"></textarea>
          <button class="comment-submit" id="c-submit">送出心得</button>
        </div>
      </div>
    </div>
  `;

  sheetOverlay.classList.add('sheet-overlay--open');
  bottomSheet.classList.add('bottom-sheet--open');

  // Events
  document.getElementById('sheet-close').addEventListener('click', closeSheet);

  document.getElementById('sheet-fav').addEventListener('click', () => {
    toggleFav(shop.id);
    document.getElementById('sheet-fav').textContent = isFav(shop.id) ? '❤️' : '🤍';
  });

  document.getElementById('sheet-share').addEventListener('click', () => shareShop(shop));

  document.getElementById('sheet-route')?.addEventListener('click', (e) => {
    toggleRoute(shop.id, e.currentTarget);
    e.currentTarget.textContent = routeShops.includes(shop.id) ? '✓ 路線中' : '＋加入路線';
  });

  document.getElementById('sheet-claim')?.addEventListener('click', () => openClaimModal(shop.id, shop.name));

  // Update page title for sharing
  document.title = `${shop.name} — MORNING TW 台中早餐地圖`;

  // Star rating
  let selectedRating = 5;
  const stars = bottomSheet.querySelectorAll('.star');
  stars.forEach(btn => {
    btn.addEventListener('click', () => {
      selectedRating = parseInt(btn.dataset.star);
      stars.forEach(s => s.classList.toggle('star--on', parseInt(s.dataset.star) <= selectedRating));
    });
  });

  // Submit comment
  document.getElementById('c-submit').addEventListener('click', async () => {
    const nick = document.getElementById('c-nick').value.trim();
    const content = document.getElementById('c-content').value.trim();
    if (!nick || !content) { showToast('請填寫暱稱和留言'); return; }
    if (nick.length > 20 || content.length > 300) { showToast('內容超過長度限制'); return; }
    const btn = document.getElementById('c-submit');
    btn.disabled = true; btn.textContent = '送出中…';
    try {
      await addComment({ shopId: shop.id, nickname: nick, content, rating: selectedRating });
      document.getElementById('c-content').value = '';
      loadComments(shop.id);
    } catch(e) {
      alert('送出失敗，請稍後再試');
    }
    btn.disabled = false; btn.textContent = '送出心得';
  });

  loadComments(shop.id);
}

// XSS-safe text escaping
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadComments(shopId) {
  const el = document.getElementById('comments-list');
  if (!el) return;
  const comments = await fetchComments(shopId);
  if (!comments.length) {
    el.innerHTML = `<p class="comments-empty">還沒有心得，來第一個分享你的早餐體驗！</p>`;
    return;
  }
  el.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-item__header">
        <span class="comment-nick">${escHtml(c.nickname)}</span>
        <span class="comment-stars">${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}</span>
        <span class="comment-date">${new Date(c.created_at).toLocaleDateString('zh-TW')}</span>
      </div>
      <p class="comment-content">${escHtml(c.content)}</p>
    </div>
  `).join('');
}

function closeSheet() {
  sheetOverlay.classList.remove('sheet-overlay--open');
  bottomSheet.classList.remove('bottom-sheet--open');
  bottomSheet.style.transform = '';
  currentShopId = null;
  resetView();
  document.title = 'MORNING TW — 台中早餐地圖';
}

// ── SHARE ──
async function shareShop(shop) {
  const url = `${location.origin}${location.pathname}?shop=${shop.id}`;
  const text = `${shop.nameEn || shop.name} — Breakfast in Taichung ${shop.district} | MORNING TW`;
  if (navigator.share) {
    try { await navigator.share({ title: text, url }); return; } catch {}
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    prompt('複製此連結：', url);
    return;
  }
  showToast('連結已複製 ✓');
}

// ── DISTRICT COUNTS ──
function buildDistrictCounts(data) {
  const counts = {};
  data.forEach(s => { counts[s.district] = (counts[s.district] || 0) + 1; });
  document.querySelectorAll('#district-chips .chip--district[data-district]').forEach(btn => {
    const d = btn.dataset.district;
    if (d === 'all') return;
    const n = counts[d];
    if (n) {
      const existing = btn.querySelector('.chip-count');
      if (!existing) btn.insertAdjacentHTML('beforeend', `<span class="chip-count">${n}</span>`);
    }
  });
}

// ── SEARCH HIGHLIGHT ──
function highlightText(text, query) {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

// ── MARQUEE ──
function buildMarquee(data) {
  const track = document.getElementById('marquee-track');
  if (!track) return;
  // Limit to 30 shops per loop to keep DOM lean (156 nodes was too heavy)
  const slice = data.slice(0, 30);
  const items = [...slice, ...slice].map(s => `
    <div class="marquee-item" data-id="${s.id}">
      <div class="marquee-item__icon">
        ${s.photo
            ? `<img src="${s.photo}" alt="${s.name}" loading="lazy" onerror="this.style.display='none';this.parentElement.dataset.fb='1';this.parentElement.textContent='${s.icon}'">`
            : s.icon
          }
      </div>
      <span class="marquee-item__name">${s.name}</span>
    </div>
  `).join('');
  track.innerHTML = items;
  track.querySelectorAll('.marquee-item').forEach(el => {
    el.addEventListener('click', () => {
      const shop = allData.find(s => s.id === el.dataset.id);
      if (shop) openSheet(shop);
    });
  });
}

// ── TAB SYSTEM ──
let currentTab = 'list';
let mapInitialized = false;

function setTab(tab) {
  currentTab = tab;
  document.body.setAttribute('data-view', tab);
  // Nav tabs
  document.querySelectorAll('.nav__tab').forEach(el => {
    el.classList.toggle('tab--active', el.dataset.tab === tab);
  });
  // Bottom nav — map button active only in map view, others active in list view
  document.querySelectorAll('.bnav__item').forEach(el => {
    const isMapBtn = el.dataset.tab === 'map';
    el.classList.toggle('bnav__item--active', tab === 'map' ? isMapBtn : !isMapBtn && el.dataset.action === 'home');
  });
  if (tab === 'map') {
    if (!mapInitialized) {
      mapInitialized = true;
      initMap(openSheet);
      renderMarkers(filtered.length ? filtered : allData);
    }
    setTimeout(() => invalidateSize(), 80);
  }
}

// ── EVENTS ──
function setupEvents() {
  // Nav tab buttons
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', e => {
      const tab = btn.dataset.tab;
      if (tab === 'map') { e.preventDefault(); setTab('map'); return; }
      if (tab === 'list') {
        e.preventDefault(); setTab('list');
        // sub-action
        const action = btn.dataset.action;
        if (action === 'search') { searchInput?.focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        else if (action === 'list') { document.getElementById('list-section')?.scrollIntoView({ behavior: 'smooth' }); }
        else { window.scrollTo({ top: 0, behavior: 'smooth' }); }
      }
    });
  });

  searchBtn.addEventListener('click', () => { searchQuery = searchInput.value; applyFilters(); });
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { searchQuery = searchInput.value; applyFilters(); } });
  searchInput.addEventListener('input', () => { searchQuery = searchInput.value; applyFilters(); });

  typeChips?.addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-type]');
    if (!chip) return;
    typeChips.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    activeType = chip.dataset.type;
    applyFilters();
  });

  districtChips?.addEventListener('click', e => {
    const chip = e.target.closest('.chip--district');
    if (!chip) return;
    districtChips.querySelectorAll('.chip--district').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    activeDistrict = chip.dataset.district;
    applyFilters();
  });

  sortBar?.addEventListener('click', async e => {
    const tab = e.target.closest('.sort-tab[data-sort]'); // only sort tabs, not toggles
    if (!tab) return;
    sortBar.querySelectorAll('.sort-tab[data-sort]').forEach(t => t.classList.remove('sort-tab--active'));
    tab.classList.add('sort-tab--active');
    activeSort = tab.dataset.sort;
    if (activeSort === 'distance' && !userLat) {
      tab.textContent = '⏳ 定位中…';
      try { await requestLocation(); } catch {}
      tab.textContent = '📍 距離';
    }
    applyFilters();
  });

  btnLocate?.addEventListener('click', async () => {
    if (userLat) {
      // 已定位 → 直接捲到列表
      document.getElementById('list-section')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    try {
      btnLocate.textContent = '⏳ 定位中...';
      await requestLocation();
      applyFilters();
      document.getElementById('list-section')?.scrollIntoView({ behavior: 'smooth' });
    } catch {
      btnLocate.textContent = '📍 找我附近的';
    }
  });

  // Open Now toggle
  btnOpenNow?.addEventListener('click', () => {
    showOpenOnly = !showOpenOnly;
    btnOpenNow.classList.toggle('sort-tab--active', showOpenOnly);
    btnOpenNow.textContent = showOpenOnly ? '✅ 現在營業' : '🕐 現在營業';
    applyFilters();
  });

  // Saved filter — toggle: if already in favorites, reset to all
  document.getElementById('btn-favs-filter')?.addEventListener('click', () => {
    if (activeType === 'favorites') {
      typeChips?.querySelector('[data-type="all"]')?.click();
    } else {
      typeChips?.querySelector('[data-type="favorites"]')?.click();
    }
  });

  // 半徑快篩 — 點選自動觸發定位
  document.getElementById('radius-bar')?.addEventListener('click', async e => {
    const btn = e.target.closest('.nearby-btn[data-radius]');
    if (!btn) return;

    const val = btn.dataset.radius;
    const newRadius = val === 'all' ? null : parseFloat(val);

    // 切換 active 樣式
    document.querySelectorAll('#radius-bar .nearby-btn').forEach(b => b.classList.remove('nearby-btn--active'));
    btn.classList.add('nearby-btn--active');

    // 如果選了具體距離且尚未定位 → 自動請求定位
    if (newRadius !== null && !userLat) {
      try {
        await requestLocation();
      } catch {
        // 定位失敗 — 回到全部，提示使用者
        document.querySelectorAll('#radius-bar .nearby-btn').forEach(b => b.classList.remove('nearby-btn--active'));
        document.querySelector('#radius-bar .nearby-btn[data-radius="all"]')?.classList.add('nearby-btn--active');
        const label = document.getElementById('nearby-loc-label');
        if (label) { label.textContent = '定位失敗'; setTimeout(() => { label.textContent = '點選定位'; }, 3000); }
        activeRadius = null; applyFilters(); return;
      }
    }

    activeRadius = newRadius;
    applyFilters();
  });

  // 「點選定位」dot/label 點擊
  document.getElementById('nearby-loc-btn')?.addEventListener('click', async () => {
    if (userLat) {
      // 已定位 → 閃一下確認
      const label = document.getElementById('nearby-loc-label');
      if (label) { const orig = label.textContent; label.textContent = '✓ 已定位'; setTimeout(() => { label.textContent = orig; }, 1500); }
      return;
    }
    try {
      await requestLocation();
      applyFilters();
    } catch {
      const label = document.getElementById('nearby-loc-label');
      if (label) { label.textContent = '定位失敗'; setTimeout(() => { label.textContent = '點選定位'; }, 3000); }
    }
  });

  sheetOverlay.addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSheet(); closeClaimModal(); }
  });

  setupClaimModal();

  // ── TRANSPORT MODE ──
  function syncTransportUI() {
    document.querySelectorAll('.transport-btn').forEach(b => {
      b.classList.toggle('transport-btn--active', b.dataset.mode === travelMode);
    });
  }
  syncTransportUI();
  document.getElementById('transport-strip')?.addEventListener('click', e => {
    const btn = e.target.closest('.transport-btn[data-mode]');
    if (!btn) return;
    travelMode = btn.dataset.mode;
    localStorage.setItem('mw_travel_mode', travelMode);
    syncTransportUI();
    if (userLat !== null) applyFilters(); // refresh distance displays
  });

  // 下滑關閉 sheet
  let tsY = 0;
  bottomSheet.addEventListener('touchstart', e => { tsY = e.touches[0].clientY; }, { passive: true });
  bottomSheet.addEventListener('touchmove', e => {
    const dy = e.touches[0].clientY - tsY;
    if (dy > 0) bottomSheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  bottomSheet.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - tsY;
    if (dy > 80) { closeSheet(); } else { bottomSheet.style.transform = ''; }
  });

  // Handle share link ?shop=id on load
  const urlParams = new URLSearchParams(location.search);
  const sharedId = urlParams.get('shop');
  if (sharedId) {
    setTimeout(() => {
      const shop = allData.find(s => s.id === sharedId);
      if (shop) openSheet({ ...shop, dist: null });
    }, 800);
  }
}

// ── MEMBER PANEL ──
function openMemberPanel(user) {
  const overlay = document.getElementById('member-overlay');
  const panel   = document.getElementById('member-panel');
  if (!overlay || !panel) return;

  const avatar  = user.user_metadata?.avatar_url;
  const name    = user.user_metadata?.full_name || user.email || '早鳥會員';
  const email   = user.email || '';
  const favCount = favorites.length;
  const isPremium = false; // TODO: 串接付費系統後改為真實狀態

  // Build favorites list HTML
  const favShops = favorites.map(id => allData.find(s => s.id === id)).filter(Boolean);
  const favListHTML = favShops.length
    ? `<div class="member-favs">
        ${favShops.map(s => `
          <button class="member-fav-item" data-id="${s.id}">
            <div class="member-fav-item__img">
              ${s.photo ? `<img src="${s.photo}" alt="${s.name}" loading="lazy">` : `<span>${s.icon}</span>`}
            </div>
            <div class="member-fav-item__info">
              <div class="member-fav-item__name">${s.name}</div>
              <div class="member-fav-item__meta">${s.district} · ${s.hours || ''}</div>
            </div>
            <div class="member-fav-item__arrow">→</div>
          </button>
        `).join('')}
      </div>`
    : `<div class="member-favs-empty">
        <div class="member-favs-empty__icon">🍳</div>
        <div class="member-favs-empty__text">還沒有收藏的店家<br><small>點店家卡片上的 ❤️ 即可收藏</small></div>
        <button class="member-favs-empty__cta" id="btn-go-explore">去探索 →</button>
      </div>`;

  panel.innerHTML = `
    <div class="member-panel__header">
      <button class="member-panel__close" id="btn-member-close">✕</button>
    </div>
    <div class="member-panel__profile">
      ${avatar
        ? `<img src="${avatar}" alt="${name}" class="member-panel__avatar">`
        : `<div class="member-panel__avatar member-panel__avatar--initial">${name[0]}</div>`
      }
      <div class="member-panel__name">${name}</div>
      <div class="member-panel__email">${email}</div>
      <div class="member-panel__tier ${isPremium ? 'member-panel__tier--gold' : ''}">
        ${isPremium ? '✦ 金牌早鳥' : '☆ 早鳥會員'}
      </div>
    </div>
    <div class="member-panel__stats">
      <div class="member-stat">
        <div class="member-stat__num">${favCount}</div>
        <div class="member-stat__label">已收藏</div>
      </div>
      <div class="member-stat">
        <div class="member-stat__num">${allData.length}</div>
        <div class="member-stat__label">全台中店家</div>
      </div>
      <div class="member-stat">
        <div class="member-stat__num">${allData.filter(s => isOpenNow(s.hours)).length}</div>
        <div class="member-stat__label">現在營業中</div>
      </div>
    </div>
    <div class="member-section">
      <div class="member-section__title">❤️ 我的收藏</div>
      ${favListHTML}
    </div>
    ${!isPremium ? `
    <div class="member-panel__upgrade">
      <div class="upgrade-card">
        <div class="upgrade-card__badge">✦ 金牌早鳥</div>
        <div class="upgrade-card__title">解鎖更多早餐特權</div>
        <ul class="upgrade-card__perks">
          <li>🔐 隱藏版店家獨家看</li>
          <li>🎟 會員專屬折扣碼</li>
          <li>🤖 無限 AI 推薦</li>
          <li>📬 每月早餐月刊</li>
        </ul>
        <button class="upgrade-card__btn" id="btn-upgrade">NT$99/月 立即升級</button>
      </div>
    </div>` : ''}
    <button class="member-panel__logout" id="btn-logout">登出</button>
  `;

  overlay.classList.add('member-overlay--open');
  panel.classList.add('member-panel--open');

  document.getElementById('btn-member-close')?.addEventListener('click', closeMemberPanel);
  overlay.addEventListener('click', closeMemberPanel, { once: true });
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await logout();
    closeMemberPanel();
    showToast('已登出');
  });
  document.getElementById('btn-upgrade')?.addEventListener('click', () => {
    showToast('升級功能即將推出，敬請期待！');
  });
  document.getElementById('btn-go-explore')?.addEventListener('click', () => {
    closeMemberPanel();
    document.getElementById('list-section')?.scrollIntoView({ behavior: 'smooth' });
  });
  panel.querySelectorAll('.member-fav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const shop = allData.find(s => s.id === btn.dataset.id);
      if (shop) { closeMemberPanel(); openSheet(shop); }
    });
  });
}

function closeMemberPanel() {
  document.getElementById('member-overlay')?.classList.remove('member-overlay--open');
  document.getElementById('member-panel')?.classList.remove('member-panel--open');
}

// ── 今日推薦 ──
function buildDailyPicks(data) {
  const el = document.getElementById('daily-picks');
  if (!el || !data.length) return;

  // 以當天日期為種子，固定選 3 間（非連鎖、非贊助）
  const daySeed = Math.floor(Date.now() / 86400000);
  const pool = data.filter(s => !s.chain);
  const picks = [];
  for (let i = 0; picks.length < 3 && i < pool.length * 3; i++) {
    const idx = (daySeed * 17 + i * 31 + i * i * 7) % pool.length;
    const s = pool[idx];
    if (!picks.find(p => p.id === s.id)) picks.push(s);
  }

  const dateStr = new Date().toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
  el.innerHTML = `
    <div class="daily-picks__header">
      <span class="daily-picks__title">✨ 今日推薦</span>
      <span class="daily-picks__date">${dateStr}</span>
    </div>
    <div class="daily-picks__row">
      ${picks.map(s => `
        <div class="daily-pick" data-id="${s.id}">
          <div class="daily-pick__img">
            ${s.photo
              ? `<img src="${s.photo}" alt="${s.name}" loading="lazy" onerror="this.style.display='none'">`
              : `<div class="daily-pick__emoji">${s.icon}</div>`}
          </div>
          <div class="daily-pick__name">${s.name}</div>
          <div class="daily-pick__district">${s.district}</div>
        </div>
      `).join('')}
    </div>
  `;

  el.querySelectorAll('.daily-pick').forEach(card => {
    card.addEventListener('click', () => {
      const shop = allData.find(s => s.id === card.dataset.id);
      if (shop) openSheet(shop);
    });
  });
}

// ── 路線規劃 ──
function toggleRoute(shopId, btn) {
  const idx = routeShops.indexOf(shopId);
  if (idx === -1) {
    if (routeShops.length >= 8) { showToast('最多可選 8 間'); return; }
    routeShops.push(shopId);
    showToast('已加入路線 🗺️');
  } else {
    routeShops.splice(idx, 1);
  }
  // Update all route buttons for this shop
  document.querySelectorAll(`[data-route="${shopId}"]`).forEach(b => {
    b.classList.toggle('shop-card__route-btn--active', routeShops.includes(shopId));
    b.textContent = routeShops.includes(shopId) ? '✓ 路線中' : '＋路線';
  });
  updateRouteFab();
}

function updateRouteFab() {
  const fab = document.getElementById('route-fab');
  const count = document.getElementById('route-count');
  if (!fab) return;
  if (routeShops.length > 0) {
    fab.classList.add('route-fab--visible');
    fab.removeAttribute('aria-hidden');
  } else {
    fab.classList.remove('route-fab--visible');
    fab.setAttribute('aria-hidden', 'true');
  }
  if (count) count.textContent = routeShops.length;
}

function initRouteFab() {
  document.getElementById('btn-route-go')?.addEventListener('click', () => {
    const shops = routeShops.map(id => allData.find(s => s.id === id)).filter(Boolean);
    if (!shops.length) return;
    const [origin, ...waypoints] = shops;
    const dest = shops[shops.length - 1];
    const wp = waypoints.slice(0, -1).map(s => `${s.lat},${s.lng}`).join('|');
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${dest.lat},${dest.lng}${wp ? `&waypoints=${wp}` : ''}&travelmode=driving`;
    window.open(url, '_blank', 'noopener');
  });
  document.getElementById('btn-route-clear')?.addEventListener('click', () => {
    routeShops = [];
    document.querySelectorAll('.shop-card__route-btn').forEach(b => {
      b.classList.remove('shop-card__route-btn--active');
      b.textContent = '＋路線';
    });
    updateRouteFab();
    showToast('路線已清除');
  });
}

// ── 店家認領 ──
let claimShopId = '', claimShopName = '';

function openClaimModal(shopId, shopName) {
  claimShopId = shopId; claimShopName = shopName;
  const overlay = document.getElementById('claim-overlay');
  const modal   = document.getElementById('claim-modal');
  if (!overlay || !modal) return;
  overlay.classList.add('claim-overlay--open');
  modal.classList.add('claim-modal--open');
  modal.removeAttribute('aria-hidden');
}

function closeClaimModal() {
  document.getElementById('claim-overlay')?.classList.remove('claim-overlay--open');
  document.getElementById('claim-modal')?.classList.remove('claim-modal--open');
  document.getElementById('claim-modal')?.setAttribute('aria-hidden', 'true');
}

function setupClaimModal() {
  document.getElementById('btn-claim-close')?.addEventListener('click', closeClaimModal);
  document.getElementById('claim-overlay')?.addEventListener('click', closeClaimModal);
  document.getElementById('btn-claim-submit')?.addEventListener('click', async () => {
    const name  = document.getElementById('claim-name')?.value.trim();
    const phone = document.getElementById('claim-phone')?.value.trim();
    const msg   = document.getElementById('claim-msg')?.value.trim();
    if (!name || !phone) { showToast('請填寫姓名和聯絡電話'); return; }
    const btn = document.getElementById('btn-claim-submit');
    btn.disabled = true; btn.textContent = '送出中…';
    try {
      await submitClaim({ shopId: claimShopId, shopName: claimShopName, contactName: name, contactPhone: phone, message: msg });
      showToast('申請已送出！我們將盡快聯絡你 ✓');
      closeClaimModal();
    } catch {
      showToast('送出失敗，請稍後再試');
    }
    btn.disabled = false; btn.textContent = '送出認領申請';
  });
}

// ── 推播通知 ──
async function initPushHint() {
  if (!('Notification' in window) || !favorites.length) return;
  if (Notification.permission === 'denied') return;

  // 找收藏中目前開門的店
  const openFavs = favorites
    .map(id => allData.find(s => s.id === id))
    .filter(s => s && isOpenNow(s.hours));

  if (!openFavs.length) return;

  // 尚未問過通知權限 → 溫和提示
  if (Notification.permission === 'default') {
    const fab = document.getElementById('route-fab');
    // 顯示 toast 提示
    const t = document.createElement('div');
    t.className = 'toast toast--notify';
    t.innerHTML = `🔔 <strong>${openFavs[0].name}</strong> 現在營業中！<button id="btn-allow-notify" style="margin-left:8px;font-weight:700;color:#F5A623">開啟通知</button>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('toast--in'));
    document.getElementById('btn-allow-notify')?.addEventListener('click', async () => {
      t.remove();
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        new Notification('MORNING TW 早安！', {
          body: `${openFavs[0].name} 現在營業中 🍳`,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
        });
      }
    });
    setTimeout(() => { t.classList.remove('toast--in'); setTimeout(() => t.remove(), 400); }, 8000);
    return;
  }

  // 已有權限 → 直接通知
  if (Notification.permission === 'granted') {
    new Notification('MORNING TW — 早安！', {
      body: `你收藏的 ${openFavs[0].name} 現在營業中 🍳`,
      icon: '/icons/icon-192.png',
    });
  }
}

// ── OPEN STATUS ──
function isOpenNow(hoursStr) {
  if (!hoursStr || hoursStr === '24小時') return true;
  try {
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const m = hoursStr.match(/(\d{1,2}):(\d{2})[–~\-](\d{1,2}):(\d{2})/);
    if (!m) return true;
    const open  = parseInt(m[1]) * 60 + parseInt(m[2]);
    const close = parseInt(m[3]) * 60 + parseInt(m[4]);
    return cur >= open && cur < close;
  } catch { return true; }
}
