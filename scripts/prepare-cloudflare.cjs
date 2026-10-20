'use strict';
const fs = require('node:fs');
const path = require('node:path');
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/prepare-cloudflare.cjs /path/to/production-snapshot.json');
const snapshot = JSON.parse(fs.readFileSync(source, 'utf8'));
if (!Array.isArray(snapshot.items) || !snapshot.items.length) throw new Error('Refusing to build from an empty or invalid snapshot.');
const ids = new Set();
for (const item of snapshot.items) {
  if (!/^\d+$/.test(String(item.id)) || ids.has(String(item.id)) || !item.title || !['photo', 'video', 'document'].includes(item.media_type)) throw new Error('Invalid or duplicate archive record.');
  ids.add(String(item.id));
}
// Public GitHub recovery copies exclude contributor contact details and free-text
// correction history. The complete recovery export stays in ignored data/.
const publicItems = snapshot.items.filter(item => item.status === 'published' && Number(item.downvotes || 0) < 50)
  .map(({ contact, metadata_history, community_notes, ...item }) => ({ ...item, contact: '', metadata_history: '[]', community_notes: '' }));
fs.writeFileSync(path.join(__dirname, '../public/archive-snapshot.json'), JSON.stringify({ generated_at: snapshot.generated_at, items: publicItems }));
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const statements = snapshot.items.map(item => `INSERT OR IGNORE INTO archive_items (id, payload, status, downvotes) VALUES (${Number(item.id)}, ${quote(JSON.stringify(item))}, ${quote(item.status || 'published')}, ${Number(item.downvotes || 0)});`);
fs.writeFileSync(path.join(__dirname, '../data/cloudflare-seed.sql'), statements.join('\n') + '\n');
console.log(`Prepared ${publicItems.length} published records for static recovery and ${snapshot.items.length} records for D1. Existing D1 records will not be overwritten.`);
