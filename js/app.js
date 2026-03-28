// ── MORNING TW — App Entry ──
import { loadBreakfasts, TYPES, REGIONS, REGION_HIGHLIGHTS, TYPE_LABELS } from './data.js';
import { initMap, renderMarkers, focusShop, resetView, locateUser } from './map.js';

// ── STATE ──
let allData = [];
let filtered = [];
let activeType = 'all';
let activeRegion = 'all';
let searchQuery = '';

// ── DOM REFS ──
const listEl     = document.getElementById('breakfast-list');
const statsCount = document.getElementById('stats-count');
const searchInput = document.getElementById('search-input');
const searchBtn   = document.getElementById('search-btn');
const typeChips   = document.getElementById('type-chips');
const regionTabs  = document.getElementById('region-tabs');
const btnLocate   = document.getElementById('btn-locate');
const sheetOverlay = document.getElementById('sheet-overlay');
const bottomSheet  = document.getElementById('bottom-sheet');

// ── INIT ──
(async () => {
  allData = await loadBreakfasts();
  renderRegionHighlights();
  initMap(handleMarkerClick);
  applyFilters();
  setupEventListeners();
})();

// ── FILTERS ──
function applyFilters() {
  const q = searchQuery.trim().toLowerCase();
  filtered = allData.filter(s => {
    const matchType = activeType === 'all' || s.types.includes(activeType);
    const matchRegion = activeRegion === 'all' || s.region === activeRegion;
    const matchSearch = !q ||
      s.name.toLowerCase().includes(q) ||
      s.city.toLowerCase().includes(q) ||
      s.district.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q)) ||
      (s.specialty || '').toLowerCase().includes(q);
    return matchType && matchRegion && matchSearch;
  });

  // Featured first
  filtered.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));

  statsCount.textContent = filtered.length;
  renderList(filtered);
  renderMarkers(filtered);
}

// ── RENDER LIST ──
function renderList(data) {
  if (!data.length) {
    listEl.innerHTML = `<p class="loading-msg">找不到符合條件的早餐店 😅<br><small>試試換個篩選條件</small></p>`;
    return;
  }

  listEl.innerHTML = data.map(s => cardHTML(s)).join('');

  listEl.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => {
      const shop = allData.find(s => s.id === el.dataset.id);
      if (shop) openSheet(shop);
    });
  });
}

function cardHTML(s) {
  const typeTags = s.types.map(t => {
    const info = TYPE_LABELS[t];
    if (!info) return '';
    return `<span class="tag ${info.cls}">${info.icon} ${info.label}</span>`;
  }).join('');

  const openStatus = isOpenNow(s.hours)
    ? `<span class="card__hours-open">● 現在開門</span>`
    : `<span class="card__hours-closed">○ 目前休息</span>`;

  return `
    <article class="card" data-id="${s.id}" role="button" tabindex="0">
      <div class="card__img-placeholder">${s.icon}</div>
      <div class="card__body">
        <div class="card__top">
          <div class="card__name">${s.name}</div>
          ${s.featured ? '<span class="card__featured">精選</span>' : ''}
        </div>
        <div class="card__location">📍 ${s.city} ${s.district}</div>
        <div class="card__tags">${typeTags}</div>
        <div class="card__hours">${openStatus} · ${s.hours}</div>
        <div class="card__footer">
          <div class="card__price">均消 <strong>$${s.price}</strong></div>
          <button class="card__nav-btn" onclick="event.stopPropagation(); window.open('https://www.google.com/maps/search/${encodeURIComponent(s.name + ' ' + s.city)}', '_blank')">
            🗺️ 導航
          </button>
        </div>
      </div>
    </article>
  `;
}

