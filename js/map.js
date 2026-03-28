// ── MORNING TW — Map ──
let map = null, markers = [];

const TAICHUNG_CENTER = [24.148, 120.674];
const DEFAULT_ZOOM = 12;

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
}

export function renderMarkers(data) {
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

export function locateUser(onResult) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    if (map) map.flyTo([lat, lng], 14, { duration: 0.8 });
    onResult(lat, lng);
  });
}
