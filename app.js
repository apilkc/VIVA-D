'use strict';

const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const db = require('./db');
const { listAllItems } = db;
const { parseDriveLink, thumbnailUrl } = require('./drive');
const { parseSocialLink } = require('./social');
const { getDriveConfig, uploadToDrive } = require('./drive-storage');
const { downloadSocialMedia, cleanupDownloadedMedia, extractSocialMetadata } = require('./social-download');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));

/* ---------- serialization ---------- */

function serialize(item) {
  const driveFileId = item.drive_file_id || '';
  const driveUrl = item.drive_url || '';
  const isGcs = driveUrl.startsWith('https://storage.googleapis.com/');
  let previewUrl = null;
  if (isGcs) {
    previewUrl = driveUrl;
  } else if (driveFileId) {
    previewUrl = `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/preview`;
  }
  return {
    id: item.id,
    status: item.status || 'published',
    downvotes: item.downvotes || 0,
    storage_type: item.storage_type || (item.drive_url ? 'legacy_link' : 'drive'),
    source_url: item.source_url || '',
    source_platform: item.source_platform || '',
    source_post_id: item.source_post_id || '',
    original_filename: item.original_filename || '',
    mime_type: item.mime_type || '',
    file_size: item.file_size || 0,
    drive_url: driveUrl,
    media_type: item.media_type,
    title: item.title,
    description: item.description,
    location_name: item.location_name,
    lat: item.lat,
    lng: item.lng,
    captured_at: item.captured_at,
    taken_by: item.taken_by,
    owner: item.owner,
    contact: item.contact,
    location_source: item.location_source || '',
    submitted_at: item.submitted_at,
    thumbnailUrl: isGcs ? driveUrl : (driveFileId ? thumbnailUrl(driveFileId) : null),
    previewUrl,
  };
}

/* ---------- validation ---------- */

const BOUNDS = { latMin: 26, latMax: 31, lngMin: 79.5, lngMax: 89 }; // Nepal
const MAX_LEN = {
  drive_url: 2048,
  source_url: 2048,
  title: 200,
  description: 5000,
  location_name: 200,
  captured_at: 120,
  taken_by: 200,
  owner: 200,
  contact: 300,
};

function clean(body) {
  const b = body || {};
  const s = (key) => (typeof b[key] === 'string' ? b[key].trim() : '');
  return {
    drive_url: s('drive_url'),
    source_url: s('source_url'),
    media_type: b.media_type,
    title: s('title'),
    description: s('description'),
    location_name: s('location_name'),
    lat: Number(b.lat),
    lng: Number(b.lng),
    captured_at: s('captured_at'),
    taken_by: s('taken_by'),
    owner: s('owner'),
    contact: s('contact'),
    location_source: s('location_source'),
    acknowledged: b.acknowledged,
    website: s('website'),
  };
}

