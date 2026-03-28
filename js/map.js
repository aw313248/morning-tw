// ── MORNING TW — Map Module ──
import { TYPE_LABELS } from './data.js';

let map = null;
let markers = [];
let activeMarkerId = null;

const TAIWAN_CENTER = [23.5, 121.0];
const DEFAULT_ZOOM = 7;

export function initMap(onMarkerClick) {
  if (map) return;

  map = L.map('map-container', {
    center: TAIWAN_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  window._mapOnMarkerClick = onMarkerClick;
}

export function renderMarkers(data) {
  markers.forEach(m => m.marker.remove());
  markers = [];

  data.forEach(shop => {
    if (!shop.lat || !shop.lng) return;

    const icon = L.divIcon({
      className: '',
      html: `<div class="map-pin${shop.featured ? ' map-pin--featured' : ''}" data-id="${shop.id}">
        <span>${shop.icon}</span>
      </div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
    });

    const marker = L.marker([shop.lat, shop.lng], { icon })
      .addTo(map)
      .on('click', () => window._mapOnMarkerClick(shop));

    markers.push({ id: shop.id, marker });
  });
}

export function focusShop(shop) {
  if (!map || !shop.lat) return;
  map.flyTo([shop.lat, shop.lng], 15, { duration: 0.8 });
  setActiveMarker(shop.id);
}

export function resetView() {
  if (!map) return;
  map.flyTo(TAIWAN_CENTER, DEFAULT_ZOOM, { duration: 0.6 });
  setActiveMarker(null);
}

function setActiveMarker(id) {
  document.querySelectorAll('.map-pin').forEach(el => {
    el.classList.toggle('map-pin--active', el.dataset.id === id);
  });
  activeMarkerId = id;
}

export function locateUser(onResult) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude } = pos.coords;
    if (map) map.flyTo([latitude, longitude], 14, { duration: 0.8 });
    onResult(latitude, longitude);
  });
}
