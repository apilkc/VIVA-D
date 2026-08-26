'use strict';

const DEFAULT_CENTER = [28.17, 85.36];
const DEFAULT_ZOOM = 11;
const MINI_ZOOM = 13;

// Bhote Koshi river polyline points (approximate path through Rasuwa district)
const RIVER_POINTS = [
  [28.2200, 85.2800], [28.2150, 85.2900], [28.2100, 85.3000],
  [28.2050, 85.3100], [28.2000, 85.3200], [28.1950, 85.3300],
  [28.1900, 85.3400], [28.1850, 85.3500], [28.1800, 85.3600],
  [28.1750, 85.3700], [28.1700, 85.3800], [28.1650, 85.3900],
  [28.1600, 85.4000], [28.1550, 85.4100], [28.1500, 85.4200],
  [28.1450, 85.4300], [28.1400, 85.4400], [28.1350, 85.4500],
  [28.1300, 85.4600], [28.1250, 85.4700], [28.1200, 85.4800],
  [28.1150, 85.4900], [28.1100, 85.5000],
];

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function shorten(s, n) {
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}

function parseSocial(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'facebook.com' || host === 'fb.watch' || host.endsWith('.facebook.com')) {
      const pathId = parsed.pathname.match(/\/(?:videos?|reel|reels|posts|story)\/([0-9]+)/i);
      return { platform: 'facebook', postId: pathId ? pathId[1] : parsed.searchParams.get('v') || '' };
    }
    if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com')) {
      const status = parsed.pathname.match(/\/status\/([0-9]+)/i);
      return { platform: 'x', postId: status ? status[1] : '' };
    }
  } catch {
    return null;
  }
  return null;
}

function $(sel) { return document.querySelector(sel); }

const itemsById = new Map();
const markers = new Map();

const map = L.map('map', { minZoom: 7 }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
});
streetLayer.addTo(map);

const mapConfigPromise = fetch('/api/config')
  .then((res) => res.ok ? res.json() : {})
  .catch(() => ({}));
let googleSatelliteLayer = null;
let googleSatellitePromise = null;
let mapStyleRequest = 0;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the map provider.'));
    document.head.appendChild(script);
  });
}

function loadGoogleMapsApi(apiKey) {
  if (window.google && window.google.maps) return Promise.resolve();
  const callbackName = '__rasuwaGoogleMapsReady' + Date.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      delete window[callbackName];
      reject(new Error('Google Maps took too long to load.'));
    }, 15000);
    window[callbackName] = () => {
      clearTimeout(timer);
      delete window[callbackName];
      resolve();
    };
    const query = new URLSearchParams({ key: apiKey, v: 'weekly', loading: 'async', callback: callbackName });
    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?' + query.toString();
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      delete window[callbackName];
      reject(new Error('Google Maps could not be loaded.'));
    };
    document.head.appendChild(script);
  });
}

async function getGoogleSatelliteLayer() {
  if (googleSatelliteLayer) return googleSatelliteLayer;
  if (!googleSatellitePromise) {
    googleSatellitePromise = mapConfigPromise.then(async (config) => {
      if (!config.googleMapsApiKey) throw new Error('Google satellite is not configured.');
      await loadGoogleMapsApi(config.googleMapsApiKey);
      await loadScript('https://cdn.jsdelivr.net/npm/leaflet.gridlayer.googlemutant@0.16.0/dist/Leaflet.GoogleMutant.js');
      if (!L.gridLayer || typeof L.gridLayer.googleMutant !== 'function') throw new Error('Google satellite adapter could not be loaded.');
      googleSatelliteLayer = L.gridLayer.googleMutant({ type: 'satellite', maxZoom: 20 });
      return googleSatelliteLayer;
    });
  }
  return googleSatellitePromise;
}

function activateStreetLayer() {
  if (googleSatelliteLayer && map.hasLayer(googleSatelliteLayer)) map.removeLayer(googleSatelliteLayer);
  if (!map.hasLayer(streetLayer)) map.addLayer(streetLayer);
  streetLayer.bringToFront();
  map.invalidateSize({ pan: false });
  $('#streetMapBtn').classList.add('active');
  $('#satelliteMapBtn').classList.remove('active');
  $('#streetMapBtn').setAttribute('aria-pressed', 'true');
  $('#satelliteMapBtn').setAttribute('aria-pressed', 'false');
}

async function setMapStyle(style) {
  const satellite = style === 'satellite';
  const request = ++mapStyleRequest;
  if (satellite) {
    try {
      const layer = await getGoogleSatelliteLayer();
      if (request !== mapStyleRequest) return;
      if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer);
      layer.addTo(map);
    } catch {
      if (request === mapStyleRequest) toast('Google Satellite needs a Google Maps API key before it can be used.');
      activateStreetLayer();
      return;
    }
  } else {
    activateStreetLayer();
    return;
  }
  $('#streetMapBtn').classList.toggle('active', !satellite);
  $('#satelliteMapBtn').classList.toggle('active', satellite);
  $('#streetMapBtn').setAttribute('aria-pressed', String(!satellite));
  $('#satelliteMapBtn').setAttribute('aria-pressed', String(satellite));
}

function pinSizeForZoom(zoom) {
  if (zoom <= 9) return 18;
  if (zoom <= 10) return 22;
  if (zoom <= 11) return 26;
  if (zoom <= 12) return 30;
  if (zoom <= 13) return 34;
  if (zoom <= 14) return 38;
  return 40;
}

function pinIcon(type, zoom = map.getZoom()) {
  const emoji = type === 'video' ? '🎥' : '📷';
  const size = pinSizeForZoom(zoom);
  const emojiSize = Math.max(10, Math.round(size * 0.47));
  return L.divIcon({
    className: 'pin-wrap',
    html: '<div class="pin ' + type + '" style="width:' + size + 'px;height:' + size + 'px"><span style="font-size:' + emojiSize + 'px">' + emoji + '</span></div>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -Math.round(size * 0.9)],
  });
}

window.thumbFallback = function thumbFallback() {
  return '<div class="popup-thumb video">📷 Preview unavailable — open the archived file in Google Drive</div>';
};

function mediaThumb(item, popup = true) {
  const className = popup ? 'popup-thumb' : 'detail-media';
  if (item.media_type === 'video') {
    if (item.previewUrl) {
      const frameClass = popup ? 'popup-thumb popup-video-frame' : 'detail-media video-frame';
      return '<iframe class="' + frameClass + '" src="' + esc(item.previewUrl) + '" title="Archived video preview" allow="autoplay; fullscreen" allowfullscreen></iframe>';
    }
    return '<div class="' + className + ' video">🎥 Archived video preview unavailable</div>';
  }
  if (!item.thumbnailUrl) {
    return '<div class="' + className + ' video">📷 Preview unavailable</div>';
  }
  return '<img class="' + className + '" src="' + esc(item.thumbnailUrl) + '" alt="" loading="lazy" onerror="this.outerHTML = thumbFallback()">';
}

function sourceLabel(item) {
  if (!item.source_url) return '';
  const platform = item.source_platform === 'x' ? 'X/Twitter' : item.source_platform === 'facebook' ? 'Facebook' : 'social post';
  return '<a class="source-link" href="' + esc(item.source_url) + '" target="_blank" rel="noopener noreferrer">Original ' + platform + ' post ↗</a>';
}

function popupHtml(item) {
  const metaBits = [];
  if (item.location_name) metaBits.push(esc(item.location_name));
  if (item.captured_at) metaBits.push(esc(item.captured_at));
  const meta = metaBits.length ? '<p class="popup-meta">' + metaBits.join(' · ') + '</p>' : '';
  const desc = item.description ? '<p class="popup-desc">' + esc(shorten(item.description, 180)) + '</p>' : '';
  const downvoteCount = item.downvotes || 0;
  const downvoteBtn = '<button class="btn-downvote" type="button" onclick="downvoteItem(' + item.id + ')" title="Flag as inaccurate">👎' + (downvoteCount > 0 ? ' <span class="downvote-count">' + downvoteCount + '</span>' : '') + '</button>';
  return '<div class="popup-card">' + mediaThumb(item) + '<h3>' + esc(item.title) + '</h3>' + meta + desc + sourceLabel(item) + '<div class="popup-actions"><a class="btn-primary btn-sm" href="' + esc(item.previewUrl || item.drive_url) + '" target="_blank" rel="noopener noreferrer">Open archived media</a><button class="btn-ghost btn-sm" type="button" onclick="openDetail(' + item.id + ')">More details</button>' + downvoteBtn + '</div></div>';
}

function addItem(item) {
  itemsById.set(item.id, item);
  const marker = L.marker([item.lat, item.lng], { icon: pinIcon(item.media_type), title: item.title }).addTo(map);
  marker.bindPopup(popupHtml(item), { maxWidth: 340 });
  markers.set(item.id, marker);
  updateCount();
  $('#emptyState').classList.add('hidden');
}

async function loadItems() {
  try {
    const res = await fetch('/api/items');
    if (!res.ok) throw new Error('Bad response');
    const data = await res.json();
    data.items.forEach(addItem);
    if (itemsById.size === 0) $('#emptyState').classList.remove('hidden');
  } catch {
    toast('Could not load the map data. Check that the server is running.');
  }
}

function updateCount() {
  const n = itemsById.size;
  $('#countChip').textContent = n + (n === 1 ? ' item' : ' items');
}

window.detailImgFallback = function detailImgFallback() {
  return '<div class="detail-video">📷 Archived preview unavailable — open the file in Google Drive</div>';
};

window.downvoteItem = async function downvoteItem(id) {
  try {
    const res = await fetch('/api/items/' + id + '/downvote', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Could not record feedback.'); return; }
    toast(data.message || 'Thank you for your feedback.');
    const item = itemsById.get(id);
    if (item) {
      item.downvotes = (item.downvotes || 0) + 1;
      if (item.downvotes >= 50) {
        const marker = markers.get(id);
        if (marker) { map.removeLayer(marker); markers.delete(id); }
        itemsById.delete(id);
        updateCount();
        toast('This item has been hidden due to community feedback.');
      } else {
        const marker = markers.get(id);
        if (marker) marker.setPopupContent(popupHtml(item));
      }
    }
    closeModal('detailModal');
  } catch {
    toast('Could not record feedback. Please try again.');
  }
};

function detailHtml(item) {
  const rows = [
    ['Type', item.media_type === 'photo' ? '📷 Photo' : '🎥 Video'],
    ['Stored in', 'Project Google Drive archive'],
    ['File', esc(item.original_filename || 'Archived media')],
    ['Location', esc(item.location_name || 'Not provided') + ' <span class="coords">(' + item.lat.toFixed(5) + ', ' + item.lng.toFixed(5) + ')</span>'],
    ['When taken', esc(item.captured_at || 'Not provided')],
    ['Taken by', esc(item.taken_by || 'Not provided')],
    ['Owner / rights', esc(item.owner || 'Not provided')],
    ['Contact', esc(item.contact || 'Not provided')],
    ['Added on', esc(new Date(item.submitted_at).toLocaleString())],
  ];
  if (item.source_url) rows.splice(3, 0, ['Original source', sourceLabel(item)]);
  const downvotes = item.downvotes || 0;
  if (downvotes > 0) rows.push(['Community feedback', downvotes + ' downvote' + (downvotes === 1 ? '' : 's')]);
  const meta = rows.map(([key, value]) => '<tr><td>' + key + '</td><td>' + value + '</td></tr>').join('');
  const descBlock = item.description ? '<div class="detail-desc"><h3>What happened</h3><p>' + esc(item.description) + '</p></div>' : '';
  return '<h3 class="detail-title">' + esc(item.title) + '</h3><span class="detail-badge">' + (item.media_type === 'photo' ? 'Photo' : 'Video') + '</span>' + mediaThumb(item, false) + descBlock + '<table class="meta-table"><tbody>' + meta + '</tbody></table><div class="detail-actions"><a class="btn-primary" href="' + esc(item.previewUrl || item.drive_url) + '" target="_blank" rel="noopener noreferrer">Open archived media ↗</a><button class="btn-downvote-detail" type="button" onclick="downvoteItem(' + item.id + ')" title="Flag as inaccurate">👎 Flag as inaccurate</button></div><p class="verify-note">The archived copy is the primary evidence record. The original social link is preserved separately as provenance. Items flagged by 50+ community members are automatically hidden.</p>';
}

window.openDetail = function openDetail(id) {
  const item = itemsById.get(id);
  if (!item) return;
  $('#detailBody').innerHTML = detailHtml(item);
  $('#detailModal').classList.remove('hidden');
};

function openModal(id) { $('#' + id).classList.remove('hidden'); }
function closeModal(id) { $('#' + id).classList.add('hidden'); }
window.closeModal = closeModal;

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

const miniMap = L.map('miniMap', { attributionControl: false }).setView(DEFAULT_CENTER, MINI_ZOOM);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(miniMap);
const pin = L.marker(DEFAULT_CENTER, { draggable: true }).addTo(miniMap);
let selectedLat = null;
let selectedLng = null;
let locationConfirmed = false;

function setLocation(latlng) {
  selectedLat = latlng[0];
  selectedLng = latlng[1];
  locationConfirmed = true;
  $('#locStatus').textContent = '✓ Location set: ' + latlng[0].toFixed(5) + ', ' + latlng[1].toFixed(5);
  reverseGeocode(latlng[0], latlng[1]).then((name) => { if (name) $('#locationName').value = name; });
}
miniMap.on('click', (e) => { pin.setLatLng(e.latlng); setLocation([e.latlng.lat, e.latlng.lng]); });
pin.on('dragend', () => setLocation([pin.getLatLng().lat, pin.getLatLng().lng]));

async function reverseGeocode(lat, lng) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.display_name === 'string' ? data.display_name : null;
  } catch { return null; }
}

function showErrors(errors) {
  const box = $('#formErrors');
  if (!errors.length) { box.classList.add('hidden'); return; }
  box.innerHTML = '<ul>' + errors.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>';
  box.classList.remove('hidden');
}

function currentMode() {
  return document.querySelector('input[name="ingest_mode"]:checked').value;
}

function updateIngestMode() {
  const importing = currentMode() === 'import';
  $('#uploadInputBlock').classList.toggle('hidden', importing);
  $('#importInputBlock').classList.toggle('hidden', !importing);
  $('#mediaTypeBlock').classList.toggle('hidden', importing);
  $('#mediaFile').required = !importing;
  if (importing) {
    $('#archiveStatus').classList.add('hidden');
    $('#mediaFile').value = '';
    $('#localPreview').classList.add('hidden');
  } else {
    $('#archiveStatus').classList.remove('hidden');
    $('#sourceUrl').value = '';
    $('#sourceHint').classList.add('hidden');
  }
}

function resetUpload() {
  $('#uploadForm').reset();
  $('#modeUpload').checked = true;
  $('#formErrors').classList.add('hidden');
  $('#localPreview').classList.add('hidden');
  $('#localImagePreview').classList.add('hidden');
  $('#localVideoPreview').classList.add('hidden');
  $('#sourceHint').classList.add('hidden');
  $('#locStatus').textContent = 'Click the map to drop the pin at the exact spot.';
  selectedLat = null;
  selectedLng = null;
  locationConfirmed = false;
  pin.setLatLng(DEFAULT_CENTER);
  miniMap.setView(DEFAULT_CENTER, MINI_ZOOM);
  updateIngestMode();
}

async function updateArchiveStatus() {
  const status = $('#archiveStatus');
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    status.textContent = data.directUploadsEnabled ? 'Google Drive archive connected. Your selected file will be stored there.' : 'Google Drive archive is not connected yet. The site owner must finish the one-time setup before uploads can be archived.';
    status.classList.add(data.directUploadsEnabled ? 'ready' : 'missing');
  } catch { status.textContent = 'Could not check the Google Drive archive connection.'; }
}

function openUpload() {
  resetUpload();
  openModal('uploadModal');
  updateArchiveStatus();
  setTimeout(() => miniMap.invalidateSize(), 80);
}

// Get a random point along the river line
function getRandomRiverPoint() {
  const idx = Math.floor(Math.random() * RIVER_POINTS.length);
  // Add small random offset to avoid stacking
  const lat = RIVER_POINTS[idx][0] + (Math.random() - 0.5) * 0.008;
  const lng = RIVER_POINTS[idx][1] + (Math.random() - 0.5) * 0.008;
  return [lat, lng];
}

// Extract EXIF GPS data from an image file using server endpoint
async function extractGpsFromImage(file) {
  if (!file || !file.type.startsWith('image/')) return null;
  try {
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch('/api/extract-gps', { method: 'POST', body: formData });
    if (!res.ok) return null;
    const data = await res.json();
    return data.gps || null;
  } catch {
    return null;
  }
}

function updateLocalPreview() {
  const file = $('#mediaFile').files[0];
  if (!file) { $('#localPreview').classList.add('hidden'); return; }
  const url = URL.createObjectURL(file);
  const image = $('#localImagePreview');
  const video = $('#localVideoPreview');
  const isImage = file.type.startsWith('image/');
  image.classList.toggle('hidden', !isImage);
  video.classList.toggle('hidden', isImage);
  if (isImage) image.src = url;
  else video.src = url;
  $('#localFileName').textContent = file.name + ' · ' + Math.ceil(file.size / 1024 / 1024) + ' MB';
  $('#localPreview').classList.remove('hidden');

  // Try to extract GPS data from image
  if (isImage && !locationConfirmed && !$('#unknownLocation').checked) {
    extractGpsFromImage(file).then((gps) => {
      if (gps && gps.lat && gps.lng) {
        // Check if within Nepal bounds
        if (gps.lat >= 26 && gps.lat <= 31 && gps.lng >= 79.5 && gps.lng <= 89) {
          pin.setLatLng([gps.lat, gps.lng]);
          miniMap.setView([gps.lat, gps.lng], 15);
          setLocation([gps.lat, gps.lng]);
          toast('📍 GPS location detected from photo!');
        }
      }
    });
  }
}

// Unknown location checkbox handler
function handleUnknownLocation() {
  const checked = $('#unknownLocation').checked;
  if (checked) {
    // Place pin at a random point along the river
    const riverPoint = getRandomRiverPoint();
    pin.setLatLng(riverPoint);
    miniMap.setView(riverPoint, 12);
    setLocation(riverPoint);
    $('#locationName').value = 'Approximate location along Bhote Koshi river';
    toast('📍 Placed approximately along the river. You can adjust the pin if needed.');
  }
}

let metadataTimer = null;

function formatDateForDisplay(ymd) {
  if (!ymd || ymd.length !== 8) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const year = ymd.slice(0, 4);
  const month = months[parseInt(ymd.slice(4, 6), 10) - 1];
  const day = parseInt(ymd.slice(6, 8), 10);
  return month + ' ' + day + ', ' + year;
}

async function fetchSocialMetadata(sourceUrl) {
  const hint = $('#sourceHint');
  try {
    hint.textContent = 'Reading post metadata…';
    hint.classList.remove('hidden');
    const res = await fetch('/api/social-metadata?url=' + encodeURIComponent(sourceUrl));
    const data = await res.json();
    if (!res.ok) { hint.textContent = data.error || 'Could not read metadata.'; return; }
    if (data.title && !$('#title').value.trim()) {
      $('#title').value = data.title.slice(0, 200);
    }
    if (data.description && !$('#description').value.trim()) {
      $('#description').value = data.description.slice(0, 5000);
    }
    if (data.uploader && !$('#takenBy').value.trim()) {
      $('#takenBy').value = data.uploader.slice(0, 200);
    }
    if (data.upload_date && !$('#capturedAt').value.trim()) {
      const formatted = formatDateForDisplay(data.upload_date);
      if (formatted) $('#capturedAt').value = formatted;
    }
    const platform = data.platform === 'x' ? 'X/Twitter' : 'Facebook';
    hint.textContent = 'Detected ' + platform + '. Metadata auto-filled where available. You can edit any field.';
  } catch {
    hint.textContent = 'Could not read metadata. Fill in the fields manually.';
  }
}

function updateSourceHint() {
  const source = $('#sourceUrl').value.trim();
  const hint = $('#sourceHint');
  const parsed = parseSocial(source);
  if (!source) { hint.classList.add('hidden'); clearTimeout(metadataTimer); return; }
  hint.textContent = parsed ? 'Detected ' + (parsed.platform === 'x' ? 'X/Twitter' : 'Facebook') + '. The server will download one public media item and archive it in Google Drive.' : 'Use a public Facebook, X, or Twitter post URL.';
  hint.classList.remove('hidden');
  clearTimeout(metadataTimer);
  if (parsed) {
    metadataTimer = setTimeout(() => fetchSocialMetadata(source), 600);
  }
}

const pendingItems = new Map();

function addPendingMarker(item) {
  itemsById.set(item.id, item);
  const size = pinSizeForZoom(map.getZoom());
  const emoji = item.media_type === 'video' ? '⏳' : '⏳';
  const emojiSize = Math.max(10, Math.round(size * 0.47));
  const icon = L.divIcon({
    className: 'pin-wrap',
    html: '<div class="pin pending" style="width:' + size + 'px;height:' + size + 'px"><span style="font-size:' + emojiSize + 'px">' + emoji + '</span></div>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -Math.round(size * 0.9)],
  });
  const marker = L.marker([item.lat, item.lng], { icon, title: item.title + ' (archiving…)' }).addTo(map);
  marker.bindPopup('<div class="popup-card"><h3>' + esc(item.title) + '</h3><p class="popup-meta">⏳ Archiving media — this item will appear shortly.</p></div>', { maxWidth: 300 });
  markers.set(item.id, marker);
  pendingItems.set(item.id, item);
  updateCount();
  $('#emptyState').classList.add('hidden');
  showStatusBar();
}

function removePendingMarker(id) {
  const marker = markers.get(id);
  if (marker) { map.removeLayer(marker); markers.delete(id); }
  pendingItems.delete(id);
  if (pendingItems.size === 0) hideStatusBar();
}

function showStatusBar() {
  const bar = $('#statusBar');
  if (!bar) return;
  const n = pendingItems.size;
  bar.textContent = n === 1 ? '⏳ Archiving 1 item in the background…' : '⏳ Archiving ' + n + ' items in the background…';
  bar.classList.remove('hidden');
}

function hideStatusBar() {
  const bar = $('#statusBar');
  if (bar) bar.classList.add('hidden');
}

let pollTimer = null;
function startPendingPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (pendingItems.size === 0) { clearInterval(pollTimer); pollTimer = null; return; }
    try {
      const res = await fetch('/api/items?all=1');
      if (!res.ok) return;
      const data = await res.json();
      for (const serverItem of data.items) {
        if (!pendingItems.has(serverItem.id)) continue;
        if (serverItem.status === 'published') {
          removePendingMarker(serverItem.id);
          addItem(serverItem);
          toast('✔ ' + serverItem.title + ' is now on the map');
        } else if (serverItem.status === 'failed') {
          removePendingMarker(serverItem.id);
          toast('⚠ ' + serverItem.title + ' — archiving failed');
        }
      }
    } catch { /* retry next cycle */ }
  }, 5000);
}

function validateForm() {
  const errors = [];
  const importing = currentMode() === 'import';
  const file = $('#mediaFile').files[0];
  const source = $('#sourceUrl').value.trim();
  const title = $('#title').value.trim();

  if (importing) {
    if (!source) errors.push('Paste the Facebook, X, or Twitter post link to import.');
    else if (!parseSocial(source)) errors.push('The source link must be a Facebook, X, or Twitter post link.');
  } else {
    if (!file) errors.push('Choose the photo or video you want to archive.');
    if (file && !/^(image|video)\//.test(file.type)) errors.push('Choose an image or video file.');
  }
  if (!locationConfirmed) errors.push('Set the location by clicking the map or checking "I don\'t know exact location".');
  if (!title) errors.push('Give this item a short title.');
  if (!$('#ackCheck').checked) errors.push('Tick the confirmation box to state this item is authentic.');
  return errors;
}

async function submitItem(e) {
  e.preventDefault();
  const errors = validateForm();
  showErrors(errors);
  if (errors.length) return;

  const importing = currentMode() === 'import';
  const formData = new FormData();
  if (!importing) {
    formData.append('media', $('#mediaFile').files[0]);
    formData.append('media_type', document.querySelector('input[name="media_type"]:checked').value);
  }
  if (importing) formData.append('source_url', $('#sourceUrl').value.trim());
  formData.append('title', $('#title').value.trim());
  formData.append('description', $('#description').value.trim());
  formData.append('location_name', $('#locationName').value.trim());
  formData.append('lat', selectedLat);
  formData.append('lng', selectedLng);
  formData.append('captured_at', $('#capturedAt').value.trim());
  formData.append('taken_by', $('#takenBy').value.trim());
  formData.append('owner', $('#owner').value.trim());
  formData.append('contact', $('#contact').value.trim());
  formData.append('acknowledged', '1');
  formData.append('website', $('#honeypot').value);

  const submitBtn = $('#submitBtn');
  submitBtn.disabled = true;
  const prevText = submitBtn.textContent;
  submitBtn.textContent = 'Submitting…';

  if (importing) closeModal('uploadModal');

  try {
    const res = await fetch('/api/items', { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (importing) openUpload();
      showErrors(Array.isArray(data.errors) ? data.errors : [data.error || 'Something went wrong. Please try again.']);
      return;
    }
    if (res.status === 202 && data.item) {
      addPendingMarker(data.item);
      startPendingPoll();
      toast('Import started — archiving in the background ✔');
    } else {
      closeModal('uploadModal');
      toast('Archived in Google Drive and added to the map ✔');
      if (data.item) {
        addItem(data.item);
        map.flyTo([data.item.lat, data.item.lng], Math.max(map.getZoom(), 13), { duration: 1 });
      }
    }
  } catch {
    if (importing) openUpload();
    showErrors(['Could not reach the server. Please check your connection and try again.']);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = prevText;
  }
}

$('#addBtn').addEventListener('click', openUpload);
$('#emptyAddBtn').addEventListener('click', openUpload);
$('#howBtn').addEventListener('click', () => openModal('howModal'));
$('#streetMapBtn').addEventListener('click', () => setMapStyle('street'));
$('#satelliteMapBtn').addEventListener('click', () => setMapStyle('satellite'));
map.on('zoomend', () => {
  const zoom = map.getZoom();
  itemsById.forEach((item) => {
    const marker = markers.get(item.id);
    if (marker) marker.setIcon(pinIcon(item.media_type, zoom));
  });
});
$('#uploadForm').addEventListener('submit', submitItem);
$('#mediaFile').addEventListener('change', updateLocalPreview);
$('#sourceUrl').addEventListener('input', updateSourceHint);
$('#unknownLocation').addEventListener('change', handleUnknownLocation);
document.querySelectorAll('input[name="ingest_mode"]').forEach((input) => input.addEventListener('change', updateIngestMode));
document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
$('#useMyLocation').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('Location is not available on this device.'); return; }
  toast('Finding your location…');
  navigator.geolocation.getCurrentPosition((pos) => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    pin.setLatLng(ll);
    miniMap.panTo(ll);
    setLocation(ll);
    toast('Location set.');
  }, () => toast('Could not get your location. Drop the pin on the map instead.'), { enableHighAccuracy: true, timeout: 10000 });
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ['uploadModal', 'detailModal', 'howModal'].forEach(closeModal); });

loadItems();
