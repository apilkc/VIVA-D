'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const FOLDER_KEYS = ['image', 'video', 'download'];

function getServiceAccountCredentials() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || '';
  if (keyFile && fs.existsSync(keyFile)) return { keyFile };

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  if (clientEmail && privateKey) {
    return { clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') };
  }
  return null;
}

function readOAuthClientFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const details = json.installed || json.web || json;
    if (!details.client_id || !details.client_secret) return null;
    return { clientId: details.client_id, clientSecret: details.client_secret };
  } catch {
    return null;
  }
}

function getOAuthCredentials() {
  const fileCredentials = readOAuthClientFile(process.env.GOOGLE_OAUTH_CLIENT_FILE || '');
  const clientId = process.env.GOOGLE_CLIENT_ID || fileCredentials?.clientId || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || fileCredentials?.clientSecret || '';
  const tokenFile = process.env.GOOGLE_OAUTH_TOKEN_FILE || path.join(__dirname, '.oauth-token.json');
  let savedToken = null;
  if (fs.existsSync(tokenFile)) {
    try {
      savedToken = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    } catch {
      savedToken = null;
    }
  }
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || savedToken?.refresh_token || '';
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, tokenFile };
}

function getFolderIds() {
  return {
    root: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
    image: process.env.GOOGLE_DRIVE_IMAGE_FOLDER_ID || '',
    video: process.env.GOOGLE_DRIVE_VIDEO_FOLDER_ID || '',
    download: process.env.GOOGLE_DRIVE_DOWNLOAD_FOLDER_ID || '',
  };
}

function getDriveConfig({ requireFolder = true, folderKey = '' } = {}) {
  const folderIds = getFolderIds();
  const requestedFolder = folderKey && FOLDER_KEYS.includes(folderKey) ? folderIds[folderKey] : '';
  const folderId = folderKey
    ? (requestedFolder || folderIds.root)
    : (folderIds.root || folderIds.image || folderIds.video || folderIds.download);
  const serviceAccount = getServiceAccountCredentials();

  if (serviceAccount && (!requireFolder || folderId)) {
    return { authType: 'service_account', serviceAccount, folderId, folderIds };
  }

  const oauth = getOAuthCredentials();
  if (oauth && (!requireFolder || folderId)) {
    return { authType: 'oauth', ...oauth, folderId, folderIds };
  }
  return null;
}

function createDriveClient(config = getDriveConfig({ requireFolder: false })) {
  if (!config) return null;
  let auth;
  if (config.authType === 'service_account') {
    auth = new google.auth.GoogleAuth({
      ...(config.serviceAccount.keyFile
        ? { keyFile: config.serviceAccount.keyFile }
        : { credentials: {
          client_email: config.serviceAccount.clientEmail,
          private_key: config.serviceAccount.privateKey,
        } }),
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  } else {
    auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
    auth.setCredentials({ refresh_token: config.refreshToken });
  }
  return { drive: google.drive({ version: 'v3', auth }), folderId: config.folderId, folderIds: config.folderIds || {} };
}

async function uploadToDrive({ filepath, filename, mimeType, folderKey = '' }) {
  const config = getDriveConfig({ folderKey });
  const client = createDriveClient(config);
  const targetFolderId = folderKey && config?.folderIds?.[folderKey]
    ? config.folderIds[folderKey]
    : client?.folderId;
  if (!client || !targetFolderId) {
    const error = new Error('Google Drive storage is not configured for this file type.');
    error.code = 'DRIVE_NOT_CONFIGURED';
    throw error;
  }

  const response = await client.drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: filename,
      parents: [targetFolderId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(filepath),
    },
    fields: 'id,name,mimeType,size,webViewLink,webContentLink',
  });

  const fileId = response.data.id;
  if (!fileId) throw new Error('Google Drive did not return a file ID.');

  await client.drive.permissions.create({
    fileId,
    supportsAllDrives: true,
    requestBody: { type: 'anyone', role: 'reader' },
  });

  return {
    fileId,
    filename: response.data.name || filename,
    mimeType: response.data.mimeType || mimeType,
    size: response.data.size ? Number(response.data.size) : fs.statSync(filepath).size,
    driveUrl: `https://drive.google.com/file/d/${fileId}/view`,
  };
}

module.exports = { getDriveConfig, createDriveClient, uploadToDrive, getFolderIds };
