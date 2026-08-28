'use strict';

const { Pool } = require('pg');
const DOWNVOTE_THRESHOLD = 50;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const columns = ['drive_url','drive_file_id','storage_type','source_url','document_source_url','publisher_type','source_platform','source_post_id','original_filename','mime_type','file_size','thumbnail_url','community_notes','metadata_history','media_type','title','description','location_name','lat','lng','captured_at','taken_by','owner','contact','location_source','acknowledged','submitted_at','status'];
const defaults = { drive_url:'', drive_file_id:'', storage_type:'legacy_link', source_url:'', document_source_url:'', publisher_type:'', source_platform:'', source_post_id:'', original_filename:'', mime_type:'', file_size:0, thumbnail_url:'', community_notes:'', metadata_history:'[]', description:'', location_name:'', captured_at:'', taken_by:'', owner:'', contact:'', location_source:'User-set', acknowledged:0, status:'published' };

const ready = pool.query(`
  CREATE TABLE IF NOT EXISTS media (
    id BIGSERIAL PRIMARY KEY, drive_url TEXT NOT NULL DEFAULT '', drive_file_id TEXT NOT NULL DEFAULT '',
    storage_type TEXT NOT NULL DEFAULT 'legacy_link', source_url TEXT NOT NULL DEFAULT '', document_source_url TEXT NOT NULL DEFAULT '', publisher_type TEXT NOT NULL DEFAULT '',
    source_platform TEXT NOT NULL DEFAULT '', source_post_id TEXT NOT NULL DEFAULT '', original_filename TEXT NOT NULL DEFAULT '', mime_type TEXT NOT NULL DEFAULT '', file_size BIGINT NOT NULL DEFAULT 0, thumbnail_url TEXT NOT NULL DEFAULT '', community_notes TEXT NOT NULL DEFAULT '', metadata_history TEXT NOT NULL DEFAULT '[]',
    media_type TEXT NOT NULL CHECK (media_type IN ('photo','video','document')), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '',
    lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL, captured_at TEXT NOT NULL DEFAULT '', taken_by TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
    location_source TEXT NOT NULL DEFAULT 'User-set', acknowledged INTEGER NOT NULL DEFAULT 0, submitted_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published', downvotes INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS media_published_idx ON media(status, downvotes, id DESC);
  ALTER TABLE media ADD COLUMN IF NOT EXISTS thumbnail_url TEXT NOT NULL DEFAULT '';
  ALTER TABLE media ADD COLUMN IF NOT EXISTS community_notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE media ADD COLUMN IF NOT EXISTS metadata_history TEXT NOT NULL DEFAULT '[]';
`).catch((error) => { console.error('PostgreSQL initialization failed:', error); throw error; });

async function query(text, values = []) { await ready; return pool.query(text, values); }
async function listItems() { return (await query('SELECT * FROM media WHERE status = $1 AND downvotes < $2 ORDER BY id DESC', ['published', DOWNVOTE_THRESHOLD])).rows; }
async function listAllItems() { return (await query('SELECT * FROM media ORDER BY id DESC')).rows; }
async function getItem(id) { return (await query('SELECT * FROM media WHERE id = $1', [id])).rows[0] || null; }
async function createItem(data) {
  const values = columns.map((key) => data[key] ?? defaults[key] ?? null);
  const placeholders = columns.map((_, index) => '$' + (index + 1)).join(', ');
  return (await query('INSERT INTO media (' + columns.join(', ') + ') VALUES (' + placeholders + ') RETURNING *', values)).rows[0];
}
async function updateItem(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getItem(id);
  const assignments = keys.map((key, index) => key + ' = $' + (index + 2)).join(', ');
  return (await query('UPDATE media SET ' + assignments + ' WHERE id = $1 RETURNING *', [id, ...keys.map((key) => fields[key])])).rows[0] || null;
}
async function downvoteItem(id) { return (await query('UPDATE media SET downvotes = downvotes + 1 WHERE id = $1 RETURNING *', [id])).rows[0] || null; }

module.exports = { listItems, listAllItems, getItem, createItem, updateItem, downvoteItem, DOWNVOTE_THRESHOLD };
