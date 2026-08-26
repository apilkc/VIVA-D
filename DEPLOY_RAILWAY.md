# Deploy to Railway (full app with Google Drive archiving)

This deploys the **complete** app — visitors can upload photos/videos, paste
Facebook/X/Twitter links, and items are archived straight into the
`rasuwaflood@gmail.com` Google Drive folders.

The repo ships a `Dockerfile` (installs Python 3.10+ and FFmpeg) and a
`railway.json` (start command + health check), so Railway will build and run it
with no extra config files.

---

## Before you start: create a Google **service account** (do this once)

> Why not reuse the rasuwaflood OAuth token? Tokens from the local
> `npm run drive:auth` flow are tied to `127.0.0.1` and expire (testing-mode
> tokens die every 7 days). A **service account** is a machine identity that
> never expires, needs no consent screen, and works headlessly on a server.

1. Go to <https://console.cloud.google.com/> and open the same project that has
   your Google Drive API enabled.
2. **APIs & Services → Credentials → + Create Credentials → Service account.**
3. Name it `viva-d-uploader` (any name). Click **Create and continue**, then
   **Done** (you can skip the roles).
4. On the service account row, click the **⋮ menu → Manage keys.**
5. **Add Key → Create new key → JSON → Create.** A `.json` file downloads
   (keep it private). It contains two fields you'll need:
   - `client_email` → e.g. `viva-d-uploader@<project>.iam.gserviceaccount.com`
   - `private_key` → a long `-----BEGIN PRIVATE KEY-----…` block

6. **Share your Drive folders with that service-account email.** For each of
   these folders on drive.google.com, open **Share** and add the service
   account email with **Editor**:
   - `Rasuwa Flood` (root)
   - `Image`
   - `Video`
   - `Download`

   (Same idea as when you shared them with rasuwaflood — except it's the
   service-account email now.)

---

## On Railway (free tier)

1. Create a free account at <https://railway.app>.
2. **New Project → Deploy from GitHub repo** and pick `VIVA-D`.
3. Railway detects the `Dockerfile` and deploys automatically.

### Set the secret environment variables

Railway **variables** tab → add these. `PORT` is set for you automatically;
do not override it unless needed.

| Variable | Value |
|----------|-------|
| `GOOGLE_DRIVE_FOLDER_ID` | your `Rasuwa Flood` folder ID |
| `GOOGLE_DRIVE_IMAGE_FOLDER_ID` | your `Image` folder ID |
| `GOOGLE_DRIVE_VIDEO_FOLDER_ID` | your `Video` folder ID |
| `GOOGLE_DRIVE_DOWNLOAD_FOLDER_ID` | your `Download` folder ID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | the whole `private_key` string |
| `GOOGLE_MAPS_API_KEY` | optional — enables the Satellite button |
| `PORT` | leave unset (Railway injects it) |

> **Important:** paste the private key exactly. If it contains newlines, use
> the actual multi-line value — Railway stores env values verbatim. Do **not**
> put these in the GitHub repo; they stay private in Railway.

### Networking

- Railway gives each project a `.up.railway.app` HTTPS domain automatically.
- You can add a custom domain later in **Settings → Networking**.

---

## After first deploy

- Open the generated Railway URL.
- The **＋ Add media** form should show
  *"Google Drive archive connected."*
- Upload a photo → it lands in the `Image` folder.
- Upload a video → it lands in the `Video` folder.
- Paste a Facebook/X/Twitter link → the server uses `yt-dlp` (Python + FFmpeg,
  both installed by the Dockerfile) to download it into the `Download` folder.

---

## Database note

The map metadata (titles, locations, descriptions) lives in a local SQLite file
(`data/media.db`) that is **not** persisted on Railway's free tier across
redeploys. The actual evidence files are safe in Google Drive. For a permanent
shared list on the public site, either:
- accept a fresh list per deploy, or
- back up/restore `data/media.db`, or
- later move the metadata store to a managed Postgres (Railway add-on).

Social-video download limits and provenance rules documented in `README.md`
still apply on the hosted site.

---

## Troubleshooting

- **"Google Drive archive not connected"** → service-account email is wrong, or
  the Drive folders were not shared with it. Re-check sharing.
- **Deploy fails to build** → Railway needs the Dockerfile; if it picked
  Nixpacks instead, force Docker by adding `railway.json` (already present) or
  setting the deploy builder to Docker on the Railway dashboard.
- **ffmpeg not found on social download** → the Dockerfile installs it; make
  sure the image actually rebuilt (check deploy logs).