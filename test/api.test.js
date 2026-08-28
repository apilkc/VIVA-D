'use strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app');
const { parseSocialLink } = require('../social');

let server;
let base;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function validBody(overrides = {}) {
  return {
    drive_url: 'https://drive.google.com/file/d/ABC123xyz/view?usp=sharing',
    source_url: '',
    media_type: 'photo',
    title: 'Bridge washed out near Timure',
    description: 'The road bridge over the Bhote Koshi was destroyed by the flood.',
    location_name: 'Timure, Rasuwa',
    lat: 28.2537,
    lng: 85.3665,
    captured_at: 'Aug 26, 2026, early morning',
    taken_by: 'A. Resident',
    owner: 'A. Resident',
    contact: 'resident@example.com',
    acknowledged: 1,
    ...overrides,
  };
}

async function post(body) {
  const res = await fetch(`${base}/api/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function listItems() {
  const res = await fetch(`${base}/api/items`);
  assert.equal(res.status, 200);
  return (await res.json()).items;
}

test('reports map configuration separately from Drive configuration', async () => {
  const res = await fetch(`${base}/api/config`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(typeof data.directUploadsEnabled, 'boolean');
  assert.equal(typeof data.googleMapsApiKey, 'string');
  assert.equal(data.googleMapsApiKey, '');
});

test('formats EXIF photo capture dates for form autofill', () => {
  assert.equal(app.locals.formatExifCaptureDate(new Date(2026, 7, 26, 6, 30)), '20260826');
  assert.equal(app.locals.formatExifCaptureDate('2026:08:26 06:30:00'), '20260826');
  assert.equal(app.locals.formatExifCaptureDate(''), '');
});

test('starts with an empty list', async () => {
  assert.deepEqual(await listItems(), []);
});

test('serves the browse overview and a selected folder with one response', async () => {
  const overview = await fetch(`${base}/browse`);
  assert.equal(overview.status, 200);
  assert.match(await overview.text(), /Rasuwa Flood Evidence Archive/);

  const folder = await fetch(`${base}/browse?folder=video`);
  assert.equal(folder.status, 200);
  assert.match(await folder.text(), /All Folders<\/a> \/ 🎥 Videos/);
});

test('parses social source URLs for provenance', () => {
  assert.equal(parseSocialLink('https://x.com/example/status/123456').platform, 'x');
});

test('creates a valid legacy item, published immediately, with a thumbnail URL', async () => {
  const { status, data } = await post(validBody({ location_source: 'Photo GPS' }));
  assert.equal(status, 201);
  assert.equal(data.item.title, 'Bridge washed out near Timure');
  assert.equal(data.item.location_source, 'Photo GPS');
  assert.equal(data.item.thumbnailUrl, '/api/items/1/thumbnail');
  assert.equal(typeof data.item.id, 'number');
});

test('new item appears in the public list', async () => {
  const items = await listItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].location_name, 'Timure, Rasuwa');
});

test('creates a document without map data and retains its document metadata', async () => {
  const { status, data } = await post(validBody({
    media_type: 'document',
    location_name: '',
    lat: '',
    lng: '',
    location_source: '',
    captured_at: '',
    taken_by: '',
    owner: '',
    contact: '',
    title: 'Flood impact assessment',
    description: 'Initial assessment prepared for public review.',
    document_source_url: 'https://example.org/flood-assessment.pdf',
    publisher_type: 'government',
  }));
  assert.equal(status, 201);
  assert.equal(data.item.media_type, 'document');
  assert.equal(data.item.location_name, '');
  assert.equal(data.item.publisher_type, 'government');
  assert.equal(data.item.document_source_url, 'https://example.org/flood-assessment.pdf');
});

test('requires a publisher type for documents', async () => {
  const { status, data } = await post(validBody({
    media_type: 'document', location_name: '', lat: '', lng: '', location_source: '', publisher_type: '',
  }));
  assert.equal(status, 400);
  assert.ok(data.errors.some((e) => /publisher type/i.test(e)));
});

test('rejects a missing acknowledgment checkbox', async () => {
  const { status, data } = await post(validBody({ acknowledged: 0 }));
  assert.equal(status, 400);
  assert.ok(data.errors.some((e) => /tick the confirmation box/i.test(e)));
});

test('rejects an item without a title', async () => {
  const { status, data } = await post(validBody({ title: '' }));
  assert.equal(status, 400);
  assert.ok(data.errors.some((e) => /title/i.test(e)));
});

test('rejects coordinates outside Nepal', async () => {
  const { status, data } = await post(validBody({ lat: 45.0 }));
  assert.equal(status, 400);
  assert.ok(data.errors.some((e) => /latitude/i.test(e)));
});

test('rejects a bad Drive link', async () => {
  const { status, data } = await post(validBody({ drive_url: 'https://example.com/video.mp4' }));
  assert.equal(status, 400);
  assert.ok(data.errors.some((e) => /Google Drive/i.test(e)));
});

test('rejects folder links', async () => {
  const { status, data } = await post(validBody({ drive_url: 'https://drive.google.com/drive/folders/0ByG9FOLDER' }));
  assert.equal(status, 400);
  assert.ok(data.errors.some((e) => /single file/i.test(e)));
});

test('honeypot submissions get a fake success and are not stored', async () => {
  const before = (await listItems()).length;
  const { status } = await post(validBody({ website: 'http://spam.example.com' }));
  assert.equal(status, 201);
  assert.equal((await listItems()).length, before);
});

test('rejects a legacy Drive link combined with a social source', async () => {
  const { status, data } = await post(validBody({ source_url: 'https://x.com/example/status/123456' }));
  assert.equal(status, 400);
  assert.ok(data.errors.some((e) => /either a social-media link or a Google Drive link/i.test(e)));
});

test('rejects unsupported social source URLs', async () => {
  const { status, data } = await post(validBody({ source_url: 'https://youtube.com/watch?v=abc' }));
  assert.equal(status, 400);
  assert.ok(data.errors.some((e) => /source link/i.test(e)));
});

test('rejects a submission with both a file and social source', async () => {
  const form = new FormData();
  form.append('media', new Blob(['fake image'], { type: 'image/jpeg' }), 'evidence.jpg');
  form.append('source_url', 'https://x.com/example/status/123456');
  form.append('media_type', 'photo');
  form.append('title', 'Conflicting source test');
  form.append('lat', '28.2');
  form.append('lng', '85.3');
  form.append('acknowledged', '1');
  const res = await fetch(`${base}/api/items`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.errors.some((e) => /either a local file or a social-media link/i.test(e)));
});

test('rejects a source-only submission without a social URL', async () => {
  const form = new FormData();
  form.append('title', 'Missing source test');
  form.append('lat', '28.2');
  form.append('lng', '85.3');
  form.append('acknowledged', '1');
  const res = await fetch(`${base}/api/items`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.errors.some((e) => /photo or video|choose a local file or provide/i.test(e)));
});

test('returns a clear error for social imports without Drive configuration', async () => {
  const form = new FormData();
  form.append('source_url', 'https://x.com/example/status/123456');
  form.append('title', 'Social import test');
  form.append('lat', '28.2');
  form.append('lng', '85.3');
  form.append('acknowledged', '1');
  const res = await fetch(`${base}/api/items`, { method: 'POST', body: form });
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.match(data.error, /not configured/i);
});

test('returns a clear error for direct uploads without Drive configuration', async () => {
  const form = new FormData();
  form.append('media', new Blob(['fake image'], { type: 'image/jpeg' }), 'evidence.jpg');
  form.append('media_type', 'photo');
  form.append('title', 'Direct upload test');
  form.append('lat', '28.2');
  form.append('lng', '85.3');
  form.append('acknowledged', '1');
  const res = await fetch(`${base}/api/items`, { method: 'POST', body: form });
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.match(data.error, /not configured/i);
});

test('derives a missing direct-upload title from the filename', async () => {
  const form = new FormData();
  form.append('media', new Blob(['fake image'], { type: 'image/jpeg' }), 'bridge_washed-out-near_timure.jpg');
  form.append('media_type', 'photo');
  form.append('lat', '28.2');
  form.append('lng', '85.3');
  form.append('acknowledged', '1');
  const res = await fetch(`${base}/api/items`, { method: 'POST', body: form });
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.match(data.error, /not configured/i);
});

test('deletion and updates are not possible (404)', async () => {
  const res = await fetch(`${base}/api/items/1`, { method: 'DELETE' });
  assert.equal(res.status, 404);
  const put = await fetch(`${base}/api/items/1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validBody()),
  });
  assert.equal(put.status, 404);
});

test('unknown API routes return 404', async () => {
  const res = await fetch(`${base}/api/nonsense`);
  assert.equal(res.status, 404);
});

test('missing items return 404', async () => {
  const res = await fetch(`${base}/api/items/9999`);
  assert.equal(res.status, 404);
});

test('downvote increments the count and returns the updated item', async () => {
  // Create an item first
  const { data: created } = await post(validBody({ title: 'Downvote test item' }));
  const id = created.item.id;
  
  // Downvote it
  const res = await fetch(`${base}/api/items/${id}/downvote`, { method: 'POST' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.item.downvotes, 1);
  assert.ok(data.message.includes('feedback'));
});

test('downvote returns 404 for missing items', async () => {
  const res = await fetch(`${base}/api/items/9999/downvote`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test('downvoted items appear in the list with downvote count', async () => {
  // Create and downvote an item
  const { data: created } = await post(validBody({ title: 'List with downvotes test' }));
  const id = created.item.id;
  await fetch(`${base}/api/items/${id}/downvote`, { method: 'POST' });
  
  // Check it appears in the list with downvotes
  const items = await listItems();
  const item = items.find((i) => i.id === id);
  assert.ok(item);
  assert.equal(item.downvotes, 1);
});
