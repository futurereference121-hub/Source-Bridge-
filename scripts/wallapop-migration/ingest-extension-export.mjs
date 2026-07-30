/**
 * Copy the Edge-extension export from Downloads into data/wallapop-export/
 * so npm run wallapop:import can read it.
 *
 * Looks for:
 *   %USERPROFILE%\Downloads\wallapop-sb-export\
 */
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DEST = path.join(ROOT, "data", "wallapop-export");
const FOLDER_NAME = "wallapop-sb-export";

function candidateSources() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const list = [];
  if (home) {
    list.push(path.join(home, "Downloads", FOLDER_NAME));
    list.push(path.join(home, "OneDrive", "Downloads", FOLDER_NAME));
  }
  // Optional override
  if (process.env.WALLAPOP_EXPORT_DIR) {
    list.unshift(process.env.WALLAPOP_EXPORT_DIR);
  }
  return list;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await copyFile(from, to);
    }
  }
}

async function main() {
  const sources = candidateSources();
  let src = null;
  for (const c of sources) {
    if (await exists(path.join(c, "listings.json"))) {
      src = c;
      break;
    }
  }

  if (!src) {
    console.error("Could not find extension export.");
    console.error("Expected listings.json under one of:");
    for (const c of sources) console.error(`  ${c}`);
    console.error("\nAfter scanning in Edge, files appear in Downloads/wallapop-sb-export/");
    process.exit(1);
  }

  console.log(`\n=== Ingest Edge extension export ===`);
  console.log(`Source: ${src}`);
  console.log(`Dest:   ${DEST}\n`);

  if (await exists(DEST)) {
    await rm(DEST, { recursive: true, force: true });
  }
  await copyDir(src, DEST);

  const listingsPath = path.join(DEST, "listings.json");
  const raw = JSON.parse(await readFile(listingsPath, "utf8"));
  const products = Array.isArray(raw) ? raw : [];

  // Ensure localPath is relative for the importer.
  for (const p of products) {
    if (!Array.isArray(p.localImages)) continue;
    for (const img of p.localImages) {
      if (!img.localPath && img.filename) {
        img.localPath = `images/${img.filename}`;
      }
    }
  }
  await writeFile(listingsPath, JSON.stringify(products, null, 2), "utf8");

  const imagesDir = path.join(DEST, "images");
  let imageCount = 0;
  if (await exists(imagesDir)) {
    imageCount = (await readdir(imagesDir)).filter((f) => !f.startsWith(".")).length;
  }

  let report = null;
  const reportPath = path.join(DEST, "migration-report.json");
  if (await exists(reportPath)) {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  }

  const st = await stat(listingsPath);
  console.log("Ingest complete.");
  console.log(`  listings.json: ${products.length} product rows (${st.size} bytes)`);
  console.log(`  images/: ${imageCount} file(s)`);
  if (report) {
    console.log(`  migration-report: productsOk=${report.productsOk}, imagesDownloaded=${report.imagesDownloaded}`);
  }
  console.log("\nNext: npm run wallapop:import -- --dry-run\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
