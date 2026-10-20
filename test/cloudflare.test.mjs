import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import worker, { PAUSED_NOTICE, serialize } from '../cloudflare/worker.mjs';

const snapshot = JSON.parse(fs.readFileSync(new URL('../public/archive-snapshot.json', import.meta.url)));
const ctx = { waitUntil() {} };
function environment() {
  const sqlite = new Database(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8'));
  const insert = sqlite.prepare('INSERT INTO archive_items (id, payload, status, downvotes) VALUES (?, ?, ?, ?)');
  for (const item of snapshot.items) insert.run(Number(item.id), JSON.stringify(item), item.status, Number(item.downvotes || 0));
  return { DB: { prepare(sql) { let values = []; return { bind(...args) { values = args; return this; }, async first() { return sqlite.prepare(sql).get(...values) || null; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; }, async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: result.changes } }; } }; } }, sqlite };
}
const request = (path, init) => new Request('https://archive.rasuwaflood.org' + path, init);

test('restores only published records and preserves direct media URLs', async () => {
  const env = environment();
  const response = await worker.fetch(request('/api/items?all=1'), env, ctx);
  const { items } = await response.json();
  assert.equal(items.length, snapshot.items.length);
  assert.ok(items.every(x => x.status === 'published' && x.downvotes < 50));
  const photo = items.find(x => x.media_type === 'photo');
  assert.equal(photo.thumbnailUrl, photo.thumbnail_url || photo.drive_url);
  assert.equal(photo.previewUrl, photo.drive_url);
  env.sqlite.close();
});
test('can browse the bundled recovery snapshot without a database', async () => {
  const env = { ASSETS: { fetch: async () => Response.json(snapshot) } };
  const { items } = await (await worker.fetch(request('/api/items'), env, ctx)).json();
  assert.equal(items.length, 122);
});
test('advertises paused processing and reports uploads unavailable without credentials', async () => {
  const config = await (await worker.fetch(request('/api/config'), {}, ctx)).json();
  assert.equal(config.directUploadsEnabled, false);
  assert.equal(config.socialImportsEnabled, false);
  assert.equal(config.videoProcessingEnabled, false);
  assert.equal(config.featureNotice, PAUSED_NOTICE);
});
test('social imports return the cost notice without making a network request', async () => {
  const data = new FormData(); data.append('source_url', 'https://x.com/example/status/123');
  const response = await worker.fetch(request('/api/items', { method: 'POST', body: data }), {}, ctx);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, PAUSED_NOTICE);
});
test('preserves correction history and original filename', async () => {
  const env = environment(); const original = snapshot.items.find(x => x.media_type === 'photo');
  const response = await worker.fetch(request(`/api/items/${original.id}/metadata`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true, title: 'Corrected title', note: 'Verified in the field', lat: original.lat, lng: original.lng }) }), env, ctx);
  assert.equal(response.status, 200);
  const { item } = await response.json();
  assert.equal(item.original_filename, original.original_filename);
  assert.equal(JSON.parse(item.metadata_history).at(-1).changes.title.from, original.title);
  env.sqlite.close();
});
test('flags increment atomically and the threshold hides the item', async () => {
  const env = environment(); const id = snapshot.items[0].id;
  env.sqlite.prepare('UPDATE archive_items SET downvotes=49 WHERE id=?').run(id);
  const response = await worker.fetch(request(`/api/items/${id}/downvote`, { method: 'POST' }), env, ctx);
  assert.equal((await response.json()).item.downvotes, 50);
  const { items } = await (await worker.fetch(request('/api/items'), env, ctx)).json();
  assert.ok(!items.some(x => String(x.id) === String(id)));
  env.sqlite.close();
});
test('rejects cross-origin writes and oversized uploads before reading the body', async () => {
  assert.equal((await worker.fetch(request('/api/items', { method: 'POST', headers: { Origin: 'https://other.example' } }), {}, ctx)).status, 403);
  assert.equal((await worker.fetch(request('/api/items', { method: 'POST', headers: { 'Content-Length': '30000000' } }), {}, ctx)).status, 413);
});
test('does not mistake video files for image previews', () => {
  const item = serialize({ id: 1, drive_url: 'https://storage.googleapis.com/bucket/video/test.mp4', mime_type: 'video/mp4', media_type: 'video' });
  assert.equal(item.thumbnailUrl, null);
  assert.match(item.previewUrl, /test.mp4$/);
});
