'use strict';

const DEFAULT_CENTER = [28.17, 85.36];
const DEFAULT_ZOOM = 12;
const MIN_MAP_ZOOM = 10;
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
const clusterLayers = [];
const activeFilters = new Set(['photo', 'video', 'document']);
let panelFilter = 'all';
let panelQuery = '';
let panelSort = 'captured';
let timelineDates = [];
let timelineCutoff = null;
let currentLanguage = 'en';

const translations = {
  en: {
    brandTitle: 'Rasuwa Flood Evidence Map', brandSub: 'Bhote Koshi Flood · 26 August 2026', archiveStatus: 'Public evidence archive',
    searchArchive: 'Search the archive', searchPlaceholder: 'Search places, titles, contributors, or evidence…', howItWorks: 'How it works', addEvidence: 'Add evidence',
    filters: 'Filters', evidenceType: 'Evidence type', all: 'All', photo: 'Photo', video: 'Video', document: 'Document', social: 'Social',
    sortBy: 'Sort by', dateCaptured: 'Date captured', dateArchived: 'Date archived', timeline: 'Evidence timeline', allDates: 'All dates',
    aboutArchive: 'About this archive', learnMore: 'Learn more →', evidence: 'Evidence', locations: 'Locations', contributors: 'Contributors',
    openMetadata: 'Open metadata', street: 'Street', satellite: 'Satellite', latestEvidence: 'Latest evidence', browseArchive: 'Browse the archive',
    aboutBeforeCreator: 'VIVA-D is an open collection of geotagged photographs and videos documenting the impacts of natural disasters, initially focused on floods and landslides. Created by',
    aboutAfterCreator: 'to support disaster reconnaissance, research, assessment, and resilience through organized visual evidence and metadata.', footerArchive: 'Public evidence archive · Permanently archived in Google Cloud Storage',
    addingMedia: 'How are you adding this media?', uploadDevice: 'Upload from this device', importSocial: 'Import from Facebook, X, or Twitter', mediaFile: 'Photo or video file', originalPost: 'Original Facebook, X, or Twitter post',
    importHint: 'The server will download the media from this post, archive it, and keep this link as the source.',
    archiveHint: 'Archived securely in cloud storage. Photos with GPS data auto-fill the location.', whatIsIt: 'What is it?', whereTaken: 'Where was it taken?',
    unknownLocation: "I don't know the exact location — place it approximately along the river", mapLocationHint: 'Click the map to drop the pin at the exact spot.',
    placePlaceholder: 'Place name (auto-filled, editable)', useLocation: 'Use my location', shortTitle: 'Short title', titlePlaceholder: 'e.g. Bridge washed out near Timure',
    whenTaken: 'When was it taken?', capturedPlaceholder: 'e.g. Aug 26, 2026, early morning', whoTook: 'Who took it?', namePlaceholder: 'Name or role', whoOwns: 'Who owns the rights?', ownerPlaceholder: 'If different from the photographer', contactLabel: 'Contact (optional, shown publicly for verification)', contactPlaceholder: 'Email or phone',
    descriptionPlaceholder: 'Describe what the photo or video shows, and any details that help others understand or verify it.',
    descriptionLabel: 'What happened? Any additional information', confirmAuthentic: 'I confirm this is authentic:',
    confirmText: 'I took this photo/video or have permission to share it, and I believe the location and details I entered are accurate.', cancel: 'Cancel', publish: 'Archive and publish',
    documented: 'evidence documented', item: 'item', items: 'items', noDate: 'Date not provided', noMatches: 'No evidence matches these filters.'
  },
  ne: {
    brandTitle: 'रसुवा बाढी प्रमाण नक्सा', brandSub: 'भोटेकोशी बाढी · २६ अगस्ट २०२६', archiveStatus: 'सार्वजनिक प्रमाण अभिलेख',
    searchArchive: 'अभिलेख खोज्नुहोस्', searchPlaceholder: 'स्थान, शीर्षक, योगदानकर्ता वा प्रमाण खोज्नुहोस्…', howItWorks: 'कसरी काम गर्छ', addEvidence: 'प्रमाण थप्नुहोस्',
    filters: 'फिल्टर', evidenceType: 'प्रमाणको प्रकार', all: 'सबै', photo: 'फोटो', video: 'भिडियो', document: 'कागजात', social: 'सामाजिक',
    sortBy: 'क्रमबद्ध गर्नुहोस्', dateCaptured: 'खिचिएको मिति', dateArchived: 'अभिलेख मिति', timeline: 'प्रमाण समयरेखा', allDates: 'सबै मिति',
    aboutArchive: 'यस अभिलेखबारे', learnMore: 'थप जान्नुहोस् →', evidence: 'प्रमाण', locations: 'स्थान', contributors: 'योगदानकर्ता',
    openMetadata: 'मेटाडेटा हेर्नुहोस्', street: 'सडक', satellite: 'स्याटेलाइट', latestEvidence: 'नवीनतम प्रमाण', browseArchive: 'अभिलेख हेर्नुहोस्',
    aboutBeforeCreator: 'रसुवाको भोटेकोशी क्षेत्रमा बाढीको असर, क्षति, पूर्वाधार अवरोध र पुनर्स्थापनाको अभिलेख बनाउने सामुदायिक पहल। सिर्जना गर्ने',
    aboutAfterCreator: 'ले सार्वजनिक हितको पारदर्शी अभिलेखीकरण, अनुसन्धान र प्रमाणीकरणलाई सहयोग गर्न यो नक्सा बनाएका हुन्।', footerArchive: 'सार्वजनिक प्रमाण अभिलेख · Google Cloud Storage मा स्थायी रूपमा सुरक्षित',
    addingMedia: 'यो सामग्री कसरी थप्दै हुनुहुन्छ?', uploadDevice: 'यस उपकरणबाट अपलोड गर्नुहोस्', importSocial: 'Facebook, X वा Twitter बाट आयात गर्नुहोस्', mediaFile: 'फोटो वा भिडियो फाइल', originalPost: 'मूल Facebook, X वा Twitter पोस्ट',
    importHint: 'सर्भरले यो पोस्टबाट सामग्री डाउनलोड गरी अभिलेख गर्छ र स्रोतको रूपमा यो लिंक राख्छ।',
    archiveHint: 'क्लाउडमा सुरक्षित रूपमा अभिलेख हुन्छ। GPS भएको फोटोले स्थान स्वतः भर्छ।', whatIsIt: 'यो के हो?', whereTaken: 'यो कहाँ खिचिएको हो?',
    unknownLocation: 'ठ्याक्कै स्थान थाहा छैन — नदीको किनारमा अनुमानित स्थान राख्नुहोस्', mapLocationHint: 'ठ्याक्कै ठाउँमा पिन राख्न नक्सामा क्लिक गर्नुहोस्।',
    placePlaceholder: 'स्थानको नाम (स्वतः भरिने, सम्पादन गर्न मिल्ने)', useLocation: 'मेरो स्थान प्रयोग गर्नुहोस्', shortTitle: 'छोटो शीर्षक', titlePlaceholder: 'उदाहरण: टिमुरे नजिक पुल बगायो',
    whenTaken: 'कहिले खिचिएको हो?', capturedPlaceholder: 'उदाहरण: २६ अगस्ट २०२६, बिहान', whoTook: 'कसले खिचेको हो?', namePlaceholder: 'नाम वा भूमिका', whoOwns: 'अधिकार कसको हो?', ownerPlaceholder: 'फोटोग्राफरभन्दा फरक भएमा', contactLabel: 'सम्पर्क (वैकल्पिक, प्रमाणीकरणका लागि सार्वजनिक)', contactPlaceholder: 'इमेल वा फोन',
    descriptionPlaceholder: 'फोटो वा भिडियोमा के देखिन्छ र बुझ्न वा प्रमाणित गर्न सहयोगी विवरण लेख्नुहोस्।',
    descriptionLabel: 'के भयो? थप जानकारी', confirmAuthentic: 'यो प्रामाणिक भएको पुष्टि गर्छु:',
    confirmText: 'मैले यो फोटो/भिडियो खिचेको हुँ वा साझा गर्ने अनुमति छ, र दिएको स्थान तथा विवरण सही छन्।', cancel: 'रद्द गर्नुहोस्', publish: 'अभिलेख गरी प्रकाशित गर्नुहोस्',
    documented: 'प्रमाण अभिलेखित', item: 'प्रमाण', items: 'प्रमाण', noDate: 'मिति उपलब्ध छैन', noMatches: 'यी फिल्टरसँग मिल्ने प्रमाण छैन।'
  }
};

