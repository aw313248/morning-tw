// ── MORNING TW — Map ──
let map = null, markers = [];

const TAICHUNG_CENTER = [24.148, 120.674];
const DEFAULT_ZOOM = 12;

// 台中主要大學 — 地圖上隱約顯示
const UNIVERSITIES = [
  { name: '中興大學',     lat: 24.1253, lng: 120.6761 },
  { name: '中山醫學大學', lat: 24.1301, lng: 120.6739 },
  { name: '中國醫藥大學', lat: 24.1524, lng: 120.6812 },
  { name: '台中科技大學', lat: 24.1380, lng: 120.6847 },
  { name: '台中教育大學', lat: 24.1432, lng: 120.6618 },
  { name: '逢甲大學',     lat: 24.1792, lng: 120.6386 },
  { name: '東海大學',     lat: 24.1746, lng: 120.5988 },
  { name: '亞洲大學',     lat: 24.0601, lng: 120.7190 },
  { name: '朝陽科技大學', lat: 24.0648, lng: 120.7028 },
];

export function initMap(onMarkerClick) {
  if (map) return;
  map = L.map('map-container', {
    center: TAICHUNG_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
    attributionControl: false,
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  window._mapClick = onMarkerClick;
  _renderUniversities();
}

function _renderUniversities() {
  UNIVERSITIES.forEach(u => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="uni-pin">
        <div class="uni-pin__dot"><span>🎓</span></div>
        <div class="uni-pin__name">${u.name}</div>
      </div>`,
      iconSize: [90, 44], iconAnchor: [45, 14],
    });
    L.marker([u.lat, u.lng], { icon, interactive: false, zIndexOffset: -100 })
      .addTo(map);
  });
}

export function renderMarkers(data) {
  if (!map) return; // map not yet initialized (lazy-load)
  markers.forEach(m => m.marker.remove());
  markers = [];
  data.forEach(s => {
    if (!s.lat || !s.lng) return;
    const icon = L.divIcon({
      className: '',
      html: `<div class="map-pin${s.featured ? ' map-pin--featured' : ''}" data-id="${s.id}"><span>${s.icon}</span></div>`,
      iconSize: [32, 32], iconAnchor: [16, 32],
    });
    const marker = L.marker([s.lat, s.lng], { icon })
      .addTo(map)
      .on('click', () => window._mapClick(s));
    markers.push({ id: s.id, marker });
  });
}

export function focusShop(shop) {
  if (!map || !shop.lat) return;
  map.flyTo([shop.lat, shop.lng], 15, { duration: 0.8 });
  document.querySelectorAll('.map-pin').forEach(el => {
    el.classList.toggle('map-pin--active', el.dataset.id === shop.id);
  });
}

export function resetView() {
  if (!map) return;
  map.flyTo(TAICHUNG_CENTER, DEFAULT_ZOOM, { duration: 0.6 });
  document.querySelectorAll('.map-pin').forEach(el => el.classList.remove('map-pin--active'));
}

export function invalidateSize() {
  if (map) map.invalidateSize();
}

export function locateUser(onResult) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    if (map) map.flyTo([lat, lng], 14, { duration: 0.8 });
    onResult(lat, lng);
  });
}
