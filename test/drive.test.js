'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDriveLink, thumbnailUrl } = require('../drive');

test('parses /file/d/ links', () => {
  assert.deepEqual(
    parseDriveLink('https://drive.google.com/file/d/AbC123_xYz9/view?usp=sharing'),
    { fileId: 'AbC123_xYz9', isFolder: false }
  );
});

test('parses open?id= links', () => {
  assert.deepEqual(
    parseDriveLink('https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRsTuVwXyZ12345'),
    { fileId: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ12345', isFolder: false }
  );
});

test('parses uc?id= download links', () => {
  assert.deepEqual(
    parseDriveLink('https://drive.google.com/uc?id=FILEID1&export=download'),
    { fileId: 'FILEID1', isFolder: false }
  );
});

test('detects folder links', () => {
  assert.deepEqual(
    parseDriveLink('https://drive.google.com/drive/folders/0B2v6-3FOLDER?resourcekey=0-abc'),
    { fileId: '0B2v6-3FOLDER', isFolder: true }
  );
});

test('rejects non-Drive and malformed input', () => {
  assert.equal(parseDriveLink('https://example.com/file/d/abc'), null);
  assert.equal(parseDriveLink('https://docs.google.com/document/d/abc/view'), null);
  assert.equal(parseDriveLink('https://youtube.com/watch?v=abc'), null);
  assert.equal(parseDriveLink('not a url'), null);
  assert.equal(parseDriveLink(''), null);
  assert.equal(parseDriveLink(null), null);
  assert.equal(parseDriveLink(123), null);
});

test('builds thumbnail URLs', () => {
  assert.equal(thumbnailUrl('abcDEF123'), 'https://drive.google.com/thumbnail?id=abcDEF123&sz=w800');
  assert.equal(thumbnailUrl('x y'), 'https://drive.google.com/thumbnail?id=x%20y&sz=w800');
});
