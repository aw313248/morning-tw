// ── MORNING TW — App ──
import { initMap, renderMarkers, focusShop, resetView } from './map.js';

// Supabase 懶加載，不阻塞主程式
let _supabase = null;
async function getSupabase() {
  if (_supabase) return _supabase;
  try {
    _supabase = await import('./supabase.js');
  } catch(e) {
    console.warn('Supabase 載入失敗，留言板暫時停用', e);
    _supabase = { fetchComments: async () => [], addComment: async () => { throw new Error('offline'); } };
  }
  return _supabase;
}
async function fetchComments(id) { return (await getSupabase()).fetchComments(id); }
async function addComment(payload) { return (await getSupabase()).addComment(payload); }

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
const BIKE_KMH = 13; // 市區騎車含紅燈

function fmtDist(straightKm) {
  const km = straightKm * ROAD_FACTOR;
  const bikeMin = Math.round(km / BIKE_KMH * 60);
  const walkMin = Math.round(km / 5 * 60);
  if (km < 0.12) return `步行約 ${walkMin} 分鐘`;
  if (bikeMin <= 2) return `騎車約 ${bikeMin} 分鐘（${Math.round(km * 1000)} 公尺）`;
  return `騎車約 ${bikeMin} 分鐘`;
}

// ── STATE ──
let allData = [], filtered = [];
let activeType = 'all', activeDistrict = 'all', searchQuery = '';
let activeSort = 'popular';
let showOpenOnly = false;
let activeRadius = null; // null = 全部, 數字 = km
let userLat = null, userLng = null;
let favorites = JSON.parse(localStorage.getItem('mw_favs') || '[]');

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
  buildMarquee(allData);
  initMap(openSheet);
  tryAutoLocate();
  setupEvents();
})();

