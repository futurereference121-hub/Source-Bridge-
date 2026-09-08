/**
 * Focused Source Bridge PWA regression checks (static / source-level).
 * No network money ops. Run: node scripts/test-pwa.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

// 1. Manifest identity
check("1 manifest identity", () => {
  const manifest = read("src/app/manifest.ts");
  const constants = read("src/lib/pwa/constants.ts");
  assert.match(constants, /PWA_NAME = "Source Bridge"/);
  assert.match(constants, /PWA_SHORT_NAME = "Source Bridge"/);
  assert.match(
    constants,
    /If you're somewhere, or you're going somewhere, you can help someone\./,
  );
  assert.match(constants, /PWA_START_URL = "\/"/);
  assert.match(constants, /PWA_SCOPE = "\/"/);
  assert.match(constants, /PWA_DISPLAY = "standalone"/);
  assert.match(constants, /#020B1C/);
  assert.match(constants, /www\.sourcebridge\.app/);
  assert.match(manifest, /orientation:\s*"any"/);
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-512\.png/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(manifest, /purpose:\s*"maskable"/);
});

// 2. Icons exist with expected sizes
check("2 icons present", () => {
  for (const f of [
    "public/icons/icon-192.png",
    "public/icons/icon-512.png",
    "public/icons/icon-maskable-512.png",
    "public/icons/apple-touch-icon.png",
  ]) {
    assert.ok(exists(f), `missing ${f}`);
    const buf = fs.readFileSync(path.join(root, f));
    assert.ok(buf.length > 500, `${f} too small`);
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50); // PNG
  }
});

// 3. Standalone display configured
check("3 standalone display", () => {
  assert.match(read("src/lib/pwa/constants.ts"), /standalone/);
  assert.match(read("src/app/manifest.ts"), /PWA_DISPLAY/);
});

// 4. Universal GET THE APP button
check("4 GET THE APP button component", () => {
  const btn = read("src/components/pwa/GetTheAppButton.tsx");
  assert.match(btn, /Get the App/);
  assert.match(btn, /usePwaInstall/);
  assert.doesNotMatch(btn, /Get it on Google Play|App Store|Download APK/i);
  const header = read("src/components/layout/SiteHeader.tsx");
  assert.match(header, /GetTheAppButton/);
  assert.ok(
    (header.match(/GetTheAppButton/g) || []).length >= 4,
    "button wired in mobile + desktop surfaces",
  );
  // Not a bottom-nav item
  assert.doesNotMatch(read("src/components/layout/MobileNav.tsx"), /GetTheApp|Get the App/);
});

// 5-7. beforeinstallprompt accept/dismiss + Apple sheet
check("5-7 install prompt + Apple sheet + dismiss session", () => {
  const hook = read("src/hooks/usePwaInstall.ts");
  assert.match(hook, /beforeinstallprompt/);
  assert.match(hook, /userChoice/);
  assert.match(hook, /sessionDismissed/);
  assert.match(hook, /prompt\(\)/);
  assert.match(hook, /appinstalled/);
  const sheet = read("src/components/pwa/IosInstallSheet.tsx");
  assert.match(sheet, /Add to Home Screen/);
  assert.match(sheet, /role="dialog"/);
  assert.match(sheet, /aria-modal/);
  assert.match(sheet, /Escape/);
  assert.match(sheet, /Share/);
});

// 8-9. Standalone detection + hide button
check("8-9 standalone detection hides install", () => {
  assert.match(read("src/lib/pwa/detect.ts"), /display-mode:\s*standalone/);
  assert.match(read("src/lib/pwa/detect.ts"), /standalone/);
  const btn = read("src/components/pwa/GetTheAppButton.tsx");
  assert.match(btn, /isStandalone/);
  assert.match(btn, /mode === "hidden"/);
  assert.match(btn, /return null/);
});

// 10. Unsupported fallback guidance
check("10 unsupported install guidance", () => {
  const btn = read("src/components/pwa/GetTheAppButton.tsx");
  assert.match(btn, /unavailable/);
  assert.match(btn, /Chrome or Edge|Safari/);
  assert.doesNotMatch(btn, /\.apk|\.ipa|\.exe/i);
});

// 11. SW registration
check("11 service worker registration", () => {
  const reg = read("src/components/pwa/PwaRegister.tsx");
  assert.match(reg, /serviceWorker\.register/);
  assert.match(reg, /PWA_SW_PATH|\/sw\.js/);
  assert.match(reg, /updateViaCache:\s*"none"/);
  assert.ok(exists("public/sw.js"));
});

// 12. Cache cleanup only sb-pwa-
check("12 cache versioning + cleanup scope", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /sb-pwa-v1/);
  assert.match(sw, /CACHE_PREFIX = "sb-pwa-"/);
  assert.match(sw, /key\.startsWith\(CACHE_PREFIX\)/);
  assert.doesNotMatch(sw, /caches\.keys\(\)[\s\S]*caches\.delete\(key\)(?![\s\S]*startsWith)/);
  assert.doesNotMatch(sw, /indexedDB\.deleteDatabase|document\.cookie/);
});

// 13. Never-cache sensitive routes
check("13 never-cache sensitive paths", () => {
  const sw = read("public/sw.js");
  for (const p of [
    "/api/",
    "/inbox",
    "/profile",
    "/checkout",
    "/live",
    "/admin",
    "/explore",
    "/search",
    "/uploads",
    "/sign-in",
  ]) {
    assert.match(sw, new RegExp(p.replace("/", "\\/")));
  }
  assert.match(sw, /method !== "GET"/);
  assert.match(sw, /Never touch cross-origin|!isSameOrigin/);
  // Must not cache-put on never-cache branch
  const neverFn = sw.slice(sw.indexOf("function isNeverCachePath"), sw.indexOf("function isImmutableNextStatic"));
  assert.ok(neverFn.includes("/api/"));
  // Financial / Live credentials not proxied
  assert.doesNotMatch(sw, /cloudflarestream|ably\.com|stripe\.com/i);
});

// 14. Offline branded fallback
check("14 offline fallback", () => {
  assert.ok(exists("public/offline.html"));
  const offline = read("public/offline.html");
  assert.match(offline, /#020B1C/);
  assert.match(offline, /Retry/i);
  assert.match(offline, /offline/i);
  assert.match(read("public/sw.js"), /offline\.html/);
});

// 15. Update without force loops / Live-safe
check("15 update without force-reload loops", () => {
  const sw = read("public/sw.js");
  const installBlock = sw.slice(
    sw.indexOf('self.addEventListener("install"'),
    sw.indexOf('self.addEventListener("activate"'),
  );
  assert.doesNotMatch(installBlock, /skipWaiting\s*\(/);
  assert.match(sw, /SB_PWA_SKIP_WAITING/);
  const reg = read("src/components/pwa/PwaRegister.tsx");
  assert.match(reg, /Update available/);
  assert.match(reg, /\/live/);
  assert.match(reg, /isUnsafeToReload/);
  assert.doesNotMatch(reg, /location\.reload\(\);\s*\n\s*location\.reload/);
});

// 16. Navigation preservation â€” no global link rewrite
check("16 navigation not rewritten", () => {
  const sw = read("public/sw.js");
  assert.doesNotMatch(sw, /clients\.openWindow|rewrite.*href|navigate\(.*app:\/\//i);
  // Bottom nav still present and unchanged in role
  const mobile = read("src/components/layout/MobileNav.tsx");
  assert.match(mobile, /mobileNavItems/);
  assert.match(mobile, /"\/search"/);
  assert.match(mobile, /"\/explore"/);
  assert.match(mobile, /"\/inbox"/);
  assert.match(mobile, /"\/profile"/);
  assert.match(mobile, /safe-area-inset-bottom/);
  const site = read("src/lib/site.ts");
  assert.match(site, /label:\s*"Home"/);
  assert.match(site, /label:\s*"Explore"/);
  assert.match(site, /label:\s*"Inbox"/);
  assert.match(site, /label:\s*"Profile"/);
});

// Extra: no payment source files in PWA surface
check("no payment engine imports in PWA modules", () => {
  for (const f of [
    "src/components/pwa/GetTheAppButton.tsx",
    "src/components/pwa/IosInstallSheet.tsx",
    "src/components/pwa/PwaRegister.tsx",
    "src/hooks/usePwaInstall.ts",
    "src/lib/pwa/constants.ts",
    "src/lib/pwa/detect.ts",
    "public/sw.js",
  ]) {
    const src = read(f);
    assert.doesNotMatch(src, /PaymentIntent|SOURCE_BRIDGE_FEE|ProtectedTransaction|stripe\.com/i);
  }
});

// Extra: no new PWA npm deps required
check("no outdated next-pwa / workbox package dependency", () => {
  const pkg = JSON.parse(read("package.json"));
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(all)) {
    assert.ok(!/next-pwa|workbox|@ducanh2912\/next-pwa/i.test(name), `unexpected dep ${name}`);
  }
});

console.log(`\npwa checks passed (${passed})`);