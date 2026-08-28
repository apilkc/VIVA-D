'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function createVideoThumbnail(videoPath) {
  const outputPath = path.join(os.tmpdir(), `viva-d-thumbnail-${crypto.randomUUID()}.jpg`);
  return new Promise((resolve, reject) => {
    // A frame one second into the recording avoids the black first frame that
    // is common in phone and social-media videos.
    const process = spawn('ffmpeg', [
      '-y', '-ss', '00:00:01', '-i', videoPath,
      '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', outputPath,
    ], { stdio: 'ignore' });
    process.once('error', (error) => reject(error));
    process.once('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) return resolve(outputPath);
      reject(new Error('FFmpeg could not create a video thumbnail.'));
    });
  });
}

function removeFile(filePath) {
  if (!filePath) return;
  try { fs.rmSync(filePath, { force: true }); } catch { /* best effort */ }
}

module.exports = { createVideoThumbnail, removeFile };
