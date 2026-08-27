# VIVA-D — Virtual Imagery and Video Archive for Disasters

VIVA-D is an open collection of geotagged photographs and videos documenting the impacts of natural disasters, with an initial focus on floods and landslides. It provides organized visual data and associated metadata to support disaster reconnaissance, research, assessment, and resilience efforts.

## Rasuwa Flood Evidence Map

A public web platform for documenting the **August 26, 2026 flash flood** on the
Bhote Koshi river in Nepal's Rasuwa district (Timure, Syaphrubesi and the areas
between). Anyone can add a photo or video with its metadata — who took it, when,
where exactly, who owns it, contact details, and what it shows. Every item
appears instantly on a big map as a clickable marker with the archived media
stored in the project's Google Drive folder. If the media came from Facebook,
X, or Twitter, the original social URL is preserved separately as provenance.

**By design:** anyone can upload, but **no one — not even an admin — can delete
or edit** an item. The data is an immutable record for research and
verification.

---

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

- `npm test` — runs the test suite.
- `npm run dev` — restarts the server automatically on file changes.
- `npm run drive:auth` — one-time Google Drive OAuth authorization.
- `node scripts/get-drive-folder-id.js` — list folders available to the archive account.

Social URL imports require Python 3.10+ and the bundled `yt-dlp` downloader;
FFmpeg is recommended for video streams. The server downloads only one public
item, up to 250 MB, and does not bypass login or platform access controls. The
backend uses yt-dlp's supported `250M` file-size limit and merges video streams
with FFmpeg when available.

For server-side Drive uploads, the service account shown in your Google Cloud
screen (`rasuwastorage@project-da957902-2b51-4bce-80f.iam.gserviceaccount.com`)
can be used. A screenshot or email address is not an authentication credential:
you must download its JSON key from Google Cloud and keep that key private.

Requirements: Node.js 18+ (tested on Node 24). Data is stored in a single
SQLite file at `data/media.db`, created automatically on first run. Direct
uploads require the Google Drive setup below; the public map can still run
without it.

---

## How it works for visitors

1. The map is centered on the flood corridor between Timure and Syaphrubesi. The two buttons switch between the official OpenStreetMap street view and Google Satellite imagery.
2. 📷 markers are photos, 🎥 markers are videos. Click one to see the archived
   thumbnail, a summary, and an **"Open archived media"** button; click
   **"More details"** for the full metadata.
3. When a source URL was provided, the original Facebook, X, or Twitter post
   appears as a separate provenance link.

## How to add evidence

1. Click **"＋ Add evidence"** and select the original photo or video from your
   device. The server archives the file in the configured Google Drive folder;
   the visitor-facing record uses that archived copy, not a pasted Drive URL.
2. If the media came from Facebook, X, or Twitter, paste the original public
   post URL in **"Original Facebook, X, or Twitter post"**. This is stored as
   provenance, separately from the archived media.
3. Choose Photo or Video, then click the mini-map (or use **"Use my location"**)
   to drop the pin at the exact spot. The place name is filled in automatically
   and can be edited.
4. Add a short title, when it was taken, who took it, who owns the rights, an
   optional public contact, and a description.
5. Tick **"I confirm this is authentic"** — this is required.
6. Click **"Archive and publish"**. The item appears immediately after the
   Google Drive upload succeeds.

### Social-media source links

The app records Facebook/X/Twitter URLs and extracts their platform and post ID.
When the Google Drive archive is configured, a source-only submission uses the
bundled `yt-dlp` downloader to fetch one public media item, then archives that
file in Drive. It does **not** bypass login walls, private posts, or platform
access controls. If a post is unsupported or restricted, download the media
through the platform's permitted tools and use the local-file option instead.
The downloader must be able to access the post without a browser login or
cookies; a public URL alone does not guarantee that a platform will permit
server-side downloading.

---

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/items` | All published items (with thumbnail URLs) |
| GET | `/api/items/:id` | One item |
| POST | `/api/items` | Create an item (validated, rate-limited) |
| DELETE / PUT / PATCH | *any* | **404 — intentionally not implemented** |

### POST validation rules

- Multipart requests use the `media` file field and accept one image or video up to 250 MB.
- A submission must contain exactly one source: a local `media` file or a social `source_url`.
- Social URL imports require Google Drive OAuth configuration, Python 3.10+, FFmpeg for video merging, and a public post supported by the bundled `yt-dlp`. The server downloads one item, up to 250 MB, then archives it in Drive.
- JSON requests with `drive_url` remain supported for legacy records.
- Optional `source_url` must be a Facebook, X, or Twitter post link; the server stores its platform and post ID.
- `media_type` must be `photo` or `video`.
- `title` is required (max 200 chars); other fields optional with length caps.
- `lat`/`lng` must be numbers within Nepal's bounds.
- `acknowledged` must be `1` — the authenticity checkbox is mandatory.
- Field lengths are capped; long/oversized bodies are rejected.
- Submissions are rate-limited to 10 per hour per IP, and a hidden honeypot
  field quietly absorbs spam bots (they receive a fake success and nothing is
  stored).

### Fields stored per item

`storage_type`, `drive_url`, `drive_file_id`, `original_filename`, `mime_type`,
`file_size`, `source_url`, `source_platform`, `source_post_id`, `media_type`,
`title`, `description`, `location_name`, `lat`, `lng`, `captured_at`, `taken_by`,
`owner`, `contact`, `acknowledged`, `submitted_at`, `status` (reserved for a
future moderation queue — everything is `published` today).

---

## Project structure

```
server.js        entry point (starts the HTTP server)
app.js           Express app: API routes, validation, rate limiting
db.js            SQLite schema + data access
drive.js         Google Drive link parsing + thumbnail URL builder
drive-storage.js Google Drive OAuth upload helper
social.js        Facebook/X/Twitter provenance URL parsing
scripts/         one-time Drive OAuth and folder helper scripts
public/          frontend (no build step)
  index.html     page: header, map, modals
  styles.css     big-screen, readable design
  app.js         map, markers/popups, upload wizard, detail view
