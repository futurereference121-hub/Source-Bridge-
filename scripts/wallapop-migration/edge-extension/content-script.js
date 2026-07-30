/**
 * Content script — runs only on https://es.wallapop.com/*
 * Read-only scrape of the signed-in user's published catalogue.
 */
(function () {
  const EXPORT_ROOT = "wallapop-sb-export";
  let running = false;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function progress(message, extra = {}) {
    chrome.runtime.sendMessage({
      type: "EXPORT_PROGRESS",
      message,
      ...extra,
    });
  }

  function slugifyId(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1] || "";
      const m = last.match(/(\d{6,})/);
      if (m) return m[1];
      return last.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || `item_${Date.now()}`;
    } catch {
      return `item_${Date.now()}`;
    }
  }

  function textOf(el) {
    return (el?.textContent || "").trim();
  }

  function metaOf(doc, sel) {
    return doc.querySelector(sel)?.getAttribute("content") || "";
  }

  function upgradeImageUrl(url) {
    if (!url) return url;
    try {
      let cleaned = String(url).replace(/[),;]+$/g, "");
      const u = new URL(cleaned);
      if (/cdn\.wallapop\.com/i.test(u.hostname)) {
        // Prefer highest common Wallapop CDN size.
        u.searchParams.set("pictureSize", "W800");
      }
      return u.toString().split("#")[0];
    } catch {
      return String(url).split("#")[0];
    }
  }

  function imageDedupeKey(url) {
    try {
      const u = new URL(url);
      // Wallapop identity is the path (.../i123456.jpg), not the size query.
      return u.pathname.replace(/\/$/, "");
    } catch {
      return String(url).split("?")[0];
    }
  }

  function pickBestImageUrl(urlsObjOrString) {
    if (!urlsObjOrString) return "";
    if (typeof urlsObjOrString === "string") return upgradeImageUrl(urlsObjOrString);
    const order = ["xlarge", "xxlarge", "large", "big", "huge", "medium", "small"];
    for (const key of order) {
      if (urlsObjOrString[key]) return upgradeImageUrl(urlsObjOrString[key]);
    }
    const vals = Object.values(urlsObjOrString).filter((v) => typeof v === "string");
    if (!vals.length) return "";
    // Prefer W800 / larger pictureSize when present.
    const ranked = vals
      .map((v) => ({ v, score: /W800|W1024|W1200/i.test(v) ? 3 : /W640/i.test(v) ? 2 : 1 }))
      .sort((a, b) => b.score - a.score);
    return upgradeImageUrl(ranked[0].v);
  }

  function extractImagesFromNextItem(item) {
    const out = [];
    const seen = new Set();
    const push = (raw) => {
      const url = pickBestImageUrl(raw);
      if (!url || !/cdn\.wallapop\.com/i.test(url)) return;
      if (/avatar|icon|logo|emoji|svg|sprite/i.test(url)) return;
      const key = imageDedupeKey(url);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(url);
    };

    if (Array.isArray(item?.images)) {
      for (const img of item.images) {
        if (!img) continue;
        if (img.urls) push(img.urls);
        else if (img.url) push(img.url);
        else if (typeof img === "string") push(img);
      }
    }
    if (item?.image?.urls) push(item.image.urls);
    if (item?.imageUrl) push(item.imageUrl);
    return out;
  }

  function extractImagesFromHtml(html) {
    const out = [];
    const seen = new Set();
    const re = /https:\/\/cdn\.wallapop\.com\/images\/[^"'\\\s<>]+/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      let raw = m[0].replace(/[),;]+$/g, "");
      // Skip seller avatars (path often contains /c13p or similar profile buckets — keep item images only).
      if (/\/c13p\d+\//i.test(raw) && !/\/c\d+p\d+\//i.test(raw.replace(/\/c13p\d+\//, "/"))) {
        /* keep checking */
      }
      // Prefer product image paths that include listing id markers when possible.
      if (/avatar|icon|logo/i.test(raw)) continue;
      const url = upgradeImageUrl(raw);
      const key = imageDedupeKey(url);
      if (seen.has(key)) continue;
      // Drop tiny-only if we later see W800 for same key — already upgraded to W800.
      seen.add(key);
      out.push(url);
    }
    // Filter out likely avatars: wallapop profile images often live under /images/13/
    return out.filter((u) => !/\/images\/13\//i.test(u));
  }

  function parseNextDataItem(html) {
    const m = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s,
    );
    if (!m) return null;
    try {
      const data = JSON.parse(m[1]);
      return data?.props?.pageProps?.item || null;
    } catch {
      return null;
    }
  }

  function pickLocalizedText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      return (
        value.original ||
        value.translated ||
        value.text ||
        value.value ||
        ""
      );
    }
    return String(value);
  }

  function itemFromNextData(item, listingUrl) {
    const taxonomy = Array.isArray(item.taxonomy) ? item.taxonomy : [];
    const category = pickLocalizedText(taxonomy[0]?.name || taxonomy[0]?.title);
    const subcategory = pickLocalizedText(
      taxonomy[taxonomy.length - 1]?.name || taxonomy[taxonomy.length - 1]?.title,
    );

    const priceRaw =
      item.price?.cash?.amount ??
      item.price?.amount ??
      (typeof item.price === "number" ? item.price : null) ??
      item.pricingInfo?.price ??
      null;
    const priceNum =
      typeof priceRaw === "number"
        ? priceRaw
        : parseFloat(String(priceRaw ?? "").replace(",", "."));

    const currency =
      item.price?.cash?.currency ||
      item.price?.currency ||
      item.currency ||
      item.pricingInfo?.currency ||
      "EUR";

    const location =
      item.location?.city ||
      [item.location?.city, item.location?.region].filter(Boolean).join(", ") ||
      "";

    const condition = pickLocalizedText(
      item.condition || item.conditionName || item.itemCondition || "",
    );

    const publishedAt = item.createdAt
      ? new Date(item.createdAt).toISOString()
      : "";
    const modifiedAt = item.modifiedAt
      ? new Date(item.modifiedAt).toISOString()
      : "";

    const title = pickLocalizedText(item.title).replace(/\s+/g, " ").trim();
    const description = pickLocalizedText(item.description).slice(0, 8000);

    return {
      wallapopId: String(item.id || slugifyId(listingUrl)),
      listingUrl,
      title,
      description,
      price: Number.isFinite(priceNum) ? priceNum : null,
      currency,
      category,
      subcategory,
      condition: String(condition),
      location,
      publishedAt,
      modifiedAt,
      imageUrls: extractImagesFromNextItem(item).slice(0, 12),
      exportedAt: new Date().toISOString(),
      parseSource: "next_data",
    };
  }

  function isCatalogPage() {
    return /\/app\/catalog\/published/i.test(location.pathname + location.search);
  }

  async function scrollCatalogFully() {
    let prev = 0;
    for (let i = 0; i < 50; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(800);
      const h = document.body.scrollHeight;
      if (h === prev) break;
      prev = h;
      progress(`Scrolling catalogue… (${i + 1})`);
    }
    window.scrollTo(0, 0);
  }

  function collectCatalogLinks() {
    const hrefs = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.href || "";
      if (/\/item\//i.test(href)) {
        try {
          const u = new URL(href);
          u.search = "";
          u.hash = "";
          if (/es\.wallapop\.com$/i.test(u.hostname)) {
            hrefs.add(u.toString());
          }
        } catch {
          /* skip */
        }
      }
    }
    return [...hrefs];
  }

  function parseListingDocument(doc, listingUrl, html) {
    const nextItem = html ? parseNextDataItem(html) : null;
    if (nextItem?.title) {
      const parsed = itemFromNextData(nextItem, listingUrl);
      if (!parsed.imageUrls.length && html) {
        parsed.imageUrls = extractImagesFromHtml(html).slice(0, 12);
        parsed.parseSource = "next_data+html_regex";
      }
      return parsed;
    }

    const title =
      textOf(doc.querySelector("h1")) ||
      metaOf(doc, 'meta[property="og:title"]') ||
      doc.title;

    let priceText =
      textOf(doc.querySelector('[itemprop="price"]')) ||
      textOf(doc.querySelector('[data-testid*="price" i]')) ||
      metaOf(doc, 'meta[property="product:price:amount"]');

    if (!priceText) {
      const body = doc.body?.innerText || "";
      const m = body.match(/(\d+[.,]?\d*)\s*€/);
      if (m) priceText = m[1];
    }

    const currency =
      metaOf(doc, 'meta[property="product:price:currency"]') ||
      ((doc.body?.innerText || "").includes("€") ? "EUR" : "EUR");

    const description =
      textOf(doc.querySelector('[itemprop="description"]')) ||
      textOf(doc.querySelector('[data-testid*="description" i]')) ||
      metaOf(doc, 'meta[property="og:description"]') ||
      "";

    const imgs = [];
    const seen = new Set();
    const pushImg = (src) => {
      if (!src) return;
      if (!/cdn\.wallapop\.com/i.test(src)) return;
      if (/avatar|icon|logo|emoji|svg|sprite|\/images\/13\//i.test(src)) return;
      const upgraded = upgradeImageUrl(src);
      const key = imageDedupeKey(upgraded);
      if (seen.has(key)) return;
      seen.add(key);
      imgs.push(upgraded);
    };

    const og = metaOf(doc, 'meta[property="og:image"]');
    pushImg(og);
    for (const img of doc.querySelectorAll("img")) {
      pushImg(img.currentSrc || img.src || img.getAttribute("data-src") || "");
    }
    for (const srcset of doc.querySelectorAll("[srcset]")) {
      const raw = srcset.getAttribute("srcset") || "";
      const first = raw.split(",")[0]?.trim().split(/\s+/)[0];
      pushImg(first);
    }
    if (html) {
      for (const u of extractImagesFromHtml(html)) pushImg(u);
    }

    const location =
      textOf(doc.querySelector('[data-testid*="location" i]')) ||
      textOf(doc.querySelector('[itemprop="address"]')) ||
      "";

    let category = "";
    let subcategory = "";
    const crumbs = [...doc.querySelectorAll("nav a, [class*='breadcrumb'] a")].map(
      (a) => textOf(a),
    );
    if (crumbs.length >= 2) {
      category = crumbs[crumbs.length - 2] || "";
      subcategory = crumbs[crumbs.length - 1] || "";
    }

    const bodyText = doc.body?.innerText || "";
    let condition = "";
    const condMatch = bodyText.match(
      /(Nuevo|Como nuevo|En buen estado|Aceptable|Lo ha dado todo|New|As good as new|Good|Fair|Has given it all)/i,
    );
    if (condMatch) condition = condMatch[1];

    let publishedAt = "";
    let modifiedAt = "";
    const timeEl = doc.querySelector("time[datetime]");
    if (timeEl) publishedAt = timeEl.getAttribute("datetime") || "";
    const modMeta = metaOf(doc, 'meta[property="og:updated_time"]');
    if (modMeta) modifiedAt = modMeta;

    const priceNum = parseFloat(
      String(priceText || "")
        .replace(/[^\d.,]/g, "")
        .replace(",", "."),
    );

    return {
      wallapopId: slugifyId(listingUrl),
      listingUrl,
      title: title.replace(/\s+/g, " ").trim(),
      description: description.slice(0, 8000),
      price: Number.isFinite(priceNum) ? priceNum : null,
      currency: currency || "EUR",
      category,
      subcategory,
      condition,
      location,
      publishedAt,
      modifiedAt,
      imageUrls: imgs.slice(0, 12),
      exportedAt: new Date().toISOString(),
      parseSource: "dom",
    };
  }

  async function fetchListing(listingUrl) {
    // Public SSR HTML contains __NEXT_DATA__ with the full gallery.
    // Fetching with session cookies often returns the logged-in SPA shell
    // (no images / wrong chrome titles like "Todas las categorías").
    const attempts = [
      { credentials: "omit", label: "public" },
      { credentials: "include", label: "session" },
    ];

    let lastErr = null;
    for (const attempt of attempts) {
      try {
        const res = await fetch(listingUrl, {
          credentials: attempt.credentials,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "es-ES,es;q=0.9",
          },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const parsed = parseListingDocument(doc, listingUrl, html);

        const looksLikeChromeOnly =
          !parsed.imageUrls.length ||
          /todas las categor/i.test(parsed.title || "") ||
          /wallapop$/i.test(parsed.title || "");

        if (!looksLikeChromeOnly && parsed.imageUrls.length) {
          parsed.parseSource = `${parsed.parseSource}:${attempt.label}`;
          return parsed;
        }

        // Keep best effort if this was the last attempt.
        if (attempt === attempts[attempts.length - 1]) {
          if (parsed.imageUrls.length) return parsed;
          // Last resort: regex images even if title looks wrong.
          const regexImgs = extractImagesFromHtml(html).slice(0, 12);
          if (regexImgs.length) {
            parsed.imageUrls = regexImgs;
            parsed.parseSource = `html_regex:${attempt.label}`;
            return parsed;
          }
          return parsed;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Failed to fetch listing");
  }

  function toCsv(rows) {
    const headers = [
      "wallapopId",
      "title",
      "price",
      "currency",
      "category",
      "subcategory",
      "condition",
      "location",
      "listingUrl",
      "imageCount",
      "sbCategory",
      "sbConfidence",
    ];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.wallapopId,
          r.title,
          r.price,
          r.currency,
          r.category,
          r.subcategory,
          r.condition,
          r.location,
          r.listingUrl,
          r.localImages?.length || 0,
          r.sbMapping?.category || r.sbMapping?.status || "",
          r.sbMapping?.confidence || "",
        ]
          .map(esc)
          .join(","),
      );
    }
    return lines.join("\n");
  }

  function categoryReviewCsv(rows) {
    const headers = [
      "wallapopId",
      "title",
      "wallapopCategory",
      "wallapopSubcategory",
      "proposedSbCategory",
      "proposedSbSubcategory",
      "productKind",
      "confidence",
      "status",
      "mappingReason",
    ];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.join(",")];
    for (const r of rows) {
      const m = r.sbMapping || {};
      lines.push(
        [
          r.wallapopId,
          r.title,
          r.category,
          r.subcategory,
          m.ok ? m.category : "",
          m.ok ? m.subcategory : "",
          m.ok ? m.productKind : "",
          m.confidence || "",
          m.ok ? "MAPPED" : "REVIEW_REQUIRED",
          m.reason || "",
        ]
          .map(esc)
          .join(","),
      );
    }
    return lines.join("\n");
  }

  async function downloadText(relativePath, text, mime) {
    const res = await chrome.runtime.sendMessage({
      type: "SAVE_TEXT",
      relativePath,
      text,
      mime,
    });
    if (!res?.ok) throw new Error(res?.error || "SAVE_TEXT failed");
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function fetchImageValidated(sourceUrl) {
    const res = await fetch(sourceUrl, {
      credentials: "omit",
      headers: {
        Accept: "image/*,*/*",
        Referer: "https://es.wallapop.com/",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 100) throw new Error(`File too small (${buf.length} bytes)`);
    const headerType = (res.headers.get("content-type") || "").split(";")[0].trim();
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng =
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isWebp =
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50;
    const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
    let contentType = null;
    if (isJpeg) contentType = "image/jpeg";
    else if (isPng) contentType = "image/png";
    else if (isWebp) contentType = "image/webp";
    else if (isGif) contentType = "image/gif";
    else if (headerType.startsWith("image/")) contentType = headerType;
    if (!contentType) throw new Error("Not a valid image (magic bytes)");
    return { buf, contentType, bytes: buf.length };
  }

  async function downloadImage(relativePath, sourceUrl) {
    let lastErr = "download failed";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { buf, contentType, bytes } = await fetchImageValidated(sourceUrl);
        const saved = await chrome.runtime.sendMessage({
          type: "SAVE_IMAGE_BYTES",
          relativePath,
          base64: bytesToBase64(buf),
          mime: contentType,
        });
        if (saved?.ok) {
          return { ok: true, bytes, contentType, downloadId: saved.downloadId };
        }
        lastErr = saved?.error || "SAVE_IMAGE_BYTES failed";
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
      // Fallback: let the service worker fetch + save.
      try {
        const saved = await chrome.runtime.sendMessage({
          type: "SAVE_IMAGE",
          relativePath,
          sourceUrl,
          retries: 1,
        });
        if (saved?.ok) return saved;
        lastErr = saved?.error || lastErr;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
      await sleep(400 * attempt);
    }
    return { ok: false, error: lastErr };
  }

  async function runExport() {
    if (running) {
      progress("Export already running…");
      return;
    }
    running = true;

    try {
      if (!isCatalogPage()) {
        progress(
          "Open https://es.wallapop.com/app/catalog/published first, then click Scan again.",
          { level: "warn" },
        );
        return;
      }

      progress("Scrolling to load all published listings…");
      await scrollCatalogFully();

      const links = collectCatalogLinks();
      progress(`Found ${links.length} listing URL(s). Scraping details…`, {
        listingsFound: links.length,
      });

      if (!links.length) {
        progress(
          "No listings found. Confirm you are signed in and viewing your published catalogue.",
          { level: "warn" },
        );
        return;
      }

      const products = [];
      const imageFailures = [];
      let imagesOk = 0;

      for (let i = 0; i < links.length; i++) {
        const url = links[i];
        progress(`[${i + 1}/${links.length}] Fetching listing…`, {
          current: i + 1,
          total: links.length,
        });

        let item;
        try {
          item = await fetchListing(url);
        } catch (err) {
          products.push({
            wallapopId: slugifyId(url),
            listingUrl: url,
            error: err instanceof Error ? err.message : String(err),
            exportedAt: new Date().toISOString(),
            localImages: [],
            imageUrls: [],
          });
          continue;
        }

        const mapFn = self.WallapopCategoryMap?.mapWallapopCategory;
        item.sbMapping = mapFn
          ? mapFn(item)
          : { ok: false, status: "REVIEW_REQUIRED", reason: "Mapper missing" };

        item.localImages = [];
        if (!item.imageUrls?.length) {
          imageFailures.push({
            wallapopId: item.wallapopId,
            sourceUrl: null,
            error: "No image URLs discovered on listing page",
          });
        }
        for (let j = 0; j < item.imageUrls.length; j++) {
          const sourceUrl = item.imageUrls[j];
          const extMatch = sourceUrl.match(/\.(jpe?g|png|webp|gif)/i);
          const ext = extMatch
            ? extMatch[1].toLowerCase().replace("jpeg", "jpg")
            : "jpg";
          const filename = `${item.wallapopId}_${j + 1}.${ext}`;
          const relativePath = `${EXPORT_ROOT}/images/${filename}`;
          progress(
            `[${i + 1}/${links.length}] Image ${j + 1}/${item.imageUrls.length}…`,
          );
          const saved = await downloadImage(relativePath, sourceUrl);
          if (saved?.ok) {
            imagesOk += 1;
            item.localImages.push({
              filename,
              localPath: `images/${filename}`,
              sourceUrl,
              bytes: saved.bytes || null,
              contentType: saved.contentType || null,
            });
          } else {
            imageFailures.push({
              wallapopId: item.wallapopId,
              sourceUrl,
              error: saved?.error || "download failed",
            });
          }
        }

        const missing = (item.imageUrls?.length || 0) - (item.localImages?.length || 0);
        progress(
          `[${i + 1}/${links.length}] ${item.title || item.wallapopId} — urls=${item.imageUrls?.length || 0} saved=${item.localImages.length}${missing ? ` missing=${missing}` : ""}`,
        );
        products.push(item);
        await sleep(200);
      }

      const okProducts = products.filter((p) => !p.error);
      const reviewRequired = okProducts.filter((p) => !p.sbMapping?.ok);

      const totalImageUrls = okProducts.reduce(
        (n, p) => n + (p.imageUrls?.length || 0),
        0,
      );
      const listingsMissingImages = okProducts.filter(
        (p) => !(p.localImages && p.localImages.length),
      ).length;

      const report = {
        exportedAt: new Date().toISOString(),
        source: "edge-extension",
        destinationAccountHint: "@theowlsaid",
        catalogUrl: location.href,
        productsFound: products.length,
        productsOk: okProducts.length,
        productsFailed: products.filter((p) => p.error).length,
        imageUrlsFound: totalImageUrls,
        imagesDownloaded: imagesOk,
        listingsMissingImages,
        imageFailures,
        categoryReviewRequired: reviewRequired.length,
        exportFolder: EXPORT_ROOT,
        note: "No passwords, cookies, or tokens are included. Wallapop was read-only.",
        packageLimitation:
          "Browser extensions cannot reliably create a multi-file ZIP without bundling third-party code; files are downloaded individually into Downloads/wallapop-sb-export/.",
      };

      progress("Writing listings.json…");
      await downloadText(
        `${EXPORT_ROOT}/listings.json`,
        JSON.stringify(products, null, 2),
        "application/json",
      );

      progress("Writing listings.csv…");
      await downloadText(
        `${EXPORT_ROOT}/listings.csv`,
        toCsv(okProducts),
        "text/csv",
      );

      progress("Writing category-review.csv…");
      await downloadText(
        `${EXPORT_ROOT}/category-review.csv`,
        categoryReviewCsv(okProducts),
        "text/csv",
      );

      progress("Writing migration-report.json…");
      await downloadText(
        `${EXPORT_ROOT}/migration-report.json`,
        JSON.stringify(report, null, 2),
        "application/json",
      );

      progress(
        `Done. ${okProducts.length} listings, ${imagesOk} images saved to Downloads/${EXPORT_ROOT}/.\nNext: npm run wallapop:ingest then npm run wallapop:import -- --dry-run`,
        {
          level: "ok",
          done: true,
          report,
        },
      );
    } catch (err) {
      progress(err instanceof Error ? err.message : String(err), { level: "err" });
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "START_EXPORT") {
      sendResponse({ ok: true, started: true });
      runExport();
      return false;
    }
    if (msg?.type === "PING") {
      sendResponse({
        ok: true,
        href: location.href,
        isCatalog: isCatalogPage(),
      });
      return false;
    }
    return false;
  });
})();
