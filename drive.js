'use strict';

// Accepts Google Drive links and extracts the file/folder id.
//   https://drive.google.com/file/d/<ID>/view?usp=sharing
//   https://drive.google.com/open?id=<ID>
//   https://drive.google.com/uc?id=<ID>&export=download
//   https://drive.google.com/drive/folders/<ID>
// Returns { fileId, isFolder } or null when the link is not a Drive file link.

function parseDriveLink(raw) {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!/^(drive|www)\.google\.com$/i.test(host)) return null;
  if (/^www\./i.test(host) && !/\/drive\//i.test(url)) return null;

  const file = url.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  if (file) return { fileId: file[1], isFolder: false };

  const folder = url.match(/\/drive\/folders\/([A-Za-z0-9_-]+)/);
  if (folder) return { fileId: folder[1], isFolder: true };

  const id = url.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (id) return { fileId: id[1], isFolder: false };

  return null;
}

// Public thumbnail endpoint. Works when the file is shared with "Anyone with the link".
function thumbnailUrl(fileId, size = 'w800') {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=${size}`;
}

module.exports = { parseDriveLink, thumbnailUrl };
