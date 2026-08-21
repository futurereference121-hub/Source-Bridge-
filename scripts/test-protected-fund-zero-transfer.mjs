/**
 * Step 12 audit — Protected listing purchase: seller transfer at funding MUST be ZERO.
 * Source-level / no live money objects.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkout = fs.readFileSync(
  path.join(root, "src/lib/payments/checkout.ts"),
  "utf8",
);

assert.match(
  checkout,
  /KEEP_ALL_PROTECTED/,
  "Protected PI must keep funds on platform",
);
assert.match(
  checkout,
  /transferOnFund:\s*false/,
  "Protected fund path must not transfer to seller",
);
assert.doesNotMatch(
  checkout,
  /releaseStrategy:\s*"KEEP_ALL_PROTECTED"[\s\S]{0,200}transfer_data:/,
  "Protected create path must not set transfer_data",
);

// Direct path may use transfer_data — ensure Protected block has no transfer_data
const protectedCreate = checkout.match(
  /: await stripe\.paymentIntents\.create\(\s*\{([\s\S]*?)\},\s*\{\s*idempotencyKey/,
);
assert.ok(protectedCreate, "find Protected PI create block");
assert.doesNotMatch(
  protectedCreate[1],
  /transfer_data\s*:/,
  "Protected PaymentIntent create must omit transfer_data (seller transfer at funding = 0)",
);

console.log("test-protected-fund-zero-transfer: PASS (seller transfer at funding = 0)");
