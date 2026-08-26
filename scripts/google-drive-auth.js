'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const { google } = require('googleapis');

const port = Number(process.env.GOOGLE_AUTH_PORT || 8787);
const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
const clientFile = process.env.GOOGLE_OAUTH_CLIENT_FILE || '';
const tokenFile = process.env.GOOGLE_OAUTH_TOKEN_FILE || path.join(__dirname, '..', '.oauth-token.json');

function readClientCredentials() {
  try {
    const json = JSON.parse(fs.readFileSync(clientFile, 'utf8'));
    const details = json.installed || json.web || json;
    if (!details.client_id || !details.client_secret) throw new Error('The OAuth JSON does not contain client_id and client_secret.');
    return { clientId: details.client_id, clientSecret: details.client_secret };
  } catch (error) {
    throw new Error(`Could not read GOOGLE_OAUTH_CLIENT_FILE: ${error.message}`);
  }
}

if (!clientFile) {
  console.error('Set GOOGLE_OAUTH_CLIENT_FILE in .env to the downloaded OAuth client JSON file.');
  process.exit(1);
}

let credentials;
try {
  credentials = readClientCredentials();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const oauth = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, redirectUri);
const authUrl = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, redirectUri);
  if (url.pathname !== '/oauth2callback') {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    response.writeHead(400, { 'Content-Type': 'text/plain' });
    response.end('Authorization was not completed. You can close this window.');
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth.getToken(code);
    fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('Authorization complete. You can close this window and return to the terminal.');
    console.log(`\nGoogle Drive authorization complete. Token saved to ${tokenFile}`);
    console.log('Restart the server; the upload form should report that the archive is connected.\n');
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('Authorization failed. Check the terminal for details.');
    console.error(error.message);
  } finally {
    server.close();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('Open this URL and authorize with rasuwaflood@gmail.com:\n');
  console.log(authUrl);
  console.log(`\nWaiting for the local callback at ${redirectUri}`);
});
