/**
 * Validate Wallapop extension export before ingest.
 */
import { readFile, access, readdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

const SRC =
  process.env.WALLAPOP_EXPORT_DIR ||
  path.join(process.env.USERPROFILE || "", "Downloads", "wallapop-sb-export");

function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "png";
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
  return null;
}

async function main() {
  const report = {
    source: SRC,
    pass: true,
    listingsExported: 0,
    totalImages: 0,
    averageImagesPerListing: 0,
    listingsWithMissingImages: [],
    duplicateListings: [],
    malformedRecords: [],
    parsingErrors: [],
    csvValid: false,
    jsonValid: false,
    missingImageFiles: [],
    orphanImageFiles: [],
    invalidImageFiles: [],
  };

  if (!existsSync(path.join(SRC, "listings.json"))) {
    report.pass = false;
    report.parsingErrors.push("listings.json not found");
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  let products;
  try {
    const raw = await readFile(path.join(SRC, "listings.json"), "utf8");
    products = JSON.parse(raw);
    if (!Array.isArray(products)) throw new Error("listings.json root is not an array");
    report.jsonValid = true;
  } catch (err) {
    report.pass = false;
    report.parsingErrors.push(`listings.json: ${err.message}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  try {
    const csv = await readFile(path.join(SRC, "listings.csv"), "utf8");
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error("CSV has no data rows");
    const header = lines[0];
    if (!/wallapopId/i.test(header) || !/title/i.test(header)) {
      throw new Error("CSV missing expected headers");
    }
    // Rough CSV row count (quoted fields may contain commas; compare to product count loosely)
    if (lines.length - 1 !== products.length) {
      report.parsingErrors.push(
        `CSV row count ${lines.length - 1} != JSON products ${products.length} (may be OK if fields contain newlines)`,
      );
    }
    report.csvValid = true;
  } catch (err) {
    report.pass = false;
    report.parsingErrors.push(`listings.csv: ${err.message}`);
  }

  report.listingsExported = products.length;
  const idCounts = new Map();
  const referencedFiles = new Set();

  for (const p of products) {
    const id = p.wallapopId;
    if (!id) {
      report.malformedRecords.push({ reason: "missing wallapopId", title: p.title });
      report.pass = false;
      continue;
    }
    idCounts.set(id, (idCounts.get(id) || 0) + 1);

    const issues = [];
    if (!p.title || !String(p.title).trim()) issues.push("missing title");
    if (!p.description || !String(p.description).trim()) issues.push("missing description");
    if (p.price == null || Number.isNaN(Number(p.price))) issues.push("missing/invalid price");
    if (!p.category || !String(p.category).trim()) issues.push("missing category");
    if (p.error) issues.push(`export error: ${p.error}`);

    const locals = Array.isArray(p.localImages) ? p.localImages : [];
    if (!locals.length) {
      report.listingsWithMissingImages.push(id);
      issues.push("no localImages");
      report.pass = false;
    }

    for (const img of locals) {
      const rel = img.localPath || (img.filename ? `images/${img.filename}` : null);
      if (!rel) {
        issues.push("image entry missing path/filename");
        report.pass = false;
        continue;
      }
      referencedFiles.add(path.normalize(rel).replace(/\\/g, "/"));
      const abs = path.join(SRC, rel);
      try {
        await access(abs);
        const buf = await readFile(abs);
        report.totalImages += 1;
        if (!sniffImage(buf) || buf.length < 100) {
          report.invalidImageFiles.push(rel);
          report.pass = false;
        }
      } catch {
        report.missingImageFiles.push({ wallapopId: id, path: rel });
        report.pass = false;
      }
    }

    if (issues.length) {
      report.malformedRecords.push({ wallapopId: id, title: p.title, issues });
      // missing category alone: still count as malformed but may still ingest with REVIEW
      if (issues.some((i) => i !== "missing category")) report.pass = false;
    }
  }

  for (const [id, n] of idCounts) {
    if (n > 1) {
      report.duplicateListings.push({ wallapopId: id, count: n });
      report.pass = false;
    }
  }

  // Orphan files on disk not referenced
  const imagesDir = path.join(SRC, "images");
  if (existsSync(imagesDir)) {
    const files = await readdir(imagesDir);
    for (const f of files) {
      const rel = `images/${f}`;
      if (![...referencedFiles].some((r) => r.endsWith(f) || r === rel)) {
        report.orphanImageFiles.push(rel);
      }
    }
  }

  report.averageImagesPerListing = report.listingsExported
    ? Number((report.totalImages / report.listingsExported).toFixed(2))
    : 0;

  // Soft warnings: missing Wallapop category text should not hard-fail if images+core fields OK
  // Recompute pass more carefully:
  report.pass = true;
  if (!report.jsonValid || !report.csvValid) report.pass = false;
  if (report.duplicateListings.length) report.pass = false;
  if (report.missingImageFiles.length) report.pass = false;
  if (report.invalidImageFiles.length) report.pass = false;
  if (report.listingsWithMissingImages.length) report.pass = false;
  if (report.parsingErrors.some((e) => /not found|not an array|JSON/i.test(e)))
    report.pass = false;

  const hardMalformed = report.malformedRecords.filter((m) =>
    (m.issues || []).some((i) =>
      /missing title|missing description|missing\/invalid price|missing wallapopId|no localImages|export error/i.test(
        i,
      ),
    ),
  );
  if (hardMalformed.length) report.pass = false;

  // Category-only issues are warnings
  report.categoryWarnings = report.malformedRecords.filter((m) =>
    (m.issues || []).every((i) => i === "missing category"),
  );

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