// ── BOTTOM SHEET ──
function openSheet(shop) {
  focusShop(shop);

  const typeTags = shop.types.map(t => {
    const info = TYPE_LABELS[t];
    return info ? `<span class="tag ${info.cls}">${info.icon} ${info.label}</span>` : '';
  }).join('');

  const openStatus = isOpenNow(shop.hours)
    ? `<span style="color:#2E7D32;font-weight:600">● 現在開門</span>`
    : `<span style="color:#C62828;font-weight:600">○ 目前休息</span>`;

  bottomSheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-body">
      <div class="sheet-img" style="font-size:70px">${shop.icon}</div>
      <div class="sheet-name">${shop.name}</div>
      <div class="sheet-location">📍 ${shop.city} ${shop.district}</div>
      <div class="sheet-tags">${typeTags}</div>
      <p class="sheet-desc">${shop.desc}</p>
      <div class="sheet-info">
        <div class="sheet-info-item">
          <div class="sheet-info-item__label">招牌</div>
          <div class="sheet-info-item__value">${shop.specialty}</div>
        </div>
        <div class="sheet-info-item">
          <div class="sheet-info-item__label">均消</div>
          <div class="sheet-info-item__value">$${shop.price}</div>
        </div>
        <div class="sheet-info-item">
          <div class="sheet-info-item__label">營業時間</div>
          <div class="sheet-info-item__value">${shop.hours}</div>
        </div>
        <div class="sheet-info-item">
          <div class="sheet-info-item__label">狀態</div>
          <div class="sheet-info-item__value">${openStatus}</div>
        </div>
        ${shop.closedDay ? `
        <div class="sheet-info-item">
          <div class="sheet-info-item__label">公休日</div>
          <div class="sheet-info-item__value">${shop.closedDay}</div>
        </div>` : ''}
      </div>
      <div class="sheet-actions">
        <a class="sheet-btn sheet-btn--primary"
           href="https://www.google.com/maps/search/${encodeURIComponent(shop.name + ' ' + shop.city)}"
           target="_blank">
          🗺️ Google Maps 導航
        </a>
        <button class="sheet-btn sheet-btn--ghost" id="sheet-close-btn">
          ✕ 關閉
        </button>
      </div>
    </div>
  `;

  sheetOverlay.classList.add('sheet-overlay--open');
  bottomSheet.classList.add('bottom-sheet--open');

  document.getElementById('sheet-close-btn').addEventListener('click', closeSheet);
}

function closeSheet() {
  sheetOverlay.classList.remove('sheet-overlay--open');
  bottomSheet.classList.remove('bottom-sheet--open');
  resetView();
}

// ── REGION HIGHLIGHTS ──
function renderRegionHighlights() {
  const grid = document.getElementById('region-grid');
  if (!grid) return;

  grid.innerHTML = REGION_HIGHLIGHTS.map(r => `
    <div class="region-card" data-region="${r.region}">
      <div class="region-card__icon">${r.icon}</div>
      <div class="region-card__name">${r.name}</div>
      <div class="region-card__special">${r.specialty}</div>
      <span class="region-card__badge">${r.badge}</span>
    </div>
  `).join('');

  grid.querySelectorAll('.region-card').forEach(el => {
    el.addEventListener('click', () => {
      const region = el.dataset.region;
      setActiveRegion(region);
      document.getElementById('filter-section').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

// ── EVENT LISTENERS ──
function setupEventListeners() {
  // Search
  searchBtn.addEventListener('click', () => {
    searchQuery = searchInput.value;
    applyFilters();
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      searchQuery = searchInput.value;
      applyFilters();
    }
  });

  searchInput.addEventListener('input', () => {
    if (!searchInput.value) {
      searchQuery = '';
      applyFilters();
    }
  });

  // Type chips
  typeChips.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    typeChips.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    activeType = chip.dataset.type;
    applyFilters();
  });

  // Region tabs
  regionTabs.addEventListener('click', e => {
    const tab = e.target.closest('.rtab');
    if (!tab) return;
    setActiveRegion(tab.dataset.region);
  });

  // Locate
  btnLocate?.addEventListener('click', () => {
    locateUser((lat, lng) => {
      const sorted = allData.map(s => ({
        ...s,
        dist: s.lat ? Math.hypot(s.lat - lat, s.lng - lng) : Infinity,
      })).sort((a, b) => a.dist - b.dist);

      filtered = sorted.slice(0, 10);
      statsCount.textContent = filtered.length;
      renderList(filtered);
      renderMarkers(filtered);
    });
  });

  // Sheet overlay
  sheetOverlay.addEventListener('click', closeSheet);

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSheet();
  });
}

function setActiveRegion(region) {
  regionTabs.querySelectorAll('.rtab').forEach(t => {
    t.classList.toggle('rtab--active', t.dataset.region === region);
  });
  activeRegion = region;
  applyFilters();
}

function handleMarkerClick(shop) {
  openSheet(shop);
}

// ── OPEN STATUS HELPER ──
function isOpenNow(hoursStr) {
  if (!hoursStr || hoursStr === '24小時') return true;
  try {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const cur = h * 60 + m;
    const match = hoursStr.match(/(\d{1,2}):(\d{2})[–~-](\d{1,2}):(\d{2})/);
    if (!match) return true;
    const open  = parseInt(match[1]) * 60 + parseInt(match[2]);
    const close = parseInt(match[3]) * 60 + parseInt(match[4]);
    return cur >= open && cur < close;
  } catch {
    return true;
  }
}