test/            node:test suites (drive parsing + API behaviour)
data/            SQLite database (created at runtime, gitignored)
```

---

## Configure Google Drive uploads

The service account in your screenshot is:

`rasuwastorage@project-da957902-2b51-4bce-80f.iam.gserviceaccount.com`

Your Google Cloud organization blocks service-account key creation, so use
Gmail OAuth for this project:

1. In Google Cloud, enable the **Google Drive API**. In **Google Auth Platform →
   Audience**, add `rasuwaflood@gmail.com` as a test user. Create an OAuth
   client with application type **Desktop app**, then download its JSON file.
2. Keep the downloaded JSON private. Place it in the project folder as
   `google-oauth-client.json`.
3. In `.env`, configure the four Drive folders and client path:

   ```dotenv
   GOOGLE_OAUTH_CLIENT_FILE=/absolute/path/to/google-oauth-client.json
   GOOGLE_DRIVE_FOLDER_ID=1VtWiMw_A3j-4lB9VEf15kAwpMuB7ac6_
   GOOGLE_DRIVE_IMAGE_FOLDER_ID=1n_7RgPbnki3jHkfTJ9smrCHnTm7ldrzJ
   GOOGLE_DRIVE_VIDEO_FOLDER_ID=1SC0SDkzCN88WoLJyoJz9rTuaqMrDVuqx
   GOOGLE_DRIVE_DOWNLOAD_FOLDER_ID=1bWl6DxxlgiMHoGXzy4O28RnhyTInmxfn
   ```

4. Run `npm run drive:auth`. Open the printed URL and approve access with
   `rasuwaflood@gmail.com`. The app stores the token in the Git-ignored
   `.oauth-token.json` file.
5. Restart the server. The form should report **Google Drive archive connected**.
   Photos go to `Image`, videos to `Video`, and social imports to `Download`.

The folder IDs are taken from your Drive links. The Gmail account authorized in
OAuth must own or have Editor access to those folders. The OAuth client JSON and
`.oauth-token.json` are secrets; never paste either file into chat or commit
them. Service-account authentication remains available for organizations that
allow key creation, but it is not needed here.

### Optional Google Satellite map

The Street button uses official OpenStreetMap tiles. The Satellite button uses Google Satellite through the supported Google Maps JavaScript API. To enable
it, create a browser API key in Google Cloud, enable **Maps JavaScript API**,
restrict the key to your site origins, and add this locally to `.env`:

```dotenv
GOOGLE_MAPS_API_KEY=your_browser_key
```

Do not send the key in chat. Billing must be enabled on the Google Cloud project;
Google may apply its current Maps usage pricing and credits. Without this key,
Street remains available and Satellite will explain that setup is required.

Social URL imports additionally require Python 3.10+ and the bundled `yt-dlp`
tool.

## Deploying

Any small server with Node.js works (a $5 VPS or Railway/Render free tier is
plenty). Steps:

1. Copy the project to the server and run `npm install --omit=dev`.
2. Copy the OAuth client JSON and `.oauth-token.json` to protected paths on
   the server, set `GOOGLE_OAUTH_CLIENT_FILE`, `GOOGLE_OAUTH_TOKEN_FILE`, and
   the Drive folder IDs in the server's environment.
3. Run it with a process manager, e.g. systemd:

   ```ini
   [Unit]
   Description=Rasuwa Flood Evidence Map
   After=network.target

   [Service]
   WorkingDirectory=/opt/evidence-map
   ExecStart=/usr/bin/node server.js
   Environment=PORT=3000
   Environment=GOOGLE_OAUTH_CLIENT_FILE=/etc/rasuwa/google-oauth-client.json
   Environment=GOOGLE_OAUTH_TOKEN_FILE=/var/lib/rasuwa/.oauth-token.json
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

4. Put a reverse proxy in front for HTTPS (Caddy or nginx + certbot) and point
   your domain at port 3000. The official OpenStreetMap street tiles and Leaflet come from public CDNs. Google Satellite is optional and requires a Google Maps JavaScript API key with billing enabled; configure it as `GOOGLE_MAPS_API_KEY`.

### Backups (important)

The whole database is one file. Back it up regularly:

```bash
cp data/media.db backups/media-$(date +%F).db
```

Because it's an append-only record, a backup at any moment is a complete,
consistent snapshot. Store backups somewhere safe and separate.

---

## Privacy & safety notes

- Everything an uploader enters is shown publicly, including the optional
  contact — the form says so, because contact is what lets researchers follow
  up and verify.
- Only share media you took or have permission to share.
- There is no admin panel and no moderation queue yet; the `status` column is
  reserved so a review flow can be added later without changing the schema.

---

## Roadmap (future)

- Lightweight sign-up for uploaders (accountability + follow-up).
- Moderation queue / admin review (the schema already supports it).
- CSV/GeoJSON export of all items for researchers.
- Multiple interface languages.
