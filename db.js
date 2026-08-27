'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Override with DB_PATH=:memory: (tests) or a custom file location.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'media.db');

if (DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_url      TEXT    NOT NULL DEFAULT '',
    drive_file_id  TEXT    NOT NULL DEFAULT '',
    storage_type   TEXT    NOT NULL DEFAULT 'drive' CHECK (storage_type IN ('drive','legacy_link','pending')),
    source_url     TEXT    NOT NULL DEFAULT '',
    source_platform TEXT   NOT NULL DEFAULT '',
    source_post_id TEXT    NOT NULL DEFAULT '',
    original_filename TEXT  NOT NULL DEFAULT '',
    mime_type      TEXT    NOT NULL DEFAULT '',
    file_size      INTEGER NOT NULL DEFAULT 0,
    media_type     TEXT    NOT NULL CHECK (media_type IN ('photo','video','document')),
    title          TEXT    NOT NULL,
    description    TEXT    NOT NULL DEFAULT '',
    location_name  TEXT    NOT NULL DEFAULT '',
    lat            REAL    NOT NULL,
    lng            REAL    NOT NULL,
    captured_at    TEXT    NOT NULL DEFAULT '',
    taken_by       TEXT    NOT NULL DEFAULT '',
    owner          TEXT    NOT NULL DEFAULT '',
    contact        TEXT    NOT NULL DEFAULT '',
    acknowledged   INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged IN (0,1)),
    submitted_at   TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'published'
  );
`);

// Additive migrations keep existing evidence records readable after upgrades.
const columns = db.prepare('PRAGMA table_info(media)').all().map((column) => column.name);
const migrations = [
  ['storage_type', "ALTER TABLE media ADD COLUMN storage_type TEXT NOT NULL DEFAULT 'legacy_link'"],
  ['source_url', "ALTER TABLE media ADD COLUMN source_url TEXT NOT NULL DEFAULT ''"],
  ['source_platform', "ALTER TABLE media ADD COLUMN source_platform TEXT NOT NULL DEFAULT ''"],
  ['source_post_id', "ALTER TABLE media ADD COLUMN source_post_id TEXT NOT NULL DEFAULT ''"],
  ['original_filename', "ALTER TABLE media ADD COLUMN original_filename TEXT NOT NULL DEFAULT ''"],
  ['mime_type', "ALTER TABLE media ADD COLUMN mime_type TEXT NOT NULL DEFAULT ''"],
  ['file_size', "ALTER TABLE media ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0"],
  ['downvotes', "ALTER TABLE media ADD COLUMN downvotes INTEGER NOT NULL DEFAULT 0"],
];
for (const [name, sql] of migrations) {
  if (!columns.includes(name)) db.exec(sql);
}

const DOWNVOTE_THRESHOLD = 50;
const listStmt = db.prepare('SELECT * FROM media WHERE status = ? AND (downvotes < ? OR downvotes IS NULL) ORDER BY id DESC');
const listAllStmt = db.prepare('SELECT * FROM media ORDER BY id DESC');
const getStmt = db.prepare('SELECT * FROM media WHERE id = ?');
const insertStmt = db.prepare(`
  INSERT INTO media (
    drive_url, drive_file_id, storage_type, source_url, source_platform, source_post_id,
    original_filename, mime_type, file_size, media_type, title, description, location_name,
    lat, lng, captured_at, taken_by, owner, contact, acknowledged, submitted_at, status
  ) VALUES (
    @drive_url, @drive_file_id, @storage_type, @source_url, @source_platform, @source_post_id,
    @original_filename, @mime_type, @file_size, @media_type, @title, @description, @location_name,
    @lat, @lng, @captured_at, @taken_by, @owner, @contact, @acknowledged, @submitted_at, @status
  )
`);
const updateStmt = db.prepare(`
  UPDATE media SET
    drive_url = @drive_url,
    drive_file_id = @drive_file_id,
    storage_type = @storage_type,
    original_filename = @original_filename,
    mime_type = @mime_type,
    file_size = @file_size,
    media_type = @media_type,
    status = @status
  WHERE id = @id
`);

function listItems() {
  return listStmt.all('published', DOWNVOTE_THRESHOLD);
}

function listAllItems() {
  return listAllStmt.all();
}

function getItem(id) {
  return getStmt.get(id);
}

function createItem(data) {
  const info = insertStmt.run({ ...data, status: data.status || 'published' });
  return getItem(info.lastInsertRowid);
}

function updateItem(id, fields) {
  updateStmt.run({ ...fields, id });
  return getItem(id);
}

const downvoteStmt = db.prepare('UPDATE media SET downvotes = downvotes + 1 WHERE id = ?');

function downvoteItem(id) {
  const item = getItem(id);
  if (!item) return null;
  downvoteStmt.run(id);
  return getItem(id);
}

module.exports = { listItems, listAllItems, getItem, createItem, updateItem, downvoteItem, DOWNVOTE_THRESHOLD };