function validate(v, { directUpload = false, socialImport = false, file = null } = {}) {
  const errors = [];

  if (!directUpload && !socialImport) {
    if (!v.drive_url) {
      errors.push('Please provide a photo or video file.');
    } else if (v.drive_url.length > MAX_LEN.drive_url) {
      errors.push('The Drive link is too long.');
    } else {
      const parsed = parseDriveLink(v.drive_url);
      if (!parsed) errors.push('That does not look like a valid Google Drive file link.');
      else if (parsed.isFolder) errors.push('Please link to a single file, not a whole folder.');
    }
  }

  if (directUpload && file) {
    if (v.media_type === 'photo') {
      if (!file.mimetype.startsWith('image/')) {
        errors.push('Choose an image file for Photo.');
      }
    } else if (v.media_type === 'video') {
      if (!file.mimetype.startsWith('video/')) {
        errors.push('Choose a video file for Video.');
      }
    } else if (v.media_type === 'document') {
      if (!file.mimetype.startsWith('application/') && !file.mimetype.endsWith('/pdf')) {
        errors.push('Choose a document file (PDF, DOCX, etc.) for Document.');
      }
    }
  }

  if (v.source_url) {
    if (v.source_url.length > MAX_LEN.source_url) {
      errors.push('The source link is too long.');
    } else if (!parseSocialLink(v.source_url)) {
      errors.push('Source link must be a public Facebook, X, or Twitter post link.');
    }
  }

  if (v.media_type !== 'photo' && v.media_type !== 'video' && v.media_type !== 'document' && !(socialImport && !v.media_type)) {
    errors.push('Choose whether this is a photo, video, or document.');
  }

  if (!v.title) errors.push('Please give this item a short title.');
  else if (v.title.length > MAX_LEN.title) errors.push('The title is too long (200 characters maximum).');

  if (v.description.length > MAX_LEN.description) errors.push('The description is too long (5000 characters maximum).');
  if (v.location_name.length > MAX_LEN.location_name) errors.push('The place name is too long.');
  if (v.captured_at.length > MAX_LEN.captured_at) errors.push('The date field is too long.');
  if (v.taken_by.length > MAX_LEN.taken_by) errors.push('The "taken by" field is too long.');
  if (v.owner.length > MAX_LEN.owner) errors.push('The owner field is too long.');
  if (v.contact.length > MAX_LEN.contact) errors.push('The contact field is too long.');

  if (!Number.isFinite(v.lat) || v.lat < BOUNDS.latMin || v.lat > BOUNDS.latMax) {
    errors.push('Please set a valid location on the map (latitude).');
  }
  if (!Number.isFinite(v.lng) || v.lng < BOUNDS.lngMin || v.lng > BOUNDS.lngMax) {
    errors.push('Please set a valid location on the map (longitude).');
  }

  if (Number(v.acknowledged) !== 1) {
    errors.push('You must tick the confirmation box to submit.');
  }

  return errors;
}

function removeTemporaryFile(file) {
  if (!file || !file.path) return;
  try {
    fs.rmSync(file.path, { force: true });
  } catch {
    // Best-effort cleanup; the operating system will eventually clear /tmp.
  }
}

/* ---------- routes ---------- */

app.get('/api/config', (req, res) => {
  try {
    const { getGcsConfig } = require('./drive-storage');
    const gcsReady = Boolean(getGcsConfig());
    const driveReady = Boolean(getDriveConfig());
    res.json({
      directUploadsEnabled: gcsReady || driveReady,
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
      storageType: gcsReady ? 'gcs' : driveReady ? 'drive' : 'none',
    });
  } catch {
    const driveReady = Boolean(getDriveConfig());
    res.json({
      directUploadsEnabled: driveReady,
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
      storageType: driveReady ? 'drive' : 'none',
    });
  }
});

/* ---------- EXIF GPS extraction ---------- */

const exifUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, callback) => {
      callback(null, `gps-check-${crypto.randomUUID()}${path.extname(file.originalname) || '.jpg'}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for GPS check
  fileFilter: (req, file, callback) => {
    if (/^image\//.test(file.mimetype)) return callback(null, true);
    callback(null, false);
  },
});

app.post('/api/extract-gps', exifUpload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.json({ gps: null });
  }
  try {
    const exifr = require('exifr');
    // exifr returns latitude/longitude in decimal degrees and understands
    // JPEG, PNG, WebP, TIFF and HEIC/HEIF (modern phone photos, esp. iPhone).
    const exif = await exifr.parse(req.file.path, { gps: true });
    removeTemporaryFile(req.file);

    if (exif && exif.latitude != null && exif.longitude != null) {
      const lat = Number(exif.latitude);
      const lng = Number(exif.longitude);
      if (lat >= 26 && lat <= 31 && lng >= 79.5 && lng <= 89) {
        return res.json({ gps: { lat, lng } });
      }
    }
    res.json({ gps: null });
  } catch (error) {
    console.error('EXIF extraction error:', error.message);
    removeTemporaryFile(req.file);
    res.json({ gps: null });
  }
});

app.get('/api/social-metadata', async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!url || !parseSocialLink(url)) {
    return res.status(400).json({ error: 'Provide a valid Facebook, X, or Twitter post URL.' });
  }
  try {
    const meta = await extractSocialMetadata(url);
    res.json(meta);
  } catch (error) {
    if (error.code === 'INVALID_SOCIAL_URL') return res.status(400).json({ error: error.message });
    if (error.code === 'DOWNLOADER_MISSING' || error.code === 'PYTHON_MISSING') return res.status(503).json({ error: error.message });
    console.error('Social metadata extraction failed:', error);
    res.status(502).json({ error: 'Could not read metadata from this post.' });
  }
});

app.get('/api/items', (req, res) => {
  const items = (req.query.all === '1' ? db.listAllItems() : db.listItems()).map(serialize);
  res.json({ items });
});

app.get('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = Number.isInteger(id) && id > 0 ? db.getItem(id) : null;
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json({ item: serialize(item) });
});

app.post('/api/items/:id/downvote', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid item ID.' });
  }
  const item = db.downvoteItem(id);
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json({ item: serialize(item), message: item.downvotes >= db.DOWNVOTE_THRESHOLD ? 'This item has been hidden due to community feedback.' : 'Thank you for your feedback.' });
});

async function processSocialImport(itemId, sourceUrl, mediaType) {
  let downloaded = null;
  try {
    downloaded = await downloadSocialMedia(sourceUrl);
    const result = await uploadToDrive({
      filepath: downloaded.filepath,
      filename: downloaded.filename,
      mimeType: downloaded.mimeType,
      folderKey: 'download',
    });
    db.updateItem(itemId, {
      drive_url: result.driveUrl,
      drive_file_id: result.fileId,
      storage_type: result.driveUrl.startsWith('https://storage.googleapis.com/') ? 'gcs' : 'drive',
      original_filename: result.filename,
      mime_type: result.mimeType,
      file_size: result.size,
      media_type: downloaded.mediaType,
      status: 'published',
    });
    console.log(`Social import ${itemId} completed: ${result.filename}`);
  } catch (error) {
    console.error(`Social import ${itemId} failed:`, error.message);
    db.updateItem(itemId, {
      drive_url: '',
      drive_file_id: '',
      storage_type: 'legacy_link',
      original_filename: '',
      mime_type: '',
      file_size: 0,
      media_type: mediaType || 'video',
      status: 'failed',
    });
  } finally {
    if (downloaded) cleanupDownloadedMedia(downloaded);
  }
}

async function createItemHandler(req, res) {
  const body = req.body || {};
  const directUpload = Boolean(req.file);
  const hasSourceUrl = typeof body.source_url === 'string' && body.source_url.trim() !== '';

  // Honeypot: bots fill the hidden "website" field. Answer with a fake success
  // and store nothing, so bots never learn they were detected.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    removeTemporaryFile(req.file);
    return res.status(201).json({ item: null });
  }

  const v = clean(body);
  // A JSON request with a Drive link is retained for legacy records; the
  // public form uses source_url alone to request a social-media import.
  const sourceImport = !directUpload && hasSourceUrl && !v.drive_url;
  const errors = validate(v, { directUpload, socialImport: sourceImport, file: req.file });
  if (errors.length > 0) {
    removeTemporaryFile(req.file);
    return res.status(400).json({ errors });
  }
  if (!directUpload && !sourceImport && !v.drive_url) {
    return res.status(400).json({ errors: ['Choose a local file or provide a Facebook, X, or Twitter link.'] });
  }
  if (directUpload && hasSourceUrl) {
    removeTemporaryFile(req.file);
    return res.status(400).json({ errors: ['Choose either a local file or a social-media link, not both.'] });
  }
  if (hasSourceUrl && v.drive_url) {
    return res.status(400).json({ errors: ['Choose either a social-media link or a Google Drive link, not both.'] });
  }

  const source = v.source_url ? parseSocialLink(v.source_url) : null;

  // Social imports: return immediately with a pending item, process in background.
  if (sourceImport) {
    if (!getDriveConfig() && !require('./drive-storage').getGcsConfig()) {
      return res.status(503).json({
        error: 'Cloud storage is not configured yet. The site owner must finish storage setup before uploads can be archived.',
      });
    }
    const item = db.createItem({
      drive_url: '',
      drive_file_id: '',
      storage_type: 'pending',
      source_url: source ? source.url : '',
      source_platform: source ? source.platform : '',
      source_post_id: source ? source.postId : '',
      original_filename: '',
      mime_type: '',
      file_size: 0,
      media_type: v.media_type || 'video',
      title: v.title,
      description: v.description,
      location_name: v.location_name,
      lat: v.lat,
      lng: v.lng,
      captured_at: v.captured_at,
      taken_by: v.taken_by,
      owner: v.owner,
      contact: v.contact,
      acknowledged: 1,
      submitted_at: new Date().toISOString(),
      status: 'pending',
    });
    processSocialImport(item.id, v.source_url, v.media_type);
    return res.status(202).json({ item: serialize(item), message: 'Import started. The media will appear on the map once archiving completes.' });
  }

  // Direct file uploads and legacy Drive links: synchronous flow.
  let stored = {
    storage_type: 'legacy_link',
    drive_url: v.drive_url,
    drive_file_id: parseDriveLink(v.drive_url)?.fileId || '',
    original_filename: '',
    mime_type: '',
    file_size: 0,
  };

  if (directUpload) {
    if (!getDriveConfig() && !require('./drive-storage').getGcsConfig()) {
      removeTemporaryFile(req.file);
      return res.status(503).json({
        error: 'Cloud storage is not configured yet. The site owner must finish storage setup before uploads can be archived.',
      });
    }

    try {
      let folderKey = 'media';
      if (v.media_type === 'photo') folderKey = 'image';
      else if (v.media_type === 'video') folderKey = 'video';
      else if (v.media_type === 'document') folderKey = 'document';
      
      const result = await uploadToDrive({
        filepath: req.file.path,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        folderKey,
      });
      stored = {
        storage_type: result.driveUrl.startsWith('https://storage.googleapis.com/') ? 'gcs' : 'drive',
        drive_url: result.driveUrl,
        drive_file_id: result.fileId,
        original_filename: result.filename,
        mime_type: result.mimeType,
        file_size: result.size,
      };
    } catch (error) {
      if (error.code === 'DRIVE_NOT_CONFIGURED') {
        removeTemporaryFile(req.file);
        return res.status(503).json({
          error: 'Cloud storage is not configured yet. The site owner must finish storage setup before uploads can be archived.',
        });
      }
      console.error('Media archive failed:', error);
      removeTemporaryFile(req.file);
      return res.status(502).json({ error: 'Cloud Storage could not save this file. Please try again.' });
    }
    removeTemporaryFile(req.file);
  }

  const item = db.createItem({
    ...stored,
    source_url: source ? source.url : '',
    source_platform: source ? source.platform : '',
    source_post_id: source ? source.postId : '',
    media_type: v.media_type,
    title: v.title,
    description: v.description,
    location_name: v.location_name,
    lat: v.lat,
    lng: v.lng,
    captured_at: v.captured_at,
    taken_by: v.taken_by,
    owner: v.owner,
    contact: v.contact,
    acknowledged: 1,
    submitted_at: new Date().toISOString(),
  });
  res.status(201).json({ item: serialize(item) });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, callback) => {
      const safeName = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_');
      callback(null, `evidence-${crypto.randomUUID()}-${safeName}`);
    },
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (/^(image|video|application)\//.test(file.mimetype)) return callback(null, true);
    const error = new Error('Only image, video, or document files can be uploaded.');
    error.code = 'UNSUPPORTED_MEDIA_TYPE';
    callback(error);
  },
});

const POST_LIMIT = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this address. Please wait an hour and try again.' },
});

if (process.env.NODE_ENV === 'test') {
  app.post('/api/items', upload.single('media'), createItemHandler);
} else {
  app.post('/api/items', POST_LIMIT, upload.single('media'), createItemHandler);
}

// Everything else under /api (including DELETE and PUT) is intentionally not
// implemented — deletion is impossible by design.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Friendly errors for malformed JSON and multipart uploads.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'The file is too large. Maximum size is 250 MB.'
      : 'The upload could not be read. Please choose one image or video file.';
    return res.status(400).json({ error: message });
  }
  if (err.code === 'UNSUPPORTED_MEDIA_TYPE') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

/* static frontend */
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- GCS file browser ---------- */

const BROWSE_FOLDERS = [
  { key: 'image', label: '📷 Images', desc: 'Photos uploaded by the community' },
  { key: 'video', label: '🎥 Videos', desc: 'Videos uploaded or imported from social media' },
  { key: 'download', label: '⬇️ Downloads', desc: 'Files downloaded from Facebook, X/Twitter' },
  { key: 'document', label: '📄 Documents', desc: 'Reports, PDFs, and other documents' },
];

async function listGcsFiles(prefix) {
  try {
    const { getGcsConfig } = require('./drive-storage');
    const gcsConfig = getGcsConfig();
    if (!gcsConfig) return [];
    const { Storage } = require('@google-cloud/storage');
    const credentials = gcsConfig.serviceAccount.keyFile
      ? undefined
      : { client_email: gcsConfig.serviceAccount.clientEmail, private_key: gcsConfig.serviceAccount.privateKey };
    const storage = new Storage(gcsConfig.serviceAccount.keyFile ? { keyFilename: gcsConfig.serviceAccount.keyFile } : { credentials });
    const [files] = await storage.bucket(gcsConfig.bucket).getFiles({ prefix });
    return files
      .filter((f) => f.name !== prefix && !f.name.endsWith('/'))
      .map((f) => ({
        name: f.name.split('/').pop(),
        fullPath: f.name,
        size: Number(f.metadata.size) || 0,
        modified: f.metadata.updated,
        url: `https://storage.googleapis.com/${gcsConfig.bucket}/${encodeURIComponent(f.name)}`,
      }));
  } catch (err) {
    console.error('GCS list error:', err.message);
    return [];
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

app.get('/browse', async (req, res) => {
  try {
  const folder = req.query.folder || '';
  if (folder && BROWSE_FOLDERS.some((f) => f.key === folder)) {
    const files = await listGcsFiles(folder + '/');
    const folderInfo = BROWSE_FOLDERS.find((f) => f.key === folder);
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const fileRows = files.map((f) =>
      '<tr><td><a href="' + escHtml(f.url) + '" target="_blank" rel="noopener">' + escHtml(f.name) + '</a></td>' +
      '<td>' + formatSize(f.size) + '</td>' +
      '<td>' + (f.modified ? new Date(f.modified).toLocaleDateString() : '') + '</td></tr>'
    ).join('');
    res.send(BROWSE_HTML.replace('{{FOLDER_TITLE}}', escHtml(folderInfo.label) + ' — ' + escHtml(folderInfo.desc))
      .replace('{{BREADCRUMB}}', '<a href="/browse">All Folders</a> / ' + escHtml(folderInfo.label))
      .replace('{{FILE_COUNT}}', files.length + ' file' + (files.length !== 1 ? 's' : ''))
      .replace('{{TOTAL_SIZE}}', formatSize(totalSize))
      .replace('{{FILE_ROWS}}', fileRows || '<tr><td colspan="3" style="text-align:center;color:#888;">No files in this folder yet.</td></tr>'));
  }
  // Folder overview
  const folderCards = await Promise.all(BROWSE_FOLDERS.map(async (f) => {
    const files = await listGcsFiles(f.key + '/');
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    return '<a href="/browse?folder=' + f.key + '" class="browse-card">' +
      '<div class="browse-card-title">' + escHtml(f.label) + '</div>' +
      '<div class="browse-card-desc">' + escHtml(f.desc) + '</div>' +
      '<div class="browse-card-stats">' + files.length + ' file' + (files.length !== 1 ? 's' : '') + ' · ' + formatSize(totalSize) + '</div>' +
      '</a>';
  }));    res.send(BROWSE_HTML.replace('{{FOLDER_TITLE}}', 'Rasuwa Flood Evidence Archive')
    .replace('{{BREADCRUMB}}', 'All Folders')
    .replace('{{FILE_COUNT}}', '')
    .replace('{{TOTAL_SIZE}}', '')
    .replace(/<table[\s\S]*<\/table>/, '<div class="browse-grid">' + folderCards.join('') + '</div>'));
  } catch (err) {
    console.error('Browse error:', err);
    res.status(500).send('<h1>Error loading files</h1><p>' + escHtml(err.message) + '</p><a href="/browse">Try again</a>');
  }
});

const BROWSE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rasuwa Flood Archive — Browse Files</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📂</text></svg>">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f4f6f9;color:#1c2733;min-height:100vh}
.browse-header{background:#fff;border-bottom:1px solid #dde3ea;padding:16px 24px;display:flex;align-items:center;gap:16px}
.browse-header h1{font-size:1.3rem}
.browse-header a{color:#1667d9;text-decoration:none;font-weight:600}
.browse-header a:hover{text-decoration:underline}
.browse-breadcrumb{padding:12px 24px;color:#5c6b7a;font-size:0.9rem}
.browse-breadcrumb a{color:#1667d9;text-decoration:none}
.browse-meta{padding:0 24px 12px;color:#5c6b7a;font-size:0.85rem}
.browse-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:16px 24px}
.browse-card{display:block;background:#fff;border:1px solid #dde3ea;border-radius:12px;padding:20px;text-decoration:none;color:inherit;transition:box-shadow 0.15s}
.browse-card:hover{box-shadow:0 4px 16px rgba(20,40,70,0.12)}
.browse-card-title{font-size:1.2rem;font-weight:700;margin-bottom:6px}
.browse-card-desc{color:#5c6b7a;font-size:0.9rem;margin-bottom:8px}
.browse-card-stats{color:#1667d9;font-size:0.85rem;font-weight:600}
.browse-table{width:100%;border-collapse:collapse;margin:0 24px;max-width:calc(100% - 48px)}
.browse-table th{text-align:left;padding:10px 12px;border-bottom:2px solid #dde3ea;font-size:0.85rem;color:#5c6b7a;font-weight:600}
.browse-table td{padding:10px 12px;border-bottom:1px solid #eee;font-size:0.9rem}
.browse-table td a{color:#1667d9;text-decoration:none;font-weight:500}
.browse-table td a:hover{text-decoration:underline}
.browse-table tr:hover{background:#f8f9fa}
.back-link{display:inline-block;margin:16px 24px;color:#1667d9;text-decoration:none;font-weight:600;font-size:0.9rem}
.back-link:hover{text-decoration:underline}
</style></head><body>
<div class="browse-header">
  <a href="/" style="font-size:1.5rem">🗺️</a>
  <h1>📂 Rasuwa Flood Evidence Archive</h1>
  <a href="/">← Back to map</a>
</div>
<div class="browse-breadcrumb">{{BREADCRUMB}}</div>
<div class="browse-meta">{{FILE_COUNT}} {{TOTAL_SIZE}}</div>
<table class="browse-table"><thead><tr><th>File</th><th>Size</th><th>Modified</th></tr></thead><tbody>{{FILE_ROWS}}</tbody></table>
</body></html>`;

module.exports = app;
