'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDownloaderArgs } = require('../social-download');

test('builds yt-dlp arguments with a valid 250 MB limit', () => {
  const args = buildDownloaderArgs('https://x.com/example/status/123', '/tmp/source.%(ext)s');
  const maxIndex = args.indexOf('--max-filesize');
  assert.ok(maxIndex >= 0);
  assert.equal(args[maxIndex + 1], '250M');
  assert.ok(!args.includes('262144000B'));
  assert.equal(args[args.indexOf('--no-playlist')], '--no-playlist');
  assert.equal(args[args.indexOf('--merge-output-format') + 1], 'mp4');
});
