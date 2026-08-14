/**
 * beforeShellExecution: block accidental Live Stripe / live-key usage.
 * Fail-open on parse errors. Does not deploy or mutate production.
 */
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
  process.stdout.write(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

const command = String(payload.command || payload.cmd || "");

const liveKey = /sk_live_|rk_live_|whsec_live_/i.test(command);
const liveFlag =
  /LIVE_PAYMENTS_ENABLED\s*=\s*(true|1|yes|on)/i.test(command);
const moneyCreate =
  /paymentIntents\.create|charges\.create|transfers\.create|refunds\.create|payouts\.create/i.test(
    command,
  ) && /stripe/i.test(command);

if (liveKey || (liveFlag && /vercel|env/i.test(command))) {
  process.stdout.write(
    JSON.stringify({
      permission: "deny",
      user_message:
        "Blocked: command looks like Live Stripe keys or LIVE_PAYMENTS_ENABLED enablement. Live activation must be an explicit dedicated task.",
      agent_message:
        "Source Bridge pre-Live hook denied a Live-payments/Live-key shell command.",
    }),
  );
  process.exit(0);
}

if (moneyCreate) {
  process.stdout.write(
    JSON.stringify({
      permission: "ask",
      user_message:
        "This shell command may create a Stripe PaymentIntent/Charge/Transfer/Refund. Ordinary ticket/UI work must not do that unless the task explicitly requires TEST financial verification.",
      agent_message:
        "Stripe money-object create detected. Confirm the task explicitly requires TEST financial ops before continuing.",
    }),
  );
  process.exit(0);
}

process.stdout.write(JSON.stringify({ permission: "allow" }));
