'use strict';

require('dotenv').config();

const { google } = require('googleapis');
const { createDriveClient } = require('../drive-storage');

async function main() {
  const client = createDriveClient();
  if (!client) {
    console.error('Configure GOOGLE_SERVICE_ACCOUNT_KEY_FILE plus GOOGLE_DRIVE_FOLDER_ID, or set the OAuth variables, in .env first.');
    process.exit(1);
  }

  const response = await client.drive.files.list({
    q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id,name,webViewLink)',
    orderBy: 'name',
    pageSize: 100,
  });

  console.log('Drive folders visible to the archive account:');
  for (const folder of response.data.files || []) {
    console.log(`${folder.name}\n  ID: ${folder.id}\n`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
