'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseSocialLink } = require('./social');

const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const BUNDLED_YTDLP = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');

// Resolve an FFmpeg binary that actually exists. The Dockerfile installs
// ffmpeg onto PATH (Linux); local macOS development may use Homebrew paths.
const FFMPEG_MACOS_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
function resolveFfmpeg() {
  if (process.env.FFMPEG_BINARY && fs.existsSync(process.env.FFMPEG_BINARY)) return process.env.FFMPEG_BINARY;
  for (const candidate of FFMPEG_MACOS_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fall back to PATH (Linux containers / Railway): `which ffmpeg`.
  try {
    const { execSync } = require('child_process');
    const found = execSync('command -v ffmpeg', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (found) return found;
  } catch { /* not on PATH */ }
  return null;
}
const FFMPEG_BINARY = resolveFfmpeg();

function findPython() {
  const configured = process.env.YTDLP_PYTHON;
  const candidates = [
    configured,
    '/opt/homebrew/bin/python3.13',
    '/opt/homebrew/bin/python3.12',
    '/usr/local/bin/python3.13',
    '/usr/local/bin/python3.12',
    'python3.13',
    'python3.12',
    'python3.11',
    'python3.10',
    'python3',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes('/') && !fs.existsSync(candidate)) continue;
    return candidate;
  }
  return null;
}

function mediaTypeForExtension(extension) {
  const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif']);
  return imageExtensions.has(extension.toLowerCase()) ? 'photo' : 'video';
}

function mimeTypeForExtension(extension, mediaType) {
  const ext = extension.toLowerCase();
  const types = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
    m4v: 'video/x-m4v', avi: 'video/x-msvideo', ts: 'video/mp2t',
  };
  return types[ext] || (mediaType === 'photo' ? 'image/jpeg' : 'video/mp4');
}

function buildDownloaderArgs(url, outputTemplate) {
  return [
    BUNDLED_YTDLP,
    url,
    '--no-playlist',
    '--no-warnings',
    '--no-part',
    '--max-filesize', '250M',
    '--format', 'bestvideo*+bestaudio/best',
    '--merge-output-format', 'mp4',
    ...(fs.existsSync(FFMPEG_BINARY) ? ['--ffmpeg-location', FFMPEG_BINARY] : []),
    '--output', outputTemplate,
  ];
}

function runDownloader(url, outputTemplate, python) {
  return new Promise((resolve, reject) => {
    const args = buildDownloaderArgs(url, outputTemplate);
    const child = spawn(python, args, {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('The social-media download timed out.'));
    }, DOWNLOAD_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const detail = (stderr || stdout).trim().split('\n').slice(-1)[0] || 'The downloader could not read this public post.';
      reject(new Error(detail));
    });
  });
}

async function downloadSocialMedia(sourceUrl) {
  const source = parseSocialLink(sourceUrl);
  if (!source) {
    const error = new Error('Source link must be a Facebook, X, or Twitter post link.');
    error.code = 'INVALID_SOCIAL_URL';
    throw error;
  }
  if (!fs.existsSync(BUNDLED_YTDLP)) {
    const error = new Error('The social-media downloader is not installed.');
    error.code = 'DOWNLOADER_MISSING';
    throw error;
  }

  const python = findPython();
  if (!python) {
    const error = new Error('Python 3.10+ is required for social-media imports.');
    error.code = 'PYTHON_MISSING';
    throw error;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasuwa-social-'));
  const outputTemplate = path.join(tempDir, 'source.%(ext)s');

  try {
    await runDownloader(source.url, outputTemplate, python);
    const downloaded = fs.readdirSync(tempDir)
      .map((name) => path.join(tempDir, name))
      .filter((file) => fs.statSync(file).isFile());
    if (downloaded.length !== 1) throw new Error('The public post did not contain one downloadable image or video.');

    const filepath = downloaded[0];
    const size = fs.statSync(filepath).size;
    if (size > MAX_DOWNLOAD_BYTES) throw new Error('The downloaded file is larger than 250 MB.');
    const extension = path.extname(filepath).slice(1) || 'mp4';
    const mediaType = mediaTypeForExtension(extension);

    return {
      filepath,
      cleanupDir: tempDir,
      filename: `${source.platform}-${source.postId || 'media'}.${extension}`,
      mimeType: mimeTypeForExtension(extension, mediaType),
      size,
      mediaType,
      source,
    };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function cleanupDownloadedMedia(download) {
  if (!download) return;
  fs.rmSync(download.cleanupDir, { recursive: true, force: true });
}

async function extractSocialMetadata(sourceUrl) {
  const source = parseSocialLink(sourceUrl);
  if (!source) {
    const error = new Error('Source link must be a Facebook, X, or Twitter post link.');
    error.code = 'INVALID_SOCIAL_URL';
    throw error;
  }
  if (!fs.existsSync(BUNDLED_YTDLP)) {
    const error = new Error('The social-media downloader is not installed.');
    error.code = 'DOWNLOADER_MISSING';
    throw error;
  }
  const python = findPython();
  if (!python) {
    const error = new Error('Python 3.10+ is required for social-media imports.');
    error.code = 'PYTHON_MISSING';
    throw error;
  }

  return new Promise((resolve, reject) => {
    const args = [
      BUNDLED_YTDLP,
      source.url,
      '--no-playlist',
      '--no-warnings',
      '--dump-json',
      '--skip-download',
    ];
    const child = spawn(python, args, {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Metadata extraction timed out.'));
    }, 30000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = (stderr || stdout).trim().split('\n').slice(-1)[0] || 'Could not read metadata from this post.';
        return reject(new Error(detail));
      }
      try {
        const json = JSON.parse(stdout);
        resolve({
          title: json.title || json.fulltitle || json.description || '',
          description: json.description || json.title || '',
          uploader: json.uploader || json.creator || json.channel || '',
          upload_date: json.upload_date || '',
          thumbnail: json.thumbnail || '',
          platform: source.platform,
        });
      } catch {
        reject(new Error('Could not parse metadata from this post.'));
      }
    });
  });
}

module.exports = {
  downloadSocialMedia,
  cleanupDownloadedMedia,
  extractSocialMetadata,
  buildDownloaderArgs,
  MAX_DOWNLOAD_BYTES,
  DOWNLOAD_TIMEOUT_MS,
};