// ── FAVORITES ──
function saveFavs() { localStorage.setItem('mw_favs', JSON.stringify(favorites)); }
function isFav(id) { return favorites.includes(id); }
function toggleFav(id) {
  favorites = isFav(id) ? favorites.filter(x => x !== id) : [...favorites, id];
  saveFavs();
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
    .map(s => ({ ...s, dist: (userLat && s.lat) ? distKm(userLat, userLng, s.lat, s.lng) : null }));

  // Sort — chain shops always last
  const sortFn = (() => {
    if (activeSort === 'distance' && userLat) return (a, b) => (a.dist ?? 999) - (b.dist ?? 999);
    if (activeSort === 'featured') return (a, b) =>
      (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.popularity || 0) - (a.popularity || 0);
    return (a, b) => (b.popularity || 0) - (a.popularity || 0);
  })();

  filtered.sort((a, b) => {
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

// ── RENDER CARDS ──
function renderList(data) {
  if (!data.length) {
    const radiusHint = activeRadius
      ? `<br><button class="expand-btn" onclick="document.querySelector('[data-radius=\\'all\\']').click()">📍 顯示全台中</button>`
      : '';
    const radiusMsg = activeRadius
      ? `附近 <strong>${activeRadius < 1 ? activeRadius * 1000 + '公尺' : activeRadius + '公里'}</strong> 內找不到早餐店`
      : '找不到符合的早餐店';
    listEl.innerHTML = `<p class="loading-msg">${radiusMsg}<br><small>持續新增中，歡迎投稿推薦！</small>${radiusHint}</p>`;
    return;
  }
  listEl.innerHTML = data.map(s => {
    const open = isOpenNow(s.hours);
    const tags = s.types.slice(0, 2).map(t => {
      const info = TYPE_LABELS[t];
      return info ? `<span class="tag-mini">${info.icon} ${info.label}</span>` : '';
    }).join('');
    const distBadge = s.dist !== null ? `<span class="shop-card__dist">🚴 ${fmtDist(s.dist)}</span>` : '';
    const favIcon = isFav(s.id) ? '❤️' : '🤍';

    return `
      <div class="shop-card${s.chain ? ' shop-card--chain' : ''}" data-id="${s.id}" role="button" tabindex="0" aria-label="${s.nameEn || s.name}">
        <div class="shop-card__icon">
          ${s.icon}
          ${s.photo ? `<img class="shop-card__photo" src="${s.photo}" alt="${s.name}" loading="lazy" onerror="this.remove()">` : ''}
        </div>
        <div class="shop-card__body">
          <div class="shop-card__name">${s.name}</div>
          ${s.nameEn ? `<div class="shop-card__name-en">${s.nameEn}</div>` : ''}
          <div class="shop-card__meta">
            <span>${s.district}</span>
            <span class="shop-card__dot">·</span>
            <span class="${open ? 'shop-card__status-open' : 'shop-card__status-close'}">
              ${open ? '● 營業中' : '○ 休息'}
            </span>
            ${distBadge ? `<span class="shop-card__dot">·</span>${distBadge}` : ''}
          </div>
          <div class="shop-card__tags">${tags}</div>
        </div>
        ${s.userFavorite ? '<span class="shop-card__featured shop-card__featured--fav">♥ 編輯精選</span>' : s.featured ? '<span class="shop-card__featured">精選</span>' : ''}
        <button class="shop-card__fav" data-fav="${s.id}" title="Save">${favIcon}</button>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.shop-card').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.shop-card__fav')) return;
      const shop = filtered.find(s => s.id === el.dataset.id);
      if (shop) openSheet(shop);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.click(); });
  });

  listEl.querySelectorAll('.shop-card__fav').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.fav;
      toggleFav(id);
      btn.textContent = isFav(id) ? '❤️' : '🤍';
    });
  });
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
    ? `<div class="info-item"><div class="info-item__label">距你</div><div class="info-item__value">🚴 ${fmtDist(shop.dist)}<br><small style="color:#aaa;font-size:10px;font-weight:400">市區騎車預估</small></div></div>`
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
      <div class="sheet-actions">
        <a class="sheet-btn sheet-btn--primary"
           href="https://www.google.com/maps/dir/?api=1&destination=${shop.lat},${shop.lng}"
           target="_blank" rel="noopener">🗺️ 導航</a>
        <a class="sheet-btn sheet-btn--ghost"
           href="https://www.google.com/maps/search/${encodeURIComponent(shop.name + ' ' + shop.district + ' 台中')}"
           target="_blank" rel="noopener">📋 菜單</a>
        <button class="sheet-btn sheet-btn--ghost" id="sheet-share">↗ 分享</button>
        <button class="sheet-btn sheet-btn--ghost" id="sheet-close">✕ 關閉</button>
      </div>

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
    if (!nick || !content) { alert('請填寫暱稱和留言'); return; }
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
        <span class="comment-nick">${c.nickname}</span>
        <span class="comment-stars">${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}</span>
        <span class="comment-date">${new Date(c.created_at).toLocaleDateString('zh-TW')}</span>
      </div>
      <p class="comment-content">${c.content}</p>
    </div>
  `).join('');
}

function closeSheet() {
  sheetOverlay.classList.remove('sheet-overlay--open');
  bottomSheet.classList.remove('bottom-sheet--open');
  currentShopId = null;
  resetView();
}

// ── SHARE ──
async function shareShop(shop) {
  const url = `${location.origin}${location.pathname}?shop=${shop.id}`;
  const text = `${shop.nameEn || shop.name} — Breakfast in Taichung ${shop.district} | MORNING TW`;
  if (navigator.share) {
    try { await navigator.share({ title: text, url }); return; } catch {}
  }
  await navigator.clipboard.writeText(url);
  alert('連結已複製！');
}

// ── MARQUEE ──
function buildMarquee(data) {
  const track = document.getElementById('marquee-track');
  if (!track) return;
  const items = [...data, ...data].map(s => `
    <div class="marquee-item" data-id="${s.id}">
      <div class="marquee-item__icon" style="background:${s.color || '#f5f5f5'}">${s.icon}</div>
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

// ── EVENTS ──
function setupEvents() {
  searchBtn.addEventListener('click', () => { searchQuery = searchInput.value; applyFilters(); });
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { searchQuery = searchInput.value; applyFilters(); } });
  searchInput.addEventListener('input', () => { if (!searchInput.value) { searchQuery = ''; applyFilters(); } });

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
    const tab = e.target.closest('.sort-tab');
    if (!tab) return;
    sortBar.querySelectorAll('.sort-tab').forEach(t => t.classList.remove('sort-tab--active'));
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

  // Saved filter (sort bar shortcut → syncs with chip)
  document.getElementById('btn-favs-filter')?.addEventListener('click', () => {
    const chip = document.querySelector('[data-type="favorites"]');
    if (chip) chip.click();
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

  sheetOverlay.addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

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
