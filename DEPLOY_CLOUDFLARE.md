# Cloudflare deployment (no Railway dependency)

`npx wrangler deploy` builds and deploys the map, API and static assets. The default
configuration requires no paid Cloudflare plan. Without storage bindings it serves
the preserved archive in read-only mode. Do not re-enable Railway or upgrade a plan.

## Finish upload setup

1. In Cloudflare, create a D1 database named `viva-d-archive`. Copy its database ID.
2. Add this top-level configuration to `wrangler.jsonc`, keeping the other settings:
   ```json
   "d1_databases": [{"binding":"DB","database_name":"viva-d-archive","database_id":"YOUR_DATABASE_ID"}]
   ```
3. From the repository run `node cloudflare/seed.mjs`, then
   `npx wrangler d1 execute viva-d-archive --remote --file cloudflare/seed.sql`.
   This creates the tables and inserts the preserved 125 records without replacing
   existing records. Do this before enabling uploads. The Google backup included
   three more records than the earlier public API snapshot.
4. Create a free Cloudflare Turnstile widget for the production hostname and the
   worker's workers.dev hostname. Add these Worker variables/secrets in Settings:
   - `TURNSTILE_SITE_KEY` (variable)
   - `TURNSTILE_SECRET_KEY` (secret)
   - `GOOGLE_CLOUD_STORAGE_BUCKET` (variable, existing bucket)
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` (secret, existing service account)
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (secret, PEM including BEGIN/END lines)
   Keep all secret values out of GitHub and chat. Use the existing Google service
   account with permission to create and read objects in this bucket.
5. Deploy again. Check `/api/config`: `directUploadsEnabled` must be true.
6. In Worker Settings → Domains & Routes, add `archive.rasuwaflood.org` as a custom
   domain. Replace the old Railway DNS route only after the workers.dev preview
   shows the existing archive and a test upload succeeds.

Google JSON API resumable uploads go directly from the browser to Google. The
Worker creates the upload session with the browser Origin header and publishes
metadata only after checking the stored object's size and MIME type. Google
credentials never reach the browser. Existing Google object public-read policy
must cover newly uploaded objects too. Test photo, video and PDF playback.

## Behavior and limits

- Photo GPS is read in the browser; each photo uses its own EXIF when that is the
  selected location source. Manual map locations remain supported.
- Files are limited to 50 MiB, with 20 upload sessions and 200 MiB per UTC day for
  the entire archive. Failed/abandoned sessions count toward these limits.
- These are application upload limits, not a guarantee of zero Google costs.
  Google storage and downloads are billed independently of Cloudflare.
- Automatic Facebook/X/Instagram/TikTok downloads are disabled. Existing source
  links remain visible. Save media to your device and upload it manually.
- Community updates and downvotes require Turnstile. Concurrent metadata updates
  return a retry message instead of silently overwriting one another.
- Place text search is temporarily unavailable; map selection and EXIF work.
- `/browse` opens the map. Existing thumbnails redirect directly to Google.
- New metadata lives in D1. The legacy Node server's scheduled Google metadata
  export does not run here. Export D1 periodically with
  `npx wrangler d1 export viva-d-archive --remote --output archive-backup.sql`.
- Stay on Cloudflare Workers Free. Exhausting free limits can make the site
  unavailable. Do not enable automatic paid upgrades or optional paid services.
- Railway cancellation and any past invoice are separate account actions; this
  code makes no Railway requests and does not alter the Railway subscription.

## Local verification

```
npm ci
node cloudflare/build.mjs
node cloudflare/seed.mjs
node --test cloudflare/test/*.test.mjs
npx wrangler deploy --dry-run
```

The original Express/Railway files are retained for rollback. Root Wrangler config
selects the Cloudflare entry point; it does not deploy the Express server.
