# Temporary Wallapop → Source Bridge Edge extension

One-time, **read-only** export of your published Wallapop catalogue from your **normal signed-in Microsoft Edge** session.

This is **not** published to any store. Load it unpacked only for this migration, then remove it.

## Install (Edge)

1. Open Microsoft Edge.
2. Go to `edge://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder:
   `scripts/wallapop-migration/edge-extension/`
6. Open your catalogue:
   https://es.wallapop.com/app/catalog/published
7. Click the extension icon.
8. Click **Scan My Published Listings**.

Keep the popup open until it says **Done**.

If you already loaded an older build, click **Reload** on the extension card after updates (current version is in `manifest.json`, now **1.0.2**).

## What it saves

Files download into your Edge **Downloads** folder:

```
Downloads/wallapop-sb-export/
  listings.json
  listings.csv
  category-review.csv
  migration-report.json
  images/
```

No passwords, cookies, or tokens are written into these files.

Browser extensions cannot reliably produce a multi-file ZIP without third-party libraries, so files are downloaded individually into that folder.

## After export

From the project root:

```bash
npm run wallapop:ingest
npm run wallapop:import -- --dry-run
```

`wallapop:ingest` copies the Downloads export into `data/wallapop-export/` for the importer.

## Permissions

- `activeTab`, `scripting`, `downloads` — run on the open Wallapop tab and save files
- Host access:
  - `https://es.wallapop.com/*` — catalogue and listing pages
  - `https://*.wallapop.com/*` and `https://*.wallapop.net/*` — product image CDNs only

Content scripts run **only** on `es.wallapop.com`.

## Uninstall / cleanup

After a successful export (and after you no longer need re-exports):

1. Open `edge://extensions`
2. Find **Wallapop → Source Bridge Export (Temporary)**
3. Click **Remove**

This does **not** delete your exported files under Downloads or `data/wallapop-export/`.

Session data stays inside your browser profile and is never written into the Source Bridge project.

## Safety

- Wallapop is read-only (no edit / publish / archive / delete)
- Does not open private messages, payments, or buyer data
- Does not write to the Source Bridge database
- Does not bypass Google / CAPTCHA / browser security
