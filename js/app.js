// ── MORNING TW — App ──
import { initMap, renderMarkers, focusShop, resetView, locateUser } from './map.js';

const TYPE_LABELS = {
  egg:   { label: '蛋餅燒餅', icon: '🥚', cls: 'tag--egg' },
  rice:  { label: '飯糰粥',   icon: '🍚', cls: 'tag--rice' },
  soup:  { label: '湯品',     icon: '🍜', cls: 'tag--soup' },
  local: { label: '在地特色', icon: '📍', cls: 'tag--local' },
  drink: { label: '豆漿飲料', icon: '🫘', cls: 'tag--drink' },
};

let allData = [], filtered = [];
let activeType = 'all', searchQuery = '';

const listEl      = document.getElementById('breakfast-list');
const statsCount  = document.getElementById('stats-count');
const searchInput = document.getElementById('search-input');
const searchBtn   = document.getElementById('search-btn');
const typeChips   = document.getElementById('type-chips');
const btnLocate   = document.getElementById('btn-locate');
const sheetOverlay = document.getElementById('sheet-overlay');
const bottomSheet  = document.getElementById('bottom-sheet');

(async () => {
  const res = await fetch('data/breakfasts.json');
  allData = await res.json();
  buildMarquee(allData);
  initMap(openSheet);
  applyFilters();
  setupEvents();
})();

// ── BUILD MARQUEE ──
function buildMarquee(data) {
  const track = document.getElementById('marquee-track');
  if (!track) return;

  // Duplicate for infinite loop
  const items = [...data, ...data].map(s => `
    <div class="marquee-item" data-id="${s.id}">
      <div class="marquee-item__icon" style="background:${s.color || '#f5f5f5'}">
        ${s.icon}
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

// ── FILTERS ──
function applyFilters() {
  const q = searchQuery.trim().toLowerCase();
  filtered = allData.filter(s => {
    const matchType   = activeType === 'all' || s.types.includes(activeType);
    const matchSearch = !q ||
      s.name.toLowerCase().includes(q) ||
      s.district.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q)) ||
      (s.specialty || '').toLowerCase().includes(q);
    return matchType && matchSearch;
  });

  filtered.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));

  statsCount.textContent = filtered.length;
  renderList(filtered);
  renderMarkers(filtered);
}

// ── RENDER CARDS (Findrink style) ──
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

    return `
      <div class="shop-card" data-id="${s.id}" role="button" tabindex="0" aria-label="${s.name}">
        <div class="shop-card__icon" style="background:${s.color || '#f5f5f5'}">${s.icon}</div>
        <div class="shop-card__body">
          <div class="shop-card__name">${s.name}</div>
          <div class="shop-card__meta">
            <span>${s.district}</span>
            <span class="shop-card__dot">·</span>
            <span class="${open ? 'shop-card__status-open' : 'shop-card__status-close'}">
              ${open ? '● 現在開門' : '○ 目前休息'}
            </span>
          </div>
          <div class="shop-card__tags">${tags}</div>
        </div>
        ${s.featured ? '<span class="shop-card__featured">精選</span>' : ''}
        <span class="shop-card__arrow">›</span>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.shop-card').forEach(el => {
    el.addEventListener('click', () => {
      const shop = allData.find(s => s.id === el.dataset.id);
      if (shop) openSheet(shop);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') el.click();
    });
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

  bottomSheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-body">
      <div class="sheet-icon-wrap" style="background:${shop.color || '#f5f5f5'}">${shop.icon}</div>
      <div class="sheet-name">${shop.name}</div>
      <div class="sheet-location">📍 ${shop.city} ${shop.district}</div>
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
      </div>
      <div class="sheet-actions">
        <a class="sheet-btn sheet-btn--primary"
           href="https://www.google.com/maps/search/${encodeURIComponent(shop.name + ' ' + shop.district + ' 台中')}"
           target="_blank" rel="noopener">
          🗺️ Google Maps
        </a>
        <button class="sheet-btn sheet-btn--ghost" id="sheet-close">
          ✕ 關閉
        </button>
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

  btnLocate?.addEventListener('click', () => {
    locateUser((lat, lng) => {
      const near = allData
        .map(s => ({ ...s, dist: s.lat ? Math.hypot(s.lat - lat, s.lng - lng) : Infinity }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 8);
      filtered = near;
      statsCount.textContent = filtered.length;
      renderList(filtered);
      renderMarkers(filtered);
    });
  });

  sheetOverlay.addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
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
