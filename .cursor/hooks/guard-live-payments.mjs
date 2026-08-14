/**
 * afterFileEdit: remind the agent if a Live-payments enablement looks accidental.
 * Fail-open. Never mutates files. No secrets.
 */
import fs from "node:fs";

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

const raw = await readStdin();
let payload = {};
try {
  payload = raw ? JSON.parse(raw) : {};
} catch {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const filePath = String(
  payload.file_path || payload.filePath || payload.path || "",
);
const relevant =
  /flags\.ts$|\.env|PROTECTED_PAYMENTS|live-activation|vercel/i.test(filePath);

if (!relevant) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

let text = "";
try {
  if (filePath && fs.existsSync(filePath)) {
    text = fs.readFileSync(filePath, "utf8");
  }
} catch {
  text = "";
}

const enablesLive =
  /LIVE_PAYMENTS_ENABLED["'\s:=]+true/i.test(text) ||
  /LIVE_PAYMENTS_ENABLED["'\s:=]+1\b/i.test(text);

if (enablesLive) {
  process.stdout.write(
    JSON.stringify({
      additional_context:
        "LIVE_PAYMENTS_ENABLED appears enabled in this edit. Pre-Live policy: Live enablement must be its own dedicated task. Ordinary UI/ticket/test/deploy work must keep LIVE_PAYMENTS_ENABLED=false and Stripe TEST. Do not treat this as complete without an explicit Live-activation request.",
    }),
  );
  process.exit(0);
}

process.stdout.write(JSON.stringify({}));
