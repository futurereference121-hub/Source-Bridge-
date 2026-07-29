import { z } from "zod";
import {
  MESSAGE_BODY_MAX,
  PUBLIC_DISPLAY_MESSAGE_MAX,
  STATUS_TEXT_MAX,
} from "@/lib/limits";
import { validatePasswordStrength } from "@/lib/password-strength";

const MESSAGE_IMAGES_MAX = 3;

export const USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9_]{1,28}[a-z0-9])?$/i;

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  const u = normalizeUsername(raw);
  if (u.length < 3 || u.length > 30) return false;
  return USERNAME_REGEX.test(u);
}

export function slugFromUsername(username: string): string {
  return normalizeUsername(username);
}

export const usernameSchema = z
  .string()
  .trim()
  .transform(normalizeUsername)
  .refine((u) => u.length >= 3 && u.length <= 30, "Username must be 3–30 characters")
  .refine(isValidUsername, "Use letters, numbers, underscores; URL-safe");

const passwordFieldSchema = z.string().superRefine((value, ctx) => {
  const error = validatePasswordStrength(value);
  if (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }
});

export const signupSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    email: z.string().trim().email("Valid email required").max(200),
    username: usernameSchema,
    password: passwordFieldSchema,
    confirmPassword: z.string(),
    intent: z.enum(["buyer", "provider", "both"]).default("both"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const signInSchema = z
  .object({
    identifier: z.string().trim().max(200).optional(),
    email: z.string().trim().max(200).optional(),
    username: z.string().trim().max(200).optional(),
    password: z.string().min(1, "Password required"),
  })
  .refine((data) => Boolean((data.identifier || data.email || data.username || "").trim()), {
    message: "Email or username required",
    path: ["identifier"],
  })
  .transform((data) => ({
    identifier: (data.identifier || data.email || data.username || "").trim(),
    password: data.password,
  }));

export const changeEmailSchema = z.object({
  email: z.string().trim().email("Valid email required").max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().optional().default(""),
    password: passwordFieldSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const setPasswordSchema = z
  .object({
    token: z.string().trim().min(1, "Missing token"),
    password: passwordFieldSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const requestSetPasswordSchema = z.object({
  email: z.string().trim().email("Valid email required").max(200),
});

export const deleteAccountSchema = z.object({
  password: z.string().optional().default(""),
  confirmText: z
    .string()
    .refine((v) => v === "DELETE", 'Type "DELETE" to confirm'),
});

export const publicDisplayMessageSchema = z
  .string()
  .max(PUBLIC_DISPLAY_MESSAGE_MAX, `Max ${PUBLIC_DISPLAY_MESSAGE_MAX} characters`);

export const statusSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Status text required")
    .max(STATUS_TEXT_MAX, `Max ${STATUS_TEXT_MAX} characters`),
});

export const opportunitySchema = z.object({
  /** Optional — auto-generated from description/location when omitted. */
  title: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().min(1, "Description required").max(2000),
  city: z.string().trim().min(1, "City required").max(80),
  country: z.string().trim().min(1, "Country required").max(80),
  /** Optional — defaults to General when omitted. */
  category: z.string().trim().max(80).optional().default(""),
  startsAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const networkLocationSchema = z.object({
  city: z.string().trim().min(1).max(80),
  country: z.string().trim().min(1).max(80),
});

export const tripSchema = z.object({
  city: z.string().trim().min(1).max(80),
  country: z.string().trim().min(1).max(80),
  arrival: z.string().trim().min(1, "Arrival date required"),
  departure: z.string().trim().min(1, "Departure date required"),
});

export const stockSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(120),
  description: z.string().trim().min(1, "Description required").max(4000),
  productKind: z.enum(["clothing", "general"]).default("clothing"),
  category: z.string().trim().min(1, "Category required").max(80),
  subcategory: z.string().trim().max(80).optional().default(""),
  quantity: z.string().trim().max(40).optional().default(""),
  sizes: z.array(z.string().trim().min(1).max(40)).max(12).optional().default([]),
  material: z.string().trim().max(80).optional().default(""),
  brand: z.string().trim().max(80).optional().default(""),
  condition: z.string().trim().max(80).optional().default(""),
  colour: z.string().trim().max(80).optional().default(""),
  pattern: z.string().trim().max(80).optional().default(""),
  fit: z.string().trim().max(80).optional().default(""),
  gender: z.string().trim().max(40).optional().default(""),
  availability: z
    .enum(["available", "limited", "made_to_order", "to_source"])
    .default("available"),
  saleStatus: z
    .enum(["AVAILABLE", "RESERVED", "SOLD", "ARCHIVED"])
    .optional()
    .default("AVAILABLE"),
  location: z.string().trim().max(120).optional().default(""),
  shipFromCity: z.string().trim().min(1, "Shipped from city required").max(80),
  shipFromCountry: z
    .string()
    .trim()
    .min(1, "Shipped from country required")
    .max(80),
  shippingAvailable: z.boolean().default(false),
  price: z.number().nonnegative("Price required"),
  currency: z.string().trim().max(8).optional().default("USD"),
  images: z.array(z.string().trim().min(1)).min(1, "Add at least one image").max(6),
});

export const saleStatusSchema = z.enum([
  "AVAILABLE",
  "RESERVED",
  "SOLD",
  "ARCHIVED",
]);

export const checkoutPaymentMethodSchema = z.enum(["card", "crypto", "contact"]);

export const createCheckoutSchema = z.object({
  listingId: z.string().trim().min(1, "listingId required"),
  paymentMethod: checkoutPaymentMethodSchema,
  selectedSize: z.string().trim().max(40).optional(),
  paymentMethodId: z.string().trim().min(1).optional(),
  cryptoTransactionHash: z.string().trim().max(200).optional(),
});

export const patchCheckoutSchema = z.object({
  cryptoTransactionHash: z.string().trim().min(1).max(200).optional(),
  buyerConfirmed: z.boolean().optional(),
  sellerConfirmed: z.boolean().optional(),
});

const PRIVATE_KEY_LIKE = /private\s*key|seed/i;

export const createPaymentMethodSchema = z
  .object({
    kind: z.literal("crypto"),
    networkName: z.string().trim().min(1, "Network name required").max(80),
    address: z
      .string()
      .trim()
      .min(10, "Address must be at least 10 characters")
      .max(128, "Address must be at most 128 characters"),
    qrImageUrl: z.string().trim().max(2000).optional().default(""),
    instructions: z.string().trim().max(2000).optional().default(""),
    enabled: z.boolean().optional().default(true),
  })
  .superRefine((data, ctx) => {
    if (PRIVATE_KEY_LIKE.test(data.address) || PRIVATE_KEY_LIKE.test(data.instructions || "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Do not enter private keys or seed phrases",
        path: ["address"],
      });
    }
  });

export const patchPaymentMethodSchema = z
  .object({
    networkName: z.string().trim().min(1).max(80).optional(),
    address: z.string().trim().min(10).max(128).optional(),
    qrImageUrl: z.string().trim().max(2000).optional(),
    instructions: z.string().trim().max(2000).optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .superRefine((data, ctx) => {
    const check = `${data.address || ""} ${data.instructions || ""}`;
    if (PRIVATE_KEY_LIKE.test(check)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Do not enter private keys or seed phrases",
        path: ["address"],
      });
    }
  });

export const onboardingIdentitySchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(600).optional().default(""),
  photo: z.string().optional().default(""),
  cover: z.string().optional().default(""),
});

export const onboardingLocationSchema = z.object({
  city: z.string().trim().max(80).optional().default(""),
  country: z.string().trim().max(80).optional().default(""),
  network: z.array(networkLocationSchema).max(30).optional().default([]),
  trips: z.array(tripSchema).max(20).optional().default([]),
});

export const onboardingHelpSchema = z.object({
  specialties: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
  publicDisplayMessage: publicDisplayMessageSchema.optional().default(""),
  statusText: z.string().trim().max(STATUS_TEXT_MAX).optional().default(""),
  opportunity: opportunitySchema.optional().nullable(),
});

export const conversationContextTypeSchema = z.enum([
  "listing",
  "opportunity",
  "sourcing",
  "direct",
  "trip",
]);

export const createConversationSchema = z
  .object({
    toUserId: z.string().trim().min(1, "toUserId required"),
    contextType: conversationContextTypeSchema.default("direct"),
    listingId: z.string().trim().min(1).optional().nullable(),
    opportunityId: z.string().trim().min(1).optional().nullable(),
    subject: z.string().trim().max(200).optional().default(""),
    initialMessage: z
      .string()
      .trim()
      .min(1, "Message required")
      .max(MESSAGE_BODY_MAX, `Max ${MESSAGE_BODY_MAX} characters`),
  })
  .refine((v) => !(v.listingId && v.opportunityId), {
    message: "Provide listingId or opportunityId, not both",
  });

