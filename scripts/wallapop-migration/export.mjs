/**
 * Wallapop export entrypoint.
 *
 * Playwright login is disabled (Google blocks automated browsers).
 * Use the temporary Edge extension in your normal signed-in Edge session.
 *
 *   npm run wallapop:export   → prints install steps
 *   (scan in Edge)            → Downloads/wallapop-sb-export/
 *   npm run wallapop:ingest
 *   npm run wallapop:import -- --dry-run
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(__dirname, "edge-extension");

console.log(`
=== Wallapop export (Edge extension) ===

Do not use Playwright for Wallapop login.
Google blocks sign-in in automated browsers ("This browser or app may not be secure").

Use the temporary local Microsoft Edge extension inside your normal Edge session:

  1. Open Microsoft Edge
  2. Enter:  edge://extensions
  3. Turn on Developer mode
  4. Click Load unpacked
  5. Select this folder:
     ${EXT}
  6. Open: https://es.wallapop.com/app/catalog/published
  7. Click the extension icon
  8. Click "Scan My Published Listings"
  9. Keep the popup open until it says Done
 10. Then run:
     npm run wallapop:ingest
     npm run wallapop:import -- --dry-run

Uninstall later from edge://extensions (does not delete exported files).
Details: ${path.join(EXT, "README.md")}
`);
