'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDriveConfig } = require('../drive-storage');

function withEnv(values, callback) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] == null) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return callback();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('detects a service-account key file and Drive folder', () => {
  withEnv({
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/etc/hosts',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: '',
    GOOGLE_DRIVE_FOLDER_ID: 'folder-id-for-test',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REFRESH_TOKEN: '',
  }, () => {
    const config = getDriveConfig();
    assert.equal(config.authType, 'service_account');
    assert.equal(config.folderId, 'folder-id-for-test');
    assert.equal(config.serviceAccount.keyFile, '/etc/hosts');
  });
});

test('uses the configured subfolder for each archive type', () => {
  withEnv({
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/etc/hosts',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: '',
    GOOGLE_DRIVE_FOLDER_ID: 'root-folder',
    GOOGLE_DRIVE_IMAGE_FOLDER_ID: 'image-folder',
    GOOGLE_DRIVE_VIDEO_FOLDER_ID: 'video-folder',
    GOOGLE_DRIVE_DOWNLOAD_FOLDER_ID: 'download-folder',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REFRESH_TOKEN: '',
  }, () => {
    assert.equal(getDriveConfig({ folderKey: 'image' }).folderId, 'image-folder');
    assert.equal(getDriveConfig({ folderKey: 'video' }).folderId, 'video-folder');
    assert.equal(getDriveConfig({ folderKey: 'download' }).folderId, 'download-folder');
  });
});

test('does not report Drive as configured without a folder', () => {
  withEnv({
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/etc/hosts',
    GOOGLE_DRIVE_FOLDER_ID: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REFRESH_TOKEN: '',
  }, () => {
    assert.equal(getDriveConfig(), null);
  });
});
