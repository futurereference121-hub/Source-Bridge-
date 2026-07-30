/**
 * Service worker — downloads export files into Downloads/wallapop-sb-export/
 * Never stores passwords, cookies, or tokens.
 *
 * MV3 service workers do not support URL.createObjectURL / revokeObjectURL.
 * Downloads use data: URLs built from bytes instead.
 */

const downloadIds = new Map();

function sniffImage(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return null;
}

/** Convert bytes to base64 without spreading huge arrays onto the call stack. */
function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToDataUrl(bytes, mime) {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

async function saveBytes(relativePath, bytes, mime) {
  const url = bytesToDataUrl(bytes, mime || "application/octet-stream");
  const id = await chrome.downloads.download({
    url,
    filename: relativePath.replace(/^[/\\]+/, ""),
    conflictAction: "overwrite",
    saveAs: false,
  });
  downloadIds.set(id, relativePath);
  return { ok: true, downloadId: id };
}

async function saveText(relativePath, text, mime) {
  const type = mime || "text/plain;charset=utf-8";
  const bytes = new TextEncoder().encode(text);
  return saveBytes(relativePath, bytes, type);
}

async function saveImageBytes(relativePath, base64, mime) {
  try {
    const buf = base64ToBytes(base64);
    if (buf.length < 100) {
      return { ok: false, error: `File too small (${buf.length} bytes)` };
    }
    const sniffed = sniffImage(buf);
    const contentType = sniffed || (mime && String(mime).startsWith("image/") ? mime : null);
    if (!contentType) {
      return { ok: false, error: "Not a valid image (magic bytes / content-type)" };
    }
    const saved = await saveBytes(relativePath, buf, contentType);
    if (!saved.ok) return saved;
    return {
      ok: true,
      bytes: buf.length,
      contentType,
      downloadId: saved.downloadId,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function saveImage(relativePath, sourceUrl, retries = 3) {
  let lastErr = "download failed";
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(sourceUrl, {
        credentials: "omit",
        headers: {
          Accept: "image/*,*/*",
          Referer: "https://es.wallapop.com/",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length < 100) {
          lastErr = `File too small (${buf.length} bytes)`;
        } else {
          const sniffed = sniffImage(buf);
          const headerType = (res.headers.get("content-type") || "")
            .split(";")[0]
            .trim();
          const contentType =
            sniffed || (headerType.startsWith("image/") ? headerType : null);
          if (!contentType) {
            lastErr = "Not a valid image (magic bytes / content-type)";
          } else {
            const saved = await saveBytes(relativePath, buf, contentType);
            if (saved.ok) {
              return {
                ok: true,
                bytes: buf.length,
                contentType,
                downloadId: saved.downloadId,
              };
            }
            lastErr = "saveBytes failed";
          }
        }
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 350 * attempt));
  }
  return { ok: false, error: lastErr };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SAVE_TEXT") {
    saveText(msg.relativePath, msg.text, msg.mime)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (msg?.type === "SAVE_IMAGE_BYTES") {
    saveImageBytes(msg.relativePath, msg.base64, msg.mime)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (msg?.type === "SAVE_IMAGE") {
    saveImage(msg.relativePath, msg.sourceUrl, msg.retries || 3)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  return false;
});