function tr(key) {
  return translations[currentLanguage][key] || translations.en[key] || key;
}

function applyLanguage(language) {
  currentLanguage = language === 'ne' ? 'ne' : 'en';
  document.documentElement.lang = currentLanguage;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const value = translations[currentLanguage][el.dataset.i18n];
    if (value) el.textContent = value;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const value = translations[currentLanguage][el.dataset.i18nPlaceholder];
    if (value) el.placeholder = value;
  });
  document.querySelectorAll('.language-btn').forEach((button) => {
    const active = button.dataset.language === currentLanguage;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  try { localStorage.setItem('rasuwa-language', currentLanguage); } catch {}
  updateCount();
  updateTimelineLabels();
  renderEvidencePanel();
}

const map = L.map('map', { minZoom: MIN_MAP_ZOOM, maxZoom: 20 }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
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
  const size = pinSizeForZoom(zoom);
  const symbolSize = Math.max(11, Math.round(size * 0.5));
  let symbol = '<rect x="2.5" y="4" width="11" height="8" rx="1.5"/><circle cx="6" cy="7" r="1"/><path d="m4 10.5 2.5-2.3 2 1.8 1.4-1.2 2.1 1.9"/>';
  if (type === 'video') symbol = '<circle cx="8" cy="8" r="5.5"/><path d="m6.8 5.5 3.8 2.5-3.8 2.5z"/>';
  else if (type === 'document') symbol = '<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3M6 8.5h4M6 11h3"/>';
  return L.divIcon({
    className: 'pin-wrap',
    html: '<div class="pin ' + type + '" style="width:' + size + 'px;height:' + size + 'px"><svg class="pin-symbol" style="width:' + symbolSize + 'px;height:' + symbolSize + 'px" viewBox="0 0 16 16" aria-hidden="true">' + symbol + '</svg></div>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -Math.round(size * 0.9)],
  });
}

function clusterIcon(count) {
  const size = count > 99 ? 48 : count > 9 ? 44 : 40;
  return L.divIcon({
    className: 'evidence-cluster-wrap',
    html: '<div class="evidence-cluster" style="width:' + size + 'px;height:' + size + 'px" aria-label="' + count + ' evidence items">' + count + '</div>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function matchesTypeAndSearch(item) {
  const panelVisible = panelFilter === 'all' || (panelFilter === 'social' ? Boolean(item.source_url) : item.media_type === panelFilter);
  return activeFilters.has(item.media_type) && panelVisible && matchesSearch(item) && matchesTimeline(item);
}

function hasMapLocation(item) {
  return item.media_type !== 'document' && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)) &&
    Number(item.lat) >= 26 && Number(item.lat) <= 31 && Number(item.lng) >= 79.5 && Number(item.lng) <= 89;
}

function clearDisplayedEvidenceMarkers() {
  markers.forEach((marker) => {
    if (map.hasLayer(marker)) map.removeLayer(marker);
  });
  while (clusterLayers.length) {
    const layer = clusterLayers.pop();
    if (map.hasLayer(layer)) map.removeLayer(layer);
  }
}

function refreshMarkerDisplay() {
  clearDisplayedEvidenceMarkers();
  const visible = Array.from(itemsById.values()).filter(matchesTypeAndSearch).filter(hasMapLocation);
  const zoom = map.getZoom();
  if (zoom >= 14) {
    visible.forEach((item) => {
      const marker = markers.get(item.id);
      if (marker) {
        marker.setIcon(pinIcon(item.media_type, zoom));
        marker.addTo(map);
      }
    });
    return;
  }

  const groups = new Map();
  const gridSize = zoom <= 11 ? 86 : 72;
  visible.forEach((item) => {
    const point = map.project([Number(item.lat), Number(item.lng)], zoom);
    const key = Math.floor(point.x / gridSize) + ':' + Math.floor(point.y / gridSize);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  groups.forEach((group) => {
    if (group.length === 1) {
      const marker = markers.get(group[0].id);
      if (marker) {
        marker.setIcon(pinIcon(group[0].media_type, zoom));
        marker.addTo(map);
      }
      return;
    }
    const center = [
      group.reduce((sum, item) => sum + Number(item.lat), 0) / group.length,
      group.reduce((sum, item) => sum + Number(item.lng), 0) / group.length,
    ];
    const cluster = L.marker(center, { icon: clusterIcon(group.length), title: group.length + ' evidence items' }).addTo(map);
    cluster.on('click', () => map.setView(center, Math.min(14, zoom + 2), { animate: true }));
    clusterLayers.push(cluster);
  });
}

window.thumbFallback = function thumbFallback() {
  return '<div class="popup-thumb video">📷 Preview unavailable — open the archived file in Google Cloud Storage</div>';
};

function mediaThumb(item, popup = true) {
  const className = popup ? 'popup-thumb' : 'detail-media';
  if (item.media_type === 'document' && !(item.mime_type || '').startsWith('image/')) {
    return '<div class="' + className + ' video">📄 Document file</div>';
  }
  if (item.media_type === 'video') {
    if (item.drive_url && item.drive_url.startsWith('https://storage.googleapis.com/')) {
      const frameClass = popup ? 'popup-thumb popup-video-frame' : 'detail-media video-frame';
      return '<video class="' + frameClass + '" controls preload="metadata"><source src="' + esc(item.drive_url) + '" type="' + esc(item.mime_type || 'video/mp4') + '"></video>';
    }
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

function metadataSheetHtml() {
  const rows = Array.from(itemsById.values()).map((item) => '<tr>' +
    '<td>' + esc(item.captured_at || '—') + '</td>' +
    '<td>' + esc(item.title || '—') + '</td>' +
    '<td>' + esc(item.original_filename || '—') + '</td>' +
    '<td>' + esc(item.location_name || '—') + '<br><small>' + Number(item.lat).toFixed(5) + ', ' + Number(item.lng).toFixed(5) + '</small></td>' +
    '<td>' + esc(item.taken_by || '—') + '</td>' +
    '<td>' + locationLabel(item) + '</td>' +
    '<td>' + esc(item.description || '—') + '</td>' +
    '<td><a href="' + esc(item.previewUrl || item.drive_url || '') + '" target="_blank" rel="noopener">Download / open</a></td>' +
    '</tr>').join('');
  return '<div class="metadata-sheet"><p class="sheet-intro">Compiled from the evidence currently loaded on the map. Location labels show whether coordinates came from GPS, an approximate river placement, or a user-selected pin.</p><div class="sheet-table-wrap"><table><thead><tr><th>Date</th><th>Title</th><th>File name</th><th>Location</th><th>Taken by</th><th>Location source</th><th>Remarks</th><th>File</th></tr></thead><tbody>' + (rows || '<tr><td colspan="8">No evidence loaded.</td></tr>') + '</tbody></table></div></div>';
}

function metadataCsv() {
  const headers = ['Date', 'Title', 'File name', 'Location', 'Latitude', 'Longitude', 'Taken by', 'Location source', 'Remarks', 'File link'];
  const quote = (value) => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  const lines = [headers.map(quote).join(',')];
  itemsById.forEach((item) => lines.push([
    item.captured_at || '', item.title || '', item.original_filename || '', item.location_name || '',
    item.lat, item.lng, item.taken_by || '', locationConfidence(item), item.description || '', item.previewUrl || item.drive_url || '',
  ].map(quote).join(',')));
  return '\ufeff' + lines.join('\r\n');
}

function downloadMetadataSheet() {
  const blob = new Blob([metadataCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'rasuwa-flood-metadata.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function openMetadataSheet() {
  $('#metadataBody').innerHTML = metadataSheetHtml();
  openModal('metadataModal');
}

function locationConfidence(item) {
  if (item.location_source) return item.location_source;
  if (item.location_name && /approximate|river/i.test(item.location_name)) return 'Approximate';
  if (item.media_type === 'photo' && item.location_name && /gps|geotag/i.test(item.description || '')) return 'GPS';
  return 'User-set';
}

function locationLabel(item) {
  const confidence = locationConfidence(item);
  const isGps = confidence === 'GPS' || confidence === 'Photo GPS';
  const cls = isGps ? 'gps' : confidence === 'Approximate' ? 'approximate' : 'user-set';
  return '<span class="location-confidence ' + cls + '" title="How this location was placed">' + (isGps ? '📍 Photo GPS' : confidence === 'Approximate' ? '≈ Approximate' : '✦ User-set') + '</span>';
}

function sourceLabel(item) {
  if (!item.source_url) return '';
  const platform = item.source_platform === 'x' ? 'X/Twitter' : item.source_platform === 'facebook' ? 'Facebook' : 'social post';
  return '<a class="source-link" href="' + esc(item.source_url) + '" target="_blank" rel="noopener noreferrer">Original ' + platform + ' post ↗</a>';
}

function popupHtml(item) {
  const metaBits = [];
  if (item.location_name) metaBits.push(esc(item.location_name) + ' ' + locationLabel(item));
  if (item.captured_at) metaBits.push(esc(item.captured_at));
  const meta = metaBits.length ? '<p class="popup-meta">' + metaBits.join(' · ') + '</p>' : '';
  const desc = item.description ? '<p class="popup-desc">' + esc(shorten(item.description, 180)) + '</p>' : '';
  const downvoteCount = item.downvotes || 0;
  const downvoteBtn = '<button class="btn-downvote" type="button" onclick="downvoteItem(' + item.id + ')" title="Flag as inaccurate">👎' + (downvoteCount > 0 ? ' <span class="downvote-count">' + downvoteCount + '</span>' : '') + '</button>';
  return '<div class="popup-card">' + mediaThumb(item) + '<h3>' + esc(item.title) + '</h3>' + meta + desc + sourceLabel(item) + '<div class="popup-actions"><a class="btn-primary btn-sm" href="' + esc(item.previewUrl || item.drive_url) + '" target="_blank" rel="noopener noreferrer">Open archived media</a><button class="btn-ghost btn-sm" type="button" onclick="openDetail(' + item.id + ')">More details</button>' + downvoteBtn + '</div></div>';
}

function evidenceIcon(item) {
  return item.media_type === 'video' ? '▶' : item.media_type === 'document' ? '▤' : '◉';
}

function latestThumbnail(item) {
  const fallback = '<span class="latest-placeholder" aria-hidden="true">' + evidenceIcon(item) + '</span>';
  if (!item.thumbnailUrl) return fallback;
  return '<span class="latest-media"><img src="' + esc(item.thumbnailUrl) + '" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="latest-placeholder" aria-hidden="true" hidden>' + evidenceIcon(item) + '</span></span>';
}

function renderEvidencePanel() {
  const list = $('#evidenceList');
  if (!list) return;
  const visible = Array.from(itemsById.values()).filter((item) => {
    const matchesType = panelFilter === 'all' || (panelFilter === 'social' ? Boolean(item.source_url) : item.media_type === panelFilter);
    return matchesType && matchesSearch(item) && matchesTimeline(item);
  }).sort(compareEvidence);
  $('#panelCount').textContent = itemsById.size + ' ' + tr('documented');
  document.querySelector('.evidence-panel').classList.toggle('search-active', Boolean(panelQuery));
  const locations = new Set(Array.from(itemsById.values()).map((item) => item.location_name).filter(Boolean));
  const contributors = new Set(Array.from(itemsById.values()).map((item) => item.taken_by).filter(Boolean));
  $('#panelStatItems').textContent = itemsById.size;
  $('#panelStatLocations').textContent = locations.size;
  $('#panelStatContributors').textContent = contributors.size;
  list.innerHTML = visible.length ? visible.map((item) => '<article class="evidence-card" data-evidence-id="' + item.id + '">' +
    (item.thumbnailUrl ? '<img src="' + esc(item.thumbnailUrl) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;evidence-card-placeholder&quot;>' + evidenceIcon(item) + '</div>\'">' : '<div class="evidence-card-placeholder">' + evidenceIcon(item) + '</div>') +
    '<div><h3>' + esc(item.title) + '</h3><p>' + (item.source_url ? tr('social') : item.media_type === 'photo' ? tr('photo') : item.media_type === 'video' ? tr('video') : tr('document')) + (item.captured_at ? ' · ' + esc(item.captured_at) : '') + '</p>' + (item.media_type === 'document' ? '<p>' + esc(publisherTypeLabel(item.publisher_type)) + '</p>' : '<p>' + esc(item.location_name || 'Location not provided') + '</p><p>' + locationLabel(item) + '</p>') + '</div></article>').join('') : '<p class="panel-empty">' + tr('noMatches') + '</p>';
  renderLatestEvidence();
  list.querySelectorAll('.evidence-card').forEach((card) => card.addEventListener('click', () => {
    const item = itemsById.get(Number(card.dataset.evidenceId));
    if (!item) return;
    const marker = markers.get(item.id);
    document.querySelectorAll('.evidence-card.selected').forEach((el) => el.classList.remove('selected'));
    card.classList.add('selected');
    focusEvidence(item);
  }));
}

function evidenceTimestamp(item, field) {
  const value = item[field];
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatTimelineDate(timestamp) {
  return new Intl.DateTimeFormat(currentLanguage === 'ne' ? 'ne-NP' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(timestamp));
}

function matchesTimeline(item) {
  if (timelineCutoff == null) return true;
  const captured = evidenceTimestamp(item, 'captured_at');
  return captured != null && captured <= timelineCutoff;
}

function updateTimelineLabels() {
  const start = $('#timelineStart');
  const current = $('#timelineCurrent');
  if (!start || !current) return;
  start.textContent = timelineDates.length ? formatTimelineDate(timelineDates[0]) : '—';
  current.textContent = timelineCutoff == null ? tr('allDates') : formatTimelineDate(timelineCutoff);
}

function updateTimelineDates() {
  const range = $('#timelineRange');
  if (!range) return;
  const wasAllDates = timelineCutoff == null;
  timelineDates = Array.from(new Set(Array.from(itemsById.values())
    .map((item) => evidenceTimestamp(item, 'captured_at'))
    .filter((timestamp) => timestamp != null))).sort((a, b) => a - b);
  range.max = String(timelineDates.length);
  range.disabled = timelineDates.length === 0;
  if (wasAllDates || !timelineDates.length) {
    timelineCutoff = null;
    range.value = String(timelineDates.length);
  } else {
    let index = timelineDates.findIndex((timestamp) => timestamp >= timelineCutoff);
    if (index < 0) index = timelineDates.length - 1;
    timelineCutoff = timelineDates[index];
    range.value = String(index);
  }
  updateTimelineLabels();
}

function compareEvidence(a, b) {
  const field = panelSort === 'archived' ? 'submitted_at' : 'captured_at';
  const aDate = evidenceTimestamp(a, field);
  const bDate = evidenceTimestamp(b, field);
  if (aDate == null && bDate == null) return Number(b.id) - Number(a.id);
  if (aDate == null) return 1;
  if (bDate == null) return -1;
  return bDate - aDate;
}

function renderLatestEvidence() {
  const list = $('#latestEvidence');
  if (!list) return;
  const latest = Array.from(itemsById.values()).filter((item) => {
    const matchesType = panelFilter === 'all' || (panelFilter === 'social' ? Boolean(item.source_url) : item.media_type === panelFilter);
    return matchesType && matchesSearch(item) && matchesTimeline(item);
  }).sort(compareEvidence).slice(0, panelQuery ? 10 : 5);
  list.innerHTML = latest.map((item) => '<button class="latest-card" type="button" data-evidence-id="' + item.id + '" onclick="openEvidencePanel(' + item.id + ')">' +
    latestThumbnail(item) +
    '<strong>' + esc(shorten(item.title || 'Untitled evidence', 42)) + '</strong><small>' + esc(item.captured_at || tr('noDate')) + '</small></button>').join('');
}

function focusEvidence(item) {
  const marker = markers.get(item.id);
  if (marker) map.flyTo([item.lat, item.lng], Math.max(map.getZoom(), 13), { duration: .6 });
  openDetailPanel(item);
}

// Kept on window because Latest evidence is rendered dynamically. Each card
// calls this same action as a map marker, using its stored evidence ID.
window.openEvidencePanel = function openEvidencePanel(id) {
  const item = itemsById.get(Number(id));
  if (item) focusEvidence(item);
};

function openDetailPanel(item) {
  $('#detailPanelBody').innerHTML = detailHtml(item);
  $('#detailPanel').classList.remove('hidden');
  document.querySelector('.map-wrap').classList.add('detail-open');
}

function closeDetailPanel() {
  $('#detailPanel').classList.add('hidden');
  document.querySelector('.map-wrap').classList.remove('detail-open');
}

function addItem(item) {
  const existing = markers.get(item.id);
  if (existing) {
    map.removeLayer(existing);
    markers.delete(item.id);
  }
  itemsById.set(item.id, item);
  if (hasMapLocation(item)) {
    const marker = L.marker([item.lat, item.lng], { icon: pinIcon(item.media_type), title: item.title });
    marker.bindPopup(popupHtml(item), { maxWidth: 340 });
    marker.on('click', () => {
      marker.closePopup();
      openDetailPanel(item);
    });
    markers.set(item.id, marker);
  }
  updateCount();
  updateTimelineDates();
  $('#emptyState').classList.add('hidden');
  renderEvidencePanel();
}

async function loadItems({ silent = false } = {}) {
  try {
    const res = await fetch('/api/items', { cache: 'no-store' });
    if (!res.ok) throw new Error('Bad response');
    const data = await res.json();
    const serverIds = new Set(data.items.map((item) => item.id));
    data.items.forEach(addItem);
    if (itemsById.size === 0) $('#emptyState').classList.remove('hidden');
    else $('#emptyState').classList.add('hidden');
    updateFilterVisibility();
    renderEvidencePanel();
    return true;
  } catch {
    if (!silent) toast('Could not load the map data. Check that the server is running.');
    return false;
  }
}

let refreshTimer = null;
function startLiveRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => loadItems({ silent: true }), 5000);
}

function updateCount() {
  const n = itemsById.size;
  $('#countChip').textContent = n + ' ' + tr(n === 1 ? 'item' : 'items');
}

function matchesSearch(item) {
  if (!panelQuery) return true;
  return [item.title, item.description, item.location_name, item.taken_by, item.owner, item.contact, item.original_filename, item.source_url, item.id].join(' ').toLowerCase().includes(panelQuery);
}

function updateFilterVisibility() {
  refreshMarkerDisplay();
}

document.querySelectorAll('.panel-filter').forEach((btn) => btn.addEventListener('click', () => {
  panelFilter = btn.dataset.panelType;
  document.querySelectorAll('.panel-filter').forEach((b) => b.classList.toggle('active', b === btn));
  renderEvidencePanel();
  updateFilterVisibility();
}));
$('#panelSearch').addEventListener('input', (e) => { panelQuery = e.target.value.trim().toLowerCase(); $('#archiveSearch').value = e.target.value; renderEvidencePanel(); updateFilterVisibility(); });
$('#archiveSearchForm').addEventListener('submit', (e) => { e.preventDefault(); panelQuery = $('#archiveSearch').value.trim().toLowerCase(); $('#panelSearch').value = $('#archiveSearch').value; renderEvidencePanel(); updateFilterVisibility(); });
$('#archiveSearch').addEventListener('input', (e) => { panelQuery = e.target.value.trim().toLowerCase(); $('#panelSearch').value = e.target.value; renderEvidencePanel(); updateFilterVisibility(); });
$('#panelToggle').addEventListener('click', () => {
  const wrap = document.querySelector('.map-wrap');
  const collapsed = wrap.classList.toggle('panel-collapsed');
  $('#panelToggle').textContent = collapsed ? '+' : '−';
  $('#panelToggle').setAttribute('aria-label', collapsed ? 'Expand evidence archive' : 'Collapse evidence archive');
  $('#panelToggle').setAttribute('aria-expanded', String(!collapsed));
  setTimeout(() => map.invalidateSize({ pan: false }), 220);
});

document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    if (activeFilters.has(type)) {
      activeFilters.delete(type);
      btn.classList.remove('active');
    } else {
      activeFilters.add(type);
      btn.classList.add('active');
    }
    updateFilterVisibility();
  });
});

window.detailImgFallback = function detailImgFallback() {
  return '<div class="detail-video">📷 Archived preview unavailable — open the file in Google Cloud Storage</div>';
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
  let typeLabel = '📷 Photo';
  if (item.media_type === 'video') typeLabel = '🎥 Video';
  else if (item.media_type === 'document') typeLabel = '📄 Document';
  const rows = item.media_type === 'document' ? [
    ['Type', typeLabel],
    ['Stored in', 'Project Google Cloud Storage archive'],
    ['File', esc(item.original_filename || 'Archived document')],
    ['Publisher type', esc(publisherTypeLabel(item.publisher_type))],
    ['Added on', esc(new Date(item.submitted_at).toLocaleString())],
  ] : [
    ['Type', typeLabel],
    ['Stored in', 'Project Google Cloud Storage archive'],
    ['File', esc(item.original_filename || 'Archived media')],
    ['Location', esc(item.location_name || 'Not provided') + ' ' + locationLabel(item) + ' <span class="coords">(' + item.lat.toFixed(5) + ', ' + item.lng.toFixed(5) + ')</span>'],
    ['When taken', esc(item.captured_at || 'Not provided')],
    ['Taken by', esc(item.taken_by || 'Not provided')],
    ['Owner / rights', esc(item.owner || 'Not provided')],
    ['Contact', esc(item.contact || 'Not provided')],
    ['Added on', esc(new Date(item.submitted_at).toLocaleString())],
  ];
  if (item.source_url) rows.splice(3, 0, ['Original source', sourceLabel(item)]);
  if (item.document_source_url) rows.splice(3, 0, ['Source link', '<a href="' + esc(item.document_source_url) + '" target="_blank" rel="noopener noreferrer">Open original document ↗</a>']);
  const downvotes = item.downvotes || 0;
  if (downvotes > 0) rows.push(['Community feedback', downvotes + ' downvote' + (downvotes === 1 ? '' : 's')]);
  const meta = rows.map(([key, value]) => '<tr><td>' + key + '</td><td>' + value + '</td></tr>').join('');
  const descBlock = item.description ? '<div class="detail-desc"><h3>' + (item.media_type === 'document' ? 'Brief note' : 'What happened') + '</h3><p>' + esc(item.description) + '</p></div>' : '';
  const detailType = item.media_type === 'photo' ? 'Photo' : item.media_type === 'video' ? 'Video' : 'Document';
  return '<h3 class="detail-title">' + esc(item.title) + '</h3><span class="detail-badge">' + detailType + '</span>' + mediaThumb(item, false) + descBlock + '<table class="meta-table"><tbody>' + meta + '</tbody></table><div class="detail-actions"><a class="btn-primary" href="' + esc(item.previewUrl || item.drive_url) + '" target="_blank" rel="noopener noreferrer">Open archived media ↗</a><button class="btn-downvote-detail" type="button" onclick="downvoteItem(' + item.id + ')" title="Flag as inaccurate">👎 Flag as inaccurate</button></div><p class="verify-note">The archived copy is the primary evidence record. The original social link is preserved separately as provenance. Items flagged by 50+ community members are automatically hidden.</p>';
}

function publisherTypeLabel(value) {
  return ({ government: 'Government', ngo_ingo: 'NGO / INGO', private: 'Private' })[value] || 'Not provided';
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
let locationSource = '';
let autoTitleFromFile = '';

function setLocation(latlng, source = 'User-set') {
  selectedLat = latlng[0];
  selectedLng = latlng[1];
  locationConfirmed = true;
  locationSource = source;
  $('#photoGpsStatus').classList.toggle('hidden', source !== 'Photo GPS');
  $('#locStatus').textContent = '✓ Location set: ' + latlng[0].toFixed(5) + ', ' + latlng[1].toFixed(5);
  reverseGeocode(latlng[0], latlng[1]).then((name) => { if (name) $('#locationName').value = name; });
}
miniMap.on('click', (e) => { pin.setLatLng(e.latlng); setLocation([e.latlng.lat, e.latlng.lng], 'User-set'); });
pin.on('dragend', () => setLocation([pin.getLatLng().lat, pin.getLatLng().lng], 'User-set'));

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

function selectedMediaType() {
  return document.querySelector('input[name="media_type"]:checked')?.value || 'photo';
}

function updateIngestMode() {
  const documentMode = selectedMediaType() === 'document';
  const importing = !documentMode && currentMode() === 'import';
  if (documentMode) $('#modeUpload').checked = true;
  $('#ingestModeBlock').classList.toggle('hidden', documentMode);
  $('#uploadInputBlock').classList.toggle('hidden', importing);
  $('#importInputBlock').classList.toggle('hidden', !importing);
  $('#mediaTypeBlock').classList.toggle('hidden', importing);
  $('#locationSection').classList.toggle('hidden', documentMode);
  $('#documentDetailsBlock').classList.toggle('hidden', !documentMode);
  $('#mediaDetailsFields').classList.toggle('hidden', documentMode);
  $('#mediaFile').required = !importing;
  $('#mediaFile').accept = documentMode ? 'application/pdf,image/*' : 'image/*,video/*,application/pdf';
  $('#mediaFileLabel').textContent = documentMode ? 'Document file (PDF or image)' : 'Photo or video file';
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
  $('#photoGpsStatus').classList.add('hidden');
  $('#locStatus').textContent = 'Click the map to drop the pin at the exact spot.';
  selectedLat = null;
  selectedLng = null;
  locationConfirmed = false;
  locationSource = '';
  autoTitleFromFile = '';
  pin.setLatLng(DEFAULT_CENTER);
  miniMap.setView(DEFAULT_CENTER, MINI_ZOOM);
  updateIngestMode();
}

async function updateArchiveStatus() {
  const status = $('#archiveStatus');
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    const storageType = data.storageType === 'gcs' ? 'Google Cloud Storage' : 'Google Drive';
    status.textContent = data.directUploadsEnabled ? storageType + ' archive connected. Your selected file will be stored there.' : storageType + ' archive is not connected yet. The site owner must finish the one-time setup before uploads can be archived.';
    status.classList.add(data.directUploadsEnabled ? 'ready' : 'missing');
  } catch { status.textContent = 'Could not check the archive connection.'; }
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

// Extract EXIF GPS and capture-date metadata using the server endpoint.
async function extractPhotoMetadata(file) {
  if (!file || !file.type.startsWith('image/')) return null;
  try {
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch('/api/extract-gps', { method: 'POST', body: formData });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function titleFromFilename(filename) {
  return String(filename || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function fillTitleFromFile(file) {
  const titleInput = $('#title');
  const currentTitle = titleInput.value.trim();
  if (!file || (currentTitle && currentTitle !== autoTitleFromFile)) return;
  const derivedTitle = titleFromFilename(file.name);
  if (!derivedTitle) return;
  titleInput.value = derivedTitle;
  autoTitleFromFile = derivedTitle;
}

function updateLocalPreview() {
  const file = $('#mediaFile').files[0];
  if (!file) { $('#localPreview').classList.add('hidden'); return; }
  const url = URL.createObjectURL(file);
  const image = $('#localImagePreview');
  const video = $('#localVideoPreview');
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  image.classList.toggle('hidden', !isImage);
  video.classList.toggle('hidden', !isVideo);
  if (isImage) image.src = url;
  else if (isVideo) video.src = url;
  $('#localFileName').textContent = file.name + ' · ' + Math.ceil(file.size / 1024 / 1024) + ' MB';
  $('#localPreview').classList.remove('hidden');
  fillTitleFromFile(file);

  // Auto-fill available camera metadata without replacing user-entered values.
  if (isImage && selectedMediaType() !== 'document') {
    extractPhotoMetadata(file).then((metadata) => {
      if ($('#mediaFile').files[0] !== file || !metadata) return;
      if (metadata.capturedAt && !$('#capturedAt').value.trim()) {
        const formatted = formatDateForDisplay(metadata.capturedAt);
        if (formatted) $('#capturedAt').value = formatted;
      }
      const gps = metadata.gps;
      if (!locationConfirmed && !$('#unknownLocation').checked && gps && gps.lat && gps.lng) {
        // Check if within Nepal bounds
        if (gps.lat >= 26 && gps.lat <= 31 && gps.lng >= 79.5 && gps.lng <= 89) {
          pin.setLatLng([gps.lat, gps.lng]);
          miniMap.setView([gps.lat, gps.lng], 15);
          $('#unknownLocation').checked = false;
          setLocation([gps.lat, gps.lng], 'Photo GPS');
          $('#locStatus').textContent = '✓ Updated from photo GPS: ' + gps.lat.toFixed(5) + ', ' + gps.lng.toFixed(5);
          toast('📍 Location updated from photo GPS');
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
    setLocation(riverPoint, 'Approximate');
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
  hint.textContent = parsed ? 'Detected ' + (parsed.platform === 'x' ? 'X/Twitter' : 'Facebook') + '. The server will download one public media item and archive it in Google Cloud Storage.' : 'Use a public Facebook, X, or Twitter post URL.';
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
  const symbolSize = Math.max(11, Math.round(size * 0.5));
  const icon = L.divIcon({
    className: 'pin-wrap',
    html: '<div class="pin pending" style="width:' + size + 'px;height:' + size + 'px"><svg class="pin-symbol" style="width:' + symbolSize + 'px;height:' + symbolSize + 'px" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" stroke-dasharray="7 4"/></svg></div>',
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
  const documentMode = selectedMediaType() === 'document';
  const importing = !documentMode && currentMode() === 'import';
  const file = $('#mediaFile').files[0];
  const source = $('#sourceUrl').value.trim();
  if (!importing && file && !$('#title').value.trim()) fillTitleFromFile(file);
  const title = $('#title').value.trim();

  if (importing) {
    if (!source) errors.push('Paste the Facebook, X, or Twitter post link to import.');
    else if (!parseSocial(source)) errors.push('The source link must be a Facebook, X, or Twitter post link.');
  } else if (documentMode) {
    if (!file) errors.push('Choose the document file you want to archive.');
    if (file && file.type !== 'application/pdf' && !file.type.startsWith('image/')) errors.push('Choose a PDF or image file for the document.');
    if (!$('#publisherType').value) errors.push('Choose the document publisher type.');
    const sourceLink = $('#documentSourceUrl').value.trim();
    if (sourceLink) {
      try {
        const url = new URL(sourceLink);
        if (!['http:', 'https:'].includes(url.protocol)) errors.push('The document source link must use http or https.');
      } catch { errors.push('Enter a valid document source link.'); }
    }
  } else {
    if (!file) errors.push('Choose the photo or video you want to archive.');
    if (file && !/^(image|video)\//.test(file.type)) errors.push('Choose an image or video file.');
  }
  if (!documentMode && !locationConfirmed) errors.push('Set the location by clicking the map or checking "I don\'t know exact location".');
  if (!title) errors.push('Give this item a short title.');
  if (!$('#ackCheck').checked) errors.push('Tick the confirmation box to state this item is authentic.');
  return errors;
}

async function submitItem(e) {
  e.preventDefault();
  const errors = validateForm();
  showErrors(errors);
  if (errors.length) return;

  const mediaType = selectedMediaType();
  const documentMode = mediaType === 'document';
  const importing = !documentMode && currentMode() === 'import';
  const formData = new FormData();
  if (!importing) {
    formData.append('media', $('#mediaFile').files[0]);
    formData.append('media_type', mediaType);
  }
  if (importing) formData.append('source_url', $('#sourceUrl').value.trim());
  formData.append('title', $('#title').value.trim());
  if (documentMode) {
    formData.append('description', $('#documentNote').value.trim());
    formData.append('document_source_url', $('#documentSourceUrl').value.trim());
    formData.append('publisher_type', $('#publisherType').value);
  } else {
    formData.append('description', $('#description').value.trim());
    formData.append('location_name', $('#locationName').value.trim());
    formData.append('lat', selectedLat);
    formData.append('lng', selectedLng);
    formData.append('location_source', locationSource || 'User-set');
    formData.append('captured_at', $('#capturedAt').value.trim());
    formData.append('taken_by', $('#takenBy').value.trim());
    formData.append('owner', $('#owner').value.trim());
    formData.append('contact', $('#contact').value.trim());
  }
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
      toast(documentMode ? 'Archived in cloud storage and added to the archive ✔' : 'Archived in cloud storage and added to the map ✔');
      if (data.item) {
        addItem(data.item);
        if (hasMapLocation(data.item)) map.flyTo([data.item.lat, data.item.lng], Math.max(map.getZoom(), 13), { duration: 1 });
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

$('#addMediaBtn').addEventListener('click', openUpload);
$('#addDocsBtn').addEventListener('click', () => {
  openUpload();
  setTimeout(() => {
    const docRadio = document.querySelector('input[name="media_type"][value="document"]');
    if (docRadio) { docRadio.checked = true; updateIngestMode(); }
  }, 100);
});
$('#emptyAddBtn').addEventListener('click', openUpload);
$('#emptyDocsBtn').addEventListener('click', () => {
  openUpload();
  setTimeout(() => {
    const docRadio = document.querySelector('input[name="media_type"][value="document"]');
    if (docRadio) { docRadio.checked = true; updateIngestMode(); }
  }, 100);
});
$('#howBtn').addEventListener('click', () => openModal('howModal'));
$('#aboutArchiveLink').addEventListener('click', (e) => { e.preventDefault(); openModal('howModal'); });
$('#metadataSheetBtn')?.addEventListener('click', openMetadataSheet);
$('#panelMetadataBtn').addEventListener('click', openMetadataSheet);
$('#detailCloseBtn').addEventListener('click', closeDetailPanel);
$('#sortEvidence').addEventListener('change', (e) => { panelSort = e.target.value; renderEvidencePanel(); });
$('#timelineRange').addEventListener('input', (e) => {
  const index = Number(e.target.value);
  timelineCutoff = index >= timelineDates.length ? null : timelineDates[index];
  updateTimelineLabels();
  renderEvidencePanel();
  updateFilterVisibility();
});
$('#timelineReset').addEventListener('click', () => {
  timelineCutoff = null;
  $('#timelineRange').value = String(timelineDates.length);
  updateTimelineLabels();
  renderEvidencePanel();
  updateFilterVisibility();
});
document.querySelectorAll('.language-btn').forEach((button) => button.addEventListener('click', () => applyLanguage(button.dataset.language)));
document.querySelectorAll('input[name="ingest_mode"], input[name="media_type"]').forEach((input) => input.addEventListener('change', updateIngestMode));
$('#downloadMetadataBtn').addEventListener('click', downloadMetadataSheet);
$('#streetMapBtn').addEventListener('click', () => setMapStyle('street'));
$('#satelliteMapBtn').addEventListener('click', () => setMapStyle('satellite'));
map.on('zoomend', refreshMarkerDisplay);

const drawerHandle = $('#drawerHandle');
let drawerGesture = null;
drawerHandle.addEventListener('pointerdown', (event) => {
  if (!window.matchMedia('(max-width: 720px)').matches) return;
  const wrap = document.querySelector('.map-wrap');
  wrap.classList.remove('panel-collapsed');
  drawerGesture = { pointerId: event.pointerId, startY: event.clientY, startHeight: document.querySelector('.evidence-panel').getBoundingClientRect().height, moved: false };
  drawerHandle.setPointerCapture(event.pointerId);
  drawerHandle.classList.add('dragging');
  event.preventDefault();
});
drawerHandle.addEventListener('pointermove', (event) => {
  if (!drawerGesture || drawerGesture.pointerId !== event.pointerId) return;
  const delta = drawerGesture.startY - event.clientY;
  drawerGesture.moved = drawerGesture.moved || Math.abs(delta) > 5;
  const height = Math.max(56, Math.min(window.innerHeight * 0.78, drawerGesture.startHeight + delta));
  document.querySelector('.map-wrap').style.setProperty('--mobile-drawer-height', Math.round(height) + 'px');
  map.invalidateSize({ pan: false });
});
function finishDrawerGesture(event) {
  if (!drawerGesture || drawerGesture.pointerId !== event.pointerId) return;
  const wrap = document.querySelector('.map-wrap');
  if (!drawerGesture.moved) wrap.classList.toggle('panel-collapsed');
  const collapsed = wrap.classList.contains('panel-collapsed');
  drawerHandle.setAttribute('aria-expanded', String(!collapsed));
  $('#panelToggle').textContent = collapsed ? '+' : '−';
  $('#panelToggle').setAttribute('aria-expanded', String(!collapsed));
  drawerHandle.classList.remove('dragging');
  drawerGesture = null;
  setTimeout(() => map.invalidateSize({ pan: false }), 220);
}
drawerHandle.addEventListener('pointerup', finishDrawerGesture);
drawerHandle.addEventListener('pointercancel', finishDrawerGesture);
$('#uploadForm').addEventListener('submit', submitItem);
$('#mediaFile').addEventListener('change', updateLocalPreview);
$('#title').addEventListener('input', () => {
  if ($('#title').value.trim() !== autoTitleFromFile) autoTitleFromFile = '';
});
$('#sourceUrl').addEventListener('input', updateSourceHint);
$('#unknownLocation').addEventListener('change', handleUnknownLocation);
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ['uploadModal', 'detailModal', 'howModal', 'metadataModal'].forEach(closeModal); });

let savedLanguage = 'en';
try { savedLanguage = localStorage.getItem('rasuwa-language') || (navigator.language.toLowerCase().startsWith('ne') ? 'ne' : 'en'); } catch {}
applyLanguage(savedLanguage);
loadItems().then(startLiveRefresh);
