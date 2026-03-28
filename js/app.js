// ── MORNING TW — App ──
import { initMap, renderMarkers, focusShop, resetView, locateUser } from './map.js';

const TYPE_LABELS = {
  egg:   { label: '蛋餅燒餅', icon: '🥚', cls: 'tag--egg' },
  rice:  { label: '飯糰粥',   icon: '🍚', cls: 'tag--rice' },
  soup:  { label: '湯品',     icon: '🍜', cls: 'tag--soup' },
  local: { label: '在地特色', icon: '📍', cls: 'tag--local' },
  drink: { label: '豆漿飲料', icon: '🫘', cls: 'tag--drink' },
};

// Haversine distance in km
function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function fmtDist(km) {
  if (km < 1) return `${Math.round(km * 1000)} 公尺`;
  return `${km.toFixed(1)} 公里`;
}

let allData = [], filtered = [];
let activeType = 'all', activeDistrict = 'all', searchQuery = '';
let activeSort = 'popular'; // 'popular' | 'featured' | 'distance'
let userLat = null, userLng = null;
let locating = false;

const listEl         = document.getElementById('breakfast-list');
const statsCount     = document.getElementById('stats-count');
const statsLabel     = document.getElementById('stats-label');
const searchInput    = document.getElementById('search-input');
const searchBtn      = document.getElementById('search-btn');
const typeChips      = document.getElementById('type-chips');
const districtChips  = document.getElementById('district-chips');
const sortBar        = document.getElementById('sort-bar');
const btnLocate      = document.getElementById('btn-locate');
const sheetOverlay   = document.getElementById('sheet-overlay');
const bottomSheet    = document.getElementById('bottom-sheet');

(async () => {
  const res = await fetch('data/breakfasts.json');
  allData = await res.json();
  buildMarquee(allData);
  initMap(openSheet);
  // Auto-locate on load
  tryAutoLocate();
  setupEvents();
})();

// ── AUTO LOCATE ON LOAD ──
function tryAutoLocate() {
  if (!navigator.geolocation) {
    applyFilters();
    return;
  }

  // Show locating state
  listEl.innerHTML = `<p class="loading-msg">📍 正在定位中⋯</p>`;
  locating = true;

  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      locating = false;
      updateLocateBtn(true);
      applyFilters();
    },
    () => {
      // Permission denied or error — just load normally
      locating = false;
      applyFilters();
    },
    { timeout: 5000, maximumAge: 60000 }
  );
}

function updateLocateBtn(located) {
  if (!btnLocate) return;
  if (located) {
    btnLocate.textContent = '📍 已定位';
    btnLocate.classList.add('btn-locate--active');
  } else {
    btnLocate.textContent = '📍 找我附近的';
    btnLocate.classList.remove('btn-locate--active');
  }
}

// ── FILTERS ──
function applyFilters() {
  const q = searchQuery.trim().toLowerCase();

  filtered = allData
    .filter(s => {
      const matchType     = activeType === 'all' || s.types.includes(activeType);
      const matchDistrict = activeDistrict === 'all' || s.district === activeDistrict;
      const matchSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        s.district.toLowerCase().includes(q) ||
        (s.address || '').toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q)) ||
        (s.specialty || '').toLowerCase().includes(q);
      return matchType && matchDistrict && matchSearch;
    })
    .map(s => ({
      ...s,
      dist: (userLat && s.lat) ? distKm(userLat, userLng, s.lat, s.lng) : null,
    }));

  // Sort by selected mode
  if (activeSort === 'distance') {
    if (userLat) {
      filtered.sort((a, b) => (a.dist ?? 999) - (b.dist ?? 999));
    } else {
      // No location yet — trigger geolocation, sort by popularity meanwhile
      filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    }
  } else if (activeSort === 'featured') {
    filtered.sort((a, b) => {
      const fa = b.featured ? 1 : 0, fb = a.featured ? 1 : 0;
      return fa - fb || (b.popularity || 0) - (a.popularity || 0);
    });
  } else {
    // popular (default)
    filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  }

  statsCount.textContent = filtered.length;
  if (statsLabel) {
    const labels = { distance: '間（依距離排序）', featured: '間（官方精選優先）', popular: '間（人氣排行）' };
    statsLabel.textContent = labels[activeSort] || '間';
  }

  renderList(filtered);
  renderMarkers(filtered);
}

