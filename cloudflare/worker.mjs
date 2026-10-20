export const PAUSED_NOTICE = 'Because of high costs, I’m reworking this feature and hope to make it available again soon.';
const MAX_UPLOAD = 20 * 1024 * 1024;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const error = (message, status = 400) => json({ error: message }, status);

export function serialize(item) {
  const url = item.drive_url || '';
  const direct = url.startsWith('https://storage.googleapis.com/');
  const image = /^image\//.test(item.mime_type || '') || /\.(jpe?g|png|webp|gif|avif)(?:$|[?#])/i.test(url);
  return { ...item, id: String(item.id), lat: Number(item.lat), lng: Number(item.lng), downvotes: Number(item.downvotes || 0),
    thumbnailUrl: item.thumbnail_url || (direct && image ? url : item.drive_file_id && !direct ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(item.drive_file_id)}&sz=w400` : null),
    previewUrl: direct ? url : item.drive_file_id ? `https://drive.google.com/file/d/${encodeURIComponent(item.drive_file_id)}/preview` : null };
}

async function list(env, all = false) {
  if (!env.DB) {
    const snapshot = await env.ASSETS.fetch(new Request('https://assets.local/archive-snapshot.json'));
    if (!snapshot.ok) throw new Error('Archive snapshot missing');
    const data = await snapshot.json();
    return (data.items || []).filter(x => all || (x.status === 'published' && Number(x.downvotes || 0) < 50));
  }
  const { results } = await env.DB.prepare('SELECT payload, downvotes FROM archive_items' + (all ? '' : " WHERE status = 'published' AND downvotes < 50") + ' ORDER BY id DESC').all();
  return results.map(x => ({ ...JSON.parse(x.payload), downvotes: x.downvotes }));
}

async function get(env, id) {
  if (!env.DB) return (await list(env, true)).find(x => String(x.id) === id);
  const row = await env.DB.prepare('SELECT payload, downvotes FROM archive_items WHERE id = ?').bind(id).first();
  return row ? { ...JSON.parse(row.payload), downvotes: row.downvotes } : null;
}

async function limit(request, env, action, maximum) {
  if (!env.DB) return false;
  const hour = Math.floor(Date.now() / 3600000);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${request.headers.get('CF-Connecting-IP') || 'local'}:${hour}:${action}`));
  const key = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const row = await env.DB.prepare('INSERT INTO request_limits (key, count, expires) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count').bind(key, (hour + 2) * 3600).first();
  return row.count <= maximum;
}

function b64url(bytes) {
  return btoa(typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
let accessToken;
async function googleToken(env) {
  if (accessToken && accessToken.expires > Date.now()) return accessToken.value;
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify({ iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/devstorage.read_write', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(payload));
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: payload + '.' + b64url(signature) }) });
  if (!response.ok) throw new Error('Storage authentication unavailable');
  const token = await response.json();
  accessToken = { value: token.access_token, expires: Date.now() + 3300000 };
  return accessToken.value;
}

async function store(env, name, body, contentType) {
  const token = await googleToken(env);
  const endpoint = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(env.GOOGLE_CLOUD_STORAGE_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(name)}&ifGenerationMatch=0`;
  const result = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body });
  if (!result.ok) throw new Error('Could not archive file in storage');
  return `https://storage.googleapis.com/${env.GOOGLE_CLOUD_STORAGE_BUCKET}/${name.split('/').map(encodeURIComponent).join('/')}`;
}

