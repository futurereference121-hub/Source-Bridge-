/**
 * Harmless Blob connectivity probe — upload then delete a tiny temp file.
 * Never prints secrets or blob URLs in a way that embeds tokens.
 */
import { put, del, head } from "@vercel/blob";
import { randomBytes } from "crypto";

const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
const storeId = process.env.BLOB_STORE_ID || undefined;

console.log(
  "BLOB_READ_WRITE_TOKEN:",
  token ? "present" : "missing",
);
console.log("BLOB_STORE_ID:", storeId ? "present" : "missing");
console.log(
  "VERCEL_OIDC_TOKEN:",
  process.env.VERCEL_OIDC_TOKEN ? "present" : "missing",
);

if (!token && !storeId) {
  console.error("ABORT: neither BLOB_READ_WRITE_TOKEN nor BLOB_STORE_ID available");
  process.exit(1);
}

const pathname = `stock/_migration-probe/${Date.now()}-${randomBytes(4).toString("hex")}.txt`;
const body = Buffer.from("source-bridge wallapop migration blob probe\n");

const uploaded = await put(pathname, body, {
  access: "public",
  contentType: "text/plain",
  addRandomSuffix: false,
  ...(token ? { token } : {}),
});

console.log("upload: ok");
console.log("pathname:", uploaded.pathname || pathname);

try {
  await head(uploaded.url, token ? { token } : undefined);
  console.log("head: ok");
} catch (err) {
  console.warn(
    "head: skipped/failed",
    err instanceof Error ? err.message : err,
  );
}

await del(uploaded.url, token ? { token } : undefined);
console.log("delete: ok");

try {
  await head(uploaded.url, token ? { token } : undefined);
  console.error("ORPHAN_CHECK: file still reachable after delete");
  process.exit(2);
} catch {
  console.log("orphan_check: deleted (not reachable)");
}

console.log("blob_connectivity: PASS");
