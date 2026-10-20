# Cloudflare migration

The replacement runs `cloudflare/worker.mjs` with static files in `public/`.
It does not use Railway, PostgreSQL, Python, yt-dlp, or FFmpeg.

## Recovery status

The Google Cloud Storage snapshot dated October 1, 2026 contains 125 records,
including 122 published records below the flag threshold. The complete export
is retained locally in ignored `data/recovered-2026-10-01.json`. This may not
include submissions made after the snapshot. Preserve Railway until any newer
records have been checked.

The public GitHub recovery snapshot intentionally excludes contributor contact
details, community notes, and correction history. The full private recovery
export is the source for importing into D1.

## Deploy

1. Authenticate Wrangler with the existing Cloudflare account.
2. Run `wrangler d1 create viva-d-archive` and add its returned database ID to
   `wrangler.jsonc` as a `d1_databases` entry with binding `DB` and
   database name `viva-d-archive`.
3. Run `wrangler d1 execute viva-d-archive --remote --file cloudflare/schema.sql`.
4. Run `node scripts/prepare-cloudflare.cjs data/recovered-2026-10-01.json`.
5. Run `wrangler d1 execute viva-d-archive --remote --file data/cloudflare-seed.sql`.
   Imports use INSERT OR IGNORE to preserve existing database records.
6. Configure encrypted Worker secrets `GOOGLE_SERVICE_ACCOUNT_EMAIL` and
   `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` from the existing storage service account.
   Never put credentials in source code or GitHub. `GOOGLE_MAPS_API_KEY` is optional;
   the street map works without Google Maps billing.
7. Run `wrangler deploy` and check `/api/health` and `/api/items` on the Worker URL.
8. Connect `archive.rasuwaflood.org` only after verifying the replacement. The old
   proxied CNAME points to `7vhgerf2.up.railway.app` (TTL Auto). Preserve that value
   for rollback. Cloudflare custom domains require removing the conflicting
   manually managed CNAME before attaching the custom domain.
9. Verify the public map, media previews, photo upload, and metadata corrections.
   Then stop Railway compute services after checking production data freshness.

The existing Cloudflare GitHub build integration currently reports that it is
disconnected. Reconnect it before relying on automatic deployments.

## Features and cost controls

- Existing media remain in the Google Cloud Storage bucket. Its storage and
  bandwidth charges are separate from hosting and are not eliminated by migration.
- New direct photos, videos, and PDF documents are limited to 20 MB per file.
- Photo GPS/date extraction runs in the visitor's browser with bundled exifr.
- Social imports return the requested cost notice and never start a downloader.
- Video files upload without processing or thumbnail generation.
- Thumbnails load directly from storage instead of passing through server compute.
- D1 stores metadata and hourly request limits. Scheduled cleanup runs daily.
- Map refresh runs once a minute while the page is visible.
- Each new upload also writes an independent JSON recovery record under
  `metadata/cloudflare/`. Original Railway metadata exports are preserved.

Without DB/secrets, the Worker serves the bundled public snapshot and clearly
reports uploads unavailable. This is a browsing-only recovery mode, not a completed
upload migration.

## Validation

`npm test` passes 52 tests, including eight Cloudflare migration tests.
`wrangler deploy --dry-run` bundles the Worker and assets successfully.
Live deployment and successful upload verification remain required.