const storageReady = env => Boolean(env.DB && env.GOOGLE_CLOUD_STORAGE_BUCKET && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

async function create(request, env) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_UPLOAD + 65536) return error('Please choose a file smaller than 20 MB.', 413);
  const form = await request.formData();
  if (form.get('website')) return json({ ok: true }, 201);
  if (form.get('source_url') && !form.get('media')) return error(PAUSED_NOTICE, 503);
  if (!storageReady(env)) return error('Uploads are temporarily unavailable while the archive moves to its new hosting.', 503);
  if (!await limit(request, env, 'upload', 10)) return error('Too many uploads. Please try again in an hour.', 429);
  const file = form.get('media');
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) return error('Choose a file to upload.');
  if (file.size > MAX_UPLOAD) return error('Please choose a file smaller than 20 MB.', 413);
  const type = form.get('media_type');
  const image = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif', 'image/tiff'].includes(file.type);
  if (!((type === 'photo' && image) || (type === 'video' && ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) || (type === 'document' && (image || file.type === 'application/pdf')))) return error('Choose a supported image, video, or PDF matching the evidence type.');
  const text = name => typeof form.get(name) === 'string' ? form.get(name).trim() : '';
  const item = {};
  const lengths = { title: 200, description: 5000, location_name: 200, captured_at: 120, taken_by: 200, owner: 200, contact: 300, source_url: 2048, document_source_url: 2048, publisher_type: 40, location_source: 40 };
  for (const [name, max] of Object.entries(lengths)) { item[name] = text(name); if (item[name].length > max) return error(`${name.replaceAll('_', ' ')} is too long.`); }
  if (!item.title || text('acknowledged') !== '1') return error('Add a title and confirm that the evidence is authentic.');
  for (const name of ['source_url', 'document_source_url']) if (item[name]) { try { if (!['http:', 'https:'].includes(new URL(item[name]).protocol)) return error('Source links must use http or https.'); } catch { return error('Enter a valid source URL.'); } }
  item.lat = Number(form.get('lat')); item.lng = Number(form.get('lng'));
  if (type !== 'document' && (!Number.isFinite(item.lat) || !Number.isFinite(item.lng) || item.lat < 26 || item.lat > 31 || item.lng < 79.5 || item.lng > 89)) return error('Set a valid location in Nepal.');
  if (type === 'document') { item.lat = 0; item.lng = 0; if (!['government', 'ngo_ingo', 'private'].includes(item.publisher_type)) return error('Choose the publisher type.'); }
  const id = Date.now() * 1000 + crypto.getRandomValues(new Uint16Array(1))[0] % 1000;
  const folder = type === 'photo' ? 'image' : type === 'video' ? 'video' : 'document';
  const name = `${folder}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160)}`;
  item.drive_url = await store(env, name, await file.arrayBuffer(), file.type);
  Object.assign(item, { id: String(id), drive_file_id: name, storage_type: 'gcs', media_type: type, mime_type: file.type, original_filename: file.name.slice(0, 255), file_size: file.size, acknowledged: 1, submitted_at: new Date().toISOString(), status: 'published', downvotes: 0, thumbnail_url: '', metadata_history: '[]', community_notes: '' });
  // Preserve an independent recovery record before accepting the database write.
  await store(env, `metadata/cloudflare/${id}.json`, JSON.stringify(item), 'application/json');
  await env.DB.prepare('INSERT INTO archive_items (id, payload, status, downvotes) VALUES (?, ?, ?, 0)').bind(id, JSON.stringify(item), 'published').run();
  return json({ item: serialize(item) }, 201);
}

async function api(request, env, ctx) {
  const url = new URL(request.url); const path = url.pathname;
  if (path === '/api/config') return json({ directUploadsEnabled: storageReady(env), storageType: 'gcs', googleMapsApiKey: env.GOOGLE_MAPS_API_KEY || '', socialImportsEnabled: false, videoProcessingEnabled: false, featureNotice: PAUSED_NOTICE, maxUploadBytes: MAX_UPLOAD });
  if (path === '/api/health') return json({ ok: true, hosting: 'cloudflare', database: Boolean(env.DB), uploads: storageReady(env) });
  if (path === '/api/social-metadata') return error(PAUSED_NOTICE, 503);
  if (path === '/api/extract-gps') return json({ gps: null, capturedAt: '' }); // EXIF is read in the visitor's browser.
  if (path === '/api/items' && request.method === 'GET') return json({ items: (await list(env)).map(serialize) });
  if (path === '/api/items' && request.method === 'POST') return create(request, env);
  const match = path.match(/^\/api\/items\/(\d+)(?:\/(metadata|downvote|thumbnail))?$/);
  if (match) {
    const item = await get(env, match[1]); if (!item) return error('Evidence was not found.', 404);
    if (request.method === 'GET' && !match[2]) return json({ item: serialize(item) });
    if (request.method === 'GET' && match[2] === 'thumbnail') { const target = serialize(item).thumbnailUrl; return target ? Response.redirect(target, 302) : error('No preview available.', 404); }
    if (request.method === 'POST' && ['metadata', 'downvote'].includes(match[2])) {
      if (!env.DB) return error('Community updates are temporarily unavailable during the hosting move.', 503);
      const origin = request.headers.get('Origin'); if (origin && origin !== url.origin) return error('Invalid request origin.', 403);
      if (!await limit(request, env, match[2], 15)) return error('Too many updates. Please try again in an hour.', 429);
      if (match[2] === 'downvote') {
        const row = await env.DB.prepare('UPDATE archive_items SET downvotes = downvotes + 1 WHERE id = ? RETURNING downvotes').bind(match[1]).first();
        return json({ item: serialize({ ...item, downvotes: row.downvotes }), message: row.downvotes >= 50 ? 'This item has been hidden due to community feedback.' : 'Thank you for your feedback.' });
      }
      if (Number(request.headers.get('Content-Length') || 0) > 65536) return error('Update is too large.', 413);
      const body = await request.json(); if (body.confirmed !== true) return error('Please confirm that this update is accurate.');
      const changes = {}; const updated = { ...item }; const at = new Date().toISOString();
      if (typeof body.title === 'string' && body.title.trim() && body.title.trim() !== item.title) { updated.title = body.title.trim().slice(0, 200); changes.title = { from: item.title, to: updated.title }; }
      if (typeof body.note === 'string' && body.note.trim()) { changes.community_note = body.note.trim().slice(0, 2000); updated.community_notes = [item.community_notes, `[${at}] ${changes.community_note}`].filter(Boolean).join('\n\n'); }
      const lat = Number(body.lat), lng = Number(body.lng);
      if (item.media_type !== 'document' && Number.isFinite(lat) && Number.isFinite(lng) && lat >= 26 && lat <= 31 && lng >= 79.5 && lng <= 89) {
        const location_name = typeof body.location_name === 'string' && body.location_name.trim() ? body.location_name.trim().slice(0, 200) : item.location_name;
        if (lat !== Number(item.lat) || lng !== Number(item.lng) || location_name !== item.location_name) { changes.location = { from: { lat: item.lat, lng: item.lng, name: item.location_name }, to: { lat, lng, name: location_name } }; Object.assign(updated, { lat, lng, location_name, location_source: 'Community update' }); }
      }
      if (!Object.keys(changes).length) return error('Add a note or change a supported field.');
      let history; try { history = JSON.parse(item.metadata_history || '[]'); } catch { history = []; }
      updated.metadata_history = JSON.stringify([...history, { at, changes }].slice(-100));
      // Compare the previous payload to avoid losing simultaneous corrections.
      const old = { ...item }; delete old.downvotes;
      const previous = await env.DB.prepare('SELECT payload FROM archive_items WHERE id = ?').bind(match[1]).first();
      const previousItem = JSON.parse(previous.payload);
      if (previousItem.metadata_history !== item.metadata_history) return error('This record changed. Reload and try again.', 409);
      const result = await env.DB.prepare('UPDATE archive_items SET payload = ? WHERE id = ? AND payload = ?').bind(JSON.stringify(updated), match[1], previous.payload).run();
      if (!result.meta.changes) return error('This record changed. Reload and try again.', 409);
      if (storageReady(env)) ctx.waitUntil(store(env, `metadata/cloudflare/corrections/${match[1]}-${crypto.randomUUID()}.json`, JSON.stringify(updated), 'application/json').catch(() => console.error('Independent metadata backup failed')));
      return json({ item: serialize(updated) });
    }
  }
  if (path === '/api/places' && request.method === 'GET') {
    const query = (url.searchParams.get('q') || '').trim().slice(0, 200); if (query.length < 2) return error('Enter a place name.');
    const provider = new URL('https://photon.komoot.io/api/'); provider.search = new URLSearchParams({ q: query, limit: '5', lat: '28.1', lon: '85.3', countrycode: 'NP' });
    const response = await fetch(provider, { cf: { cacheTtl: 86400, cacheEverything: true } }); if (!response.ok) return error('Place lookup is temporarily unavailable.', 502);
    const data = await response.json(); return json({ places: (data.features || []).map(f => ({ name: [...new Set([f.properties.name, f.properties.city, f.properties.district, f.properties.state, f.properties.country].filter(Boolean))].join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] })) });
  }
  return error('Not found.', 404);
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    try {
      if (path.startsWith('/api/')) {
        if (!['GET', 'HEAD', 'POST'].includes(request.method)) return error('Method not allowed.', 405);
        if (request.method === 'POST') { const origin = request.headers.get('Origin'); if (origin && origin !== new URL(request.url).origin) return error('Invalid request origin.', 403); }
        return await api(request, env, ctx);
      }
      return env.ASSETS.fetch(request);
    } catch (exception) { console.error('Archive request failed', exception.message); return error('The archive is temporarily unavailable. Please try again shortly.', 503); }
  },
  async scheduled(_event, env) { if (env.DB) await env.DB.prepare('DELETE FROM request_limits WHERE expires < ?').bind(Math.floor(Date.now() / 1000)).run(); },
};