// ── RENDER CARDS ──
function renderList(data) {
  if (!data.length) {
    listEl.innerHTML = `<p class="loading-msg">找不到符合的早餐店 😅<br><small>試試換個篩選條件</small></p>`;
    return;
  }

  listEl.innerHTML = data.map(s => {
    const open = isOpenNow(s.hours);
    const tags = s.types.slice(0, 2).map(t => {
      const info = TYPE_LABELS[t];
      return info ? `<span class="tag-mini">${info.icon} ${info.label}</span>` : '';
    }).join('');

    const distBadge = s.dist !== null
      ? `<span class="shop-card__dist">📍 ${fmtDist(s.dist)}</span>`
      : '';

    return `
      <div class="shop-card" data-id="${s.id}" role="button" tabindex="0" aria-label="${s.name}">
        <div class="shop-card__icon" style="background:${s.color || '#f5f5f5'}">${s.icon}</div>
        <div class="shop-card__body">
          <div class="shop-card__name">${s.name}</div>
          <div class="shop-card__meta">
            <span>${s.district}</span>
            <span class="shop-card__dot">·</span>
            <span class="${open ? 'shop-card__status-open' : 'shop-card__status-close'}">
              ${open ? '● 開門中' : '○ 休息中'}
            </span>
            ${distBadge ? `<span class="shop-card__dot">·</span>${distBadge}` : ''}
          </div>
          <div class="shop-card__tags">${tags}</div>
        </div>
        ${s.userFavorite ? '<span class="shop-card__featured shop-card__featured--fav">♥ 主編最愛</span>' : s.featured ? '<span class="shop-card__featured">精選</span>' : ''}
        <span class="shop-card__arrow">›</span>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.shop-card').forEach(el => {
    el.addEventListener('click', () => {
      const shop = filtered.find(s => s.id === el.dataset.id);
      if (shop) openSheet(shop);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.click(); });
  });
}

// ── BOTTOM SHEET ──
function openSheet(shop) {
  focusShop(shop);

  const open = isOpenNow(shop.hours);
  const tags = shop.types.map(t => {
    const info = TYPE_LABELS[t];
    return info ? `<span class="tag ${info.cls}">${info.icon} ${info.label}</span>` : '';
  }).join('');

  const distLine = shop.dist !== null
    ? `<div class="info-item"><div class="info-item__label">距你</div><div class="info-item__value">📍 ${fmtDist(shop.dist)}</div></div>`
    : '';

  bottomSheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-body">
      <div class="sheet-icon-wrap" style="background:${shop.color || '#f5f5f5'}">${shop.icon}</div>
      <div class="sheet-name">${shop.name}</div>
      <div class="sheet-location">📍 台中市 ${shop.district}</div>
      <div class="sheet-tags">${tags}</div>
      <p class="sheet-desc">${shop.desc}</p>
      <div class="sheet-info">
        <div class="info-item">
          <div class="info-item__label">招牌</div>
          <div class="info-item__value">${shop.specialty}</div>
        </div>
        <div class="info-item">
          <div class="info-item__label">均消</div>
          <div class="info-item__value">$${shop.price}</div>
        </div>
        <div class="info-item">
          <div class="info-item__label">營業時間</div>
          <div class="info-item__value">${shop.hours}</div>
        </div>
        <div class="info-item">
          <div class="info-item__label">狀態</div>
          <div class="info-item__value" style="color:${open ? '#2E7D32' : '#999'}">
            ${open ? '● 現在開門' : '○ 目前休息'}
          </div>
        </div>
        ${shop.closedDay ? `
        <div class="info-item">
          <div class="info-item__label">公休</div>
          <div class="info-item__value">${shop.closedDay}</div>
        </div>` : ''}
        ${distLine}
      </div>
      <div class="sheet-actions">
        <a class="sheet-btn sheet-btn--primary"
           href="https://www.google.com/maps/search/${encodeURIComponent(shop.name + ' ' + shop.address || shop.district + ' 台中市')}"
           target="_blank" rel="noopener">
          🗺️ Google Maps 導航
        </a>
        <button class="sheet-btn sheet-btn--ghost" id="sheet-close">✕ 關閉</button>
      </div>
    </div>
  `;

  sheetOverlay.classList.add('sheet-overlay--open');
  bottomSheet.classList.add('bottom-sheet--open');
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
}

function closeSheet() {
  sheetOverlay.classList.remove('sheet-overlay--open');
  bottomSheet.classList.remove('bottom-sheet--open');
  resetView();
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
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { searchQuery = searchInput.value; applyFilters(); }});
  searchInput.addEventListener('input', () => { if (!searchInput.value) { searchQuery = ''; applyFilters(); }});

  typeChips.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
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

  btnLocate?.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    btnLocate.textContent = '⏳ 定位中...';
    navigator.geolocation.getCurrentPosition(
      pos => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        updateLocateBtn(true);
        applyFilters();
        // Scroll to list
        document.getElementById('list-section')?.scrollIntoView({ behavior: 'smooth' });
      },
      () => {
        btnLocate.textContent = '📍 找我附近的';
      },
      { timeout: 8000 }
    );
  });

  sheetOverlay.addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  // Sort tabs
  sortBar?.addEventListener('click', e => {
    const tab = e.target.closest('.sort-tab');
    if (!tab) return;
    sortBar.querySelectorAll('.sort-tab').forEach(t => t.classList.remove('sort-tab--active'));
    tab.classList.add('sort-tab--active');
    activeSort = tab.dataset.sort;

    if (activeSort === 'distance' && !userLat) {
      // Prompt for location
      if (!navigator.geolocation) { applyFilters(); return; }
      tab.textContent = '⏳ 定位中...';
      navigator.geolocation.getCurrentPosition(
        pos => {
          userLat = pos.coords.latitude;
          userLng = pos.coords.longitude;
          updateLocateBtn(true);
          tab.textContent = '📍 距離最近';
          applyFilters();
        },
        () => {
          tab.textContent = '📍 距離最近';
          applyFilters();
        },
        { timeout: 8000 }
      );
      return;
    }
    applyFilters();
  });
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
