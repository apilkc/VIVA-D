'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSocialLink } = require('../social');

test('parses Facebook video and reel links', () => {
  assert.deepEqual(parseSocialLink('https://www.facebook.com/watch/?v=123456789'), {
    platform: 'facebook',
    postId: '123456789',
    url: 'https://www.facebook.com/watch/?v=123456789',
  });
  assert.equal(parseSocialLink('https://facebook.com/reel/987654321').postId, '987654321');
});

test('parses X and Twitter status links', () => {
  assert.deepEqual(parseSocialLink('https://x.com/example/status/1234567890'), {
    platform: 'x',
    postId: '1234567890',
    url: 'https://x.com/example/status/1234567890',
  });
  assert.equal(parseSocialLink('https://twitter.com/example/status/456').platform, 'x');
});

test('rejects unsupported or malformed source links', () => {
  assert.equal(parseSocialLink('https://youtube.com/watch?v=abc'), null);
  assert.equal(parseSocialLink('not a url'), null);
  assert.equal(parseSocialLink(''), null);
  assert.equal(parseSocialLink(null), null);
});
