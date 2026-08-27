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
app.use(express.json({ limit: '64kb' }));

/* ---------- serialization ---------- */

function serialize(item) {
  const driveFileId = item.drive_file_id || '';
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
    drive_url: item.drive_url || '',
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
    submitted_at: item.submitted_at,
    thumbnailUrl: driveFileId ? thumbnailUrl(driveFileId) : null,
    previewUrl: driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/preview` : null,
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

  if (directUpload && file && (v.media_type === 'photo' || v.media_type === 'video')) {
    const expectedPrefix = v.media_type === 'photo' ? 'image/' : 'video/';
    if (!file.mimetype.startsWith(expectedPrefix)) {
      errors.push(v.media_type === 'photo'
        ? 'Choose an image file for Photo.'
        : 'Choose a video file for Video.');
    }
  }

  if (v.source_url) {
    if (v.source_url.length > MAX_LEN.source_url) {
      errors.push('The source link is too long.');
    } else if (!parseSocialLink(v.source_url)) {
      errors.push('Source link must be a public Facebook, X, or Twitter post link.');
    }
  }

  if (v.media_type !== 'photo' && v.media_type !== 'video' && !(socialImport && !v.media_type)) {
    errors.push('Choose whether this is a photo or a video.');
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
      storage_type: 'drive',
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
    if (!getDriveConfig()) {
      return res.status(503).json({
        error: 'Direct uploads are not configured yet. The site owner must connect Google Drive first.',
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
    if (!getDriveConfig()) {
      removeTemporaryFile(req.file);
      return res.status(503).json({
        error: 'Direct uploads are not configured yet. The site owner must connect Google Drive first.',
      });
    }

    try {
      const result = await uploadToDrive({
        filepath: req.file.path,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        folderKey: v.media_type === 'photo' ? 'image' : 'video',
      });
      stored = {
        storage_type: 'drive',
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
          error: 'Direct uploads are not configured yet. The site owner must connect Google Drive first.',
        });
      }
      console.error('Media archive failed:', error);
      removeTemporaryFile(req.file);
      return res.status(502).json({ error: 'Google Drive could not save this file. Please try again.' });
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
    if (/^(image|video)\//.test(file.mimetype)) return callback(null, true);
    const error = new Error('Only image and video files can be uploaded.');
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

module.exports = app;
