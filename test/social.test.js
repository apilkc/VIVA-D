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

test('parses public Instagram posts and TikTok videos', () => {
  assert.deepEqual(parseSocialLink('https://www.instagram.com/reel/C9aBcDeFgHi/'), {
    platform: 'instagram',
    postId: 'C9aBcDeFgHi',
    url: 'https://www.instagram.com/reel/C9aBcDeFgHi/',
  });
  assert.equal(parseSocialLink('https://www.tiktok.com/@archive/video/7351234567890123456').platform, 'tiktok');
  assert.equal(parseSocialLink('https://www.tiktok.com/@archive/video/7351234567890123456').postId, '7351234567890123456');
  assert.equal(parseSocialLink('https://vm.tiktok.com/ZMabcdef/').platform, 'tiktok');
});

test('rejects unsupported or malformed source links', () => {
  assert.equal(parseSocialLink('https://youtube.com/watch?v=abc'), null);
  assert.equal(parseSocialLink('not a url'), null);
  assert.equal(parseSocialLink(''), null);
  assert.equal(parseSocialLink(null), null);
});
