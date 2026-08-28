# VIVA-D — Virtual Imagery and Video Archive for Disasters

VIVA-D is an open collection of geotagged photographs and videos documenting the impacts of natural disasters, with an initial focus on floods and landslides. It provides organized visual data and associated metadata to support disaster reconnaissance, research, assessment, and resilience efforts.

**Live archive:** [archive.rasuwaflood.org](https://archive.rasuwaflood.org/)

## Rasuwa Flood Evidence Map

A public web platform documenting the **August 2026 floods and landslides**
affecting Rasuwa, Nuwakot, Dhading, and surrounding areas in Nepal. People have
shared important images and videos of damaged roads and bridges, river
conditions, landslides, homes, recovery work, and the realities communities are
facing. These records are usually scattered across platforms, can be difficult
to find later, and may disappear over time.

VIVA-D brings this evidence and its basic metadata together in one public,
searchable place. It is intended to help communities, researchers, journalists,
response teams, and recovery planning take a more evidence-based approach.
Having supported early response after the 2015 Gorkha earthquake, the creator
recognizes the seriousness of this disaster and the importance of preserving
evidence with care and humility.

Anyone can contribute permitted material. Public photos, videos, and documents
are archived in cloud storage and shown on the map with their available
metadata. For public social-media imports, the original Facebook, X/Twitter,
Instagram, or TikTok link is retained as provenance.

### Principles and contributor guidance

- **Open source:** The code is available at [github.com/apilkc/VIVA-D](https://github.com/apilkc/VIVA-D).
- **Public data:** Evidence and metadata submitted to this archive are public and openly shared.
- **Research value:** The archive is a practical step toward evidence-based disaster research, response, and recovery.
- **No AI-generated media:** Do not upload AI-generated, altered, or synthetic images or videos as disaster evidence.
- **Safety and privacy:** Upload only material you have permission to share, and avoid exposing people to harm through sensitive or identifying information.
- **Feedback welcome:** This is a growing, vibe-coded project and may have limitations or security issues. Suggestions and corrections are welcome; changes should be made carefully so they do not introduce new risks.

The archive preserves a history of confirmed public metadata corrections, while
retaining the original filename and earlier location values for research
traceability. Evidence itself cannot be deleted through the public interface.

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

Requirements: Node.js 18+ (tested on Node 24). Local development and tests use
SQLite; production uses Railway PostgreSQL when `DATABASE_URL` is configured.
Direct uploads require cloud-storage configuration; the public map can still run
without it.

---

## How it works for visitors

1. The map is centered on the flood corridor between Timure and Syaphrubesi. The two buttons switch between the official OpenStreetMap street view and Google Satellite imagery.
2. 📷 markers are photos, 🎥 markers are videos. Click one to see the archived
   thumbnail, a summary, and an **"Open archived media"** button; click
   **"More details"** for the full metadata.
3. When a source URL was provided, the original Facebook, X/Twitter, Instagram,
   or TikTok post
   appears as a separate provenance link.

## How to add evidence

1. Click **"＋ Add evidence"** and select the original photo or video from your
   device. The server archives the file in configured cloud storage;
   the visitor-facing record uses that archived copy, not a pasted Drive URL.
2. If the media came from Facebook, X/Twitter, Instagram, or TikTok, paste the
   original public post URL. This is stored as
   provenance, separately from the archived media.
3. Choose Photo or Video, then click the mini-map (or use **"Use my location"**)
   to drop the pin at the exact spot. The place name is filled in automatically
   and can be edited.
4. Add a short title, when it was taken, who took it, who owns the rights, an
   optional public contact, and a description.
5. Tick **"I confirm this is authentic"** — this is required.
6. Click **"Archive and publish"**. The item appears immediately after the
   cloud-storage upload succeeds.

### Social-media source links

The app records Facebook/X/Twitter/Instagram/TikTok URLs and extracts their
platform and post ID. When cloud storage is configured, a source-only submission
uses the bundled `yt-dlp` downloader to fetch one public media item, then
archives that file. It does **not** bypass login walls, private posts, or platform
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
- Social URL imports require cloud-storage configuration, Python 3.10+, FFmpeg for video merging, and a public post supported by the bundled `yt-dlp`. The server downloads one item, up to 250 MB, then archives it.
- JSON requests with `drive_url` remain supported for legacy records.
- Optional `source_url` must be a public Facebook, X/Twitter, Instagram, or TikTok post link; the server stores its platform and post ID.
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
database.js       selects SQLite locally or PostgreSQL in production
db.js             SQLite schema + data access (local development/tests)
postgres-db.js    PostgreSQL schema + data access (Railway production)
drive.js         Google Drive link parsing + thumbnail URL builder
drive-storage.js Google Drive OAuth upload helper
social.js        social-media provenance URL parsing
scripts/         one-time Drive OAuth and folder helper scripts
public/          frontend (no build step)
  index.html     page: header, map, modals
  styles.css     big-screen, readable design
  app.js         map, markers/popups, upload wizard, detail view
test/            node:test suites (drive parsing + API behaviour)
data/            SQLite database (local development, gitignored)
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
