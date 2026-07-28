/**
 * Messaging validation smoke tests (no network, no DB).
 * Run: node scripts/test-messaging-validation.mjs
 */
import { z } from "zod";

const MESSAGE_BODY_MAX = 4000;

const sourcingRequestSchema = z
  .object({
    toUserId: z.string().trim().min(1, "toUserId required"),
    message: z
      .string()
      .trim()
      .min(1, "Message required")
      .max(MESSAGE_BODY_MAX),
    neededFrom: z.string().trim().max(200).optional().default(""),
    budget: z.string().trim().max(80).optional().default(""),
    deadline: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
      .optional()
      .or(z.literal(""))
      .default(""),
    referenceImages: z.array(z.string().trim().min(1)).max(3).optional().default([]),
    clientRequestId: z.string().trim().min(8).max(80).optional(),
  })
  .refine(
    (v) => {
      if (!v.deadline) return true;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const d = new Date(`${v.deadline}T00:00:00`);
      return !Number.isNaN(d.getTime()) && d.getTime() >= today.getTime();
    },
    { message: "Deadline cannot be in the past", path: ["deadline"] },
  );

const sendMessageSchema = z
  .object({
    text: z.string().trim().max(MESSAGE_BODY_MAX).optional().default(""),
    attachmentUrls: z.array(z.string().trim().min(1)).max(3).optional().default([]),
    clientMessageId: z.string().trim().min(8).max(80).optional(),
  })
  .refine((v) => Boolean(v.text?.trim()) || (v.attachmentUrls?.length ?? 0) > 0, {
    message: "Message or image required",
  });

let failed = 0;
function assert(name, cond) {
  if (!cond) {
    console.error(`FAIL ${name}`);
    failed += 1;
  } else {
    console.log(`OK   ${name}`);
  }
}

assert(
  "rejects empty sourcing message",
  !sourcingRequestSchema.safeParse({ toUserId: "u1", message: "  " }).success,
);
assert(
  "accepts structured sourcing request",
  sourcingRequestSchema.safeParse({
    toUserId: "u1",
    message: "Need a vintage camera",
    neededFrom: "Tokyo",
    budget: "$300",
    deadline: "2099-09-15",
    clientRequestId: "sr_abc12345",
  }).success,
);
assert(
  "rejects past deadline",
  !sourcingRequestSchema.safeParse({
    toUserId: "u1",
    message: "Need help",
    deadline: "2020-01-01",
  }).success,
);
assert(
  "rejects empty reply",
  !sendMessageSchema.safeParse({ text: "" }).success,
);
assert(
  "accepts image-only reply",
  sendMessageSchema.safeParse({
    text: "",
    attachmentUrls: ["https://example.blob.vercel-storage.com/x.jpg"],
    clientMessageId: "msg_abc12345",
  }).success,
);
assert(
  "rejects >3 attachments",
  !sendMessageSchema.safeParse({
    text: "hi",
    attachmentUrls: ["a", "b", "c", "d"],
  }).success,
);

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll messaging validation tests passed");