export const sourcingRequestSchema = z
  .object({
    toUserId: z.string().trim().min(1, "toUserId required"),
    message: z
      .string()
      .trim()
      .min(1, "Message required")
      .max(MESSAGE_BODY_MAX, `Max ${MESSAGE_BODY_MAX} characters`),
    neededFrom: z.string().trim().max(200).optional().default(""),
    budget: z.string().trim().max(80).optional().default(""),
    deadline: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
      .optional()
      .or(z.literal(""))
      .default(""),
    referenceImages: z
      .array(z.string().trim().min(1))
      .max(MESSAGE_IMAGES_MAX, `Max ${MESSAGE_IMAGES_MAX} reference images`)
      .optional()
      .default([]),
    clientRequestId: z.string().trim().min(8).max(80).optional(),
    listingId: z.string().trim().min(1).optional().nullable(),
    opportunityId: z.string().trim().min(1).optional().nullable(),
  })
  .refine((v) => !(v.listingId && v.opportunityId), {
    message: "Provide listingId or opportunityId, not both",
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

export const sendMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .max(MESSAGE_BODY_MAX, `Max ${MESSAGE_BODY_MAX} characters`)
    .optional()
    .default(""),
  attachmentUrls: z
    .array(z.string().trim().min(1))
    .max(MESSAGE_IMAGES_MAX, `Max ${MESSAGE_IMAGES_MAX} attachments`)
    .optional()
    .default([]),
  clientMessageId: z.string().trim().min(8).max(80).optional(),
}).refine((v) => Boolean(v.text?.trim()) || (v.attachmentUrls?.length ?? 0) > 0, {
  message: "Message or image required",
});

export const transactionStatusSchema = z.enum([
  "REQUESTED",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
]);

export const createTransactionSchema = z.object({
  sellerId: z.string().trim().min(1, "sellerId required"),
  buyerId: z.string().trim().min(1).optional(),
  conversationId: z.string().trim().min(1).optional().nullable(),
  sourcingRequestId: z.string().trim().min(1).optional().nullable(),
  listingId: z.string().trim().min(1).optional().nullable(),
  opportunityId: z.string().trim().min(1).optional().nullable(),
  title: z.string().trim().max(200).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  amount: z.number().nonnegative().optional().nullable(),
  currency: z.string().trim().max(8).optional().default("USD"),
});

export const patchTransactionSchema = z.object({
  status: transactionStatusSchema,
  notes: z.string().trim().max(2000).optional(),
  title: z.string().trim().max(200).optional(),
  amount: z.number().nonnegative().optional().nullable(),
});

export const createReviewSchema = z.object({
  transactionId: z.string().trim().min(1, "transactionId required"),
  rating: z.number().int().min(1, "Rating must be 1–5").max(5, "Rating must be 1–5"),
  text: z.string().trim().min(1, "Review text required").max(2000),
});

export const notificationVolumeSchema = z.enum(["low", "medium", "high"]);

export const notificationPreferencesSchema = z.object({
  notificationSoundsEnabled: z.boolean().optional(),
  notificationVolume: notificationVolumeSchema.optional(),
});

export const notificationReadSchema = z
  .object({
    ids: z.array(z.string().trim().min(1)).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all === true || (v.ids && v.ids.length > 0), {
    message: "ids or all required",
  });

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}
