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

// 4. Universal GET THE APP button + placements
check("4 GET THE APP placements (home/explore/nav)", () => {
  const btn = read("src/components/pwa/GetTheAppButton.tsx");
  assert.match(btn, /GET THE APP/);
  assert.match(btn, /usePwaInstall/);
  assert.match(btn, /variant === "hero"/);
  assert.match(btn, /variant === "explore"/);
  assert.doesNotMatch(btn, /Get it on Google Play|App Store|Download APK/i);
  // Visibility must not require beforeinstallprompt
  assert.match(btn, /Do NOT hide for missing beforeinstallprompt/);
  assert.match(btn, /ready/);

  const hero = read("src/components/home/HeroActions.tsx");
  assert.match(hero, /GetTheAppButton/);
  assert.match(hero, /variant="hero"/);
  assert.match(hero, /Sign Up\/In|Join|Explore/);

  const exploreCue = read("src/components/explore/ExploreGetTheApp.tsx");
  assert.match(exploreCue, /GetTheAppButton/);
  assert.match(exploreCue, /variant="explore"/);
  const explore = read("src/app/explore/ExploreClient.tsx");
  assert.match(explore, /ExploreGetTheApp/);

  const header = read("src/components/layout/SiteHeader.tsx");
  assert.match(header, /GetTheAppButton/);
  assert.ok(
    (header.match(/GetTheAppButton/g) || []).length >= 4,
    "button wired in mobile + desktop surfaces",
  );
  // Signed-in desktop still shows CTA (not only account menu)
  assert.match(header, /signedIn[\s\S]*GetTheAppButton variant="desktop"/);

  const account = read("src/components/layout/AccountMenu.tsx");
  assert.match(account, /GetTheAppButton/);

  // Not a bottom-nav item
  assert.doesNotMatch(read("src/components/layout/MobileNav.tsx"), /GetTheApp|GET THE APP|Get the App/);
});

// 5-7. beforeinstallprompt accept/dismiss + Apple sheet + manual sheet
check("5-7 install prompt + Apple sheet + manual fallback + dismiss", () => {
  const hook = read("src/hooks/usePwaInstall.ts");
  assert.match(hook, /beforeinstallprompt/);
  assert.match(hook, /userChoice/);
  assert.match(hook, /sessionDismissed/);
  assert.match(hook, /prompt\(\)/);
  assert.match(hook, /appinstalled/);
  assert.match(hook, /listenersBound/);
  assert.match(hook, /setManualSheetOpenGlobal\(true\)/);
  assert.match(hook, /setIosSheetOpenGlobal\(true\)/);
  // Dismiss must not hide CTA
  assert.match(hook, /Keep CTA visible/);
  const sheet = read("src/components/pwa/IosInstallSheet.tsx");
  assert.match(sheet, /Add to Home Screen/);
  assert.match(sheet, /role="dialog"/);
  assert.match(sheet, /aria-modal/);
  assert.match(sheet, /Escape/);
  assert.match(sheet, /Share/);
  const manual = read("src/components/pwa/ManualInstallSheet.tsx");
  assert.match(manual, /Install app|Add to Home screen/);
  assert.match(manual, /role="dialog"/);
  assert.match(manual, /Chrome/);
  const host = read("src/components/pwa/PwaInstallHost.tsx");
  assert.match(host, /IosInstallSheet/);
  assert.match(host, /ManualInstallSheet/);
  assert.match(read("src/components/layout/SiteShell.tsx"), /PwaInstallHost/);
  // Buttons must not each mount duplicate sheets
  assert.doesNotMatch(read("src/components/pwa/GetTheAppButton.tsx"), /IosInstallSheet|ManualInstallSheet/);
});

// 8-9. Standalone detection + hide button (genuine only)
check("8-9 standalone detection hides install", () => {
  const detect = read("src/lib/pwa/detect.ts");
  assert.match(detect, /display-mode:\s*standalone/);
  assert.match(detect, /standalone/);
  assert.match(detect, /nav\.standalone/);
  const btn = read("src/components/pwa/GetTheAppButton.tsx");
  assert.match(btn, /isStandalone/);
  assert.match(btn, /mode === "hidden"/);
  assert.match(btn, /return null/);
  const hook = read("src/hooks/usePwaInstall.ts");
  assert.match(hook, /isStandaloneDisplay/);
  // Must not hide solely because prompt missing
  assert.doesNotMatch(
    hook,
    /if\s*\(\s*!deferredPromptGlobal\s*\)\s*\{\s*setMode\("hidden"\)/,
  );
});

// 10. Unsupported / manual guidance (no silent fail)
check("10 manual install guidance without native event", () => {
  const hook = read("src/hooks/usePwaInstall.ts");
  assert.match(hook, /never silent-fail|setManualSheetOpenGlobal\(true\)/);
  assert.match(hook, /return "guided"/);
  const btn = read("src/components/pwa/GetTheAppButton.tsx");
  assert.match(btn, /unavailable/);
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
  assert.doesNotMatch(sw, /indexedDB\.deleteDatabase|document\.cookie/);
});

// 13. Never-cache sensitive routes (no expansion)
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
  const neverFn = sw.slice(
    sw.indexOf("function isNeverCachePath"),
    sw.indexOf("function isImmutableNextStatic"),
  );
  assert.ok(neverFn.includes("/api/"));
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
});

// 16. Navigation preservation — no global link rewrite + bottom nav unchanged
check("16 navigation not rewritten", () => {
  const sw = read("public/sw.js");
  assert.doesNotMatch(sw, /clients\.openWindow|rewrite.*href|navigate\(.*app:\/\//i);
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

// 17. Shared install state — single BIP listener, coordinated sheets
check("17 shared install state across placements", () => {
  const hook = read("src/hooks/usePwaInstall.ts");
  assert.match(hook, /let listenersBound = false/);
  assert.match(hook, /bindBeforeInstallPromptOnce/);
  assert.match(hook, /sheetListeners/);
  assert.match(hook, /iosSheetOpenGlobal/);
  assert.match(hook, /manualSheetOpenGlobal/);
  assert.match(hook, /sb-pwa-installable/);
  assert.match(hook, /sb-pwa-installed/);
});

// Extra: no payment source files in PWA surface
check("no payment engine imports in PWA modules", () => {
  for (const f of [
    "src/components/pwa/GetTheAppButton.tsx",
    "src/components/pwa/IosInstallSheet.tsx",
    "src/components/pwa/ManualInstallSheet.tsx",
    "src/components/pwa/PwaInstallHost.tsx",
    "src/components/pwa/PwaRegister.tsx",
    "src/components/explore/ExploreGetTheApp.tsx",
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

// Extra: SW body unchanged scope (precache still icons + offline only)
check("SW precache not expanded beyond safe static", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /const OFFLINE_URL = "\/offline\.html"/);
  const precache = sw.slice(
    sw.indexOf("PRECACHE_URLS"),
    sw.indexOf('self.addEventListener("install"'),
  );
  assert.match(precache, /OFFLINE_URL/);
  assert.match(precache, /icon-192/);
  assert.doesNotMatch(precache, /\/api\/|\/inbox|\/checkout|\/live/);
});

console.log(`\npwa checks passed (${passed})`);
