import { z } from "zod";
import { PUBLIC_DISPLAY_MESSAGE_MAX, STATUS_TEXT_MAX } from "@/lib/limits";

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

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  email: z.string().trim().email("Valid email required").max(200),
  intent: z.enum(["buyer", "provider", "both"]).default("both"),
});

export const signInSchema = z.object({
  email: z.string().trim().email("Valid email required").max(200),
});

export const changeEmailSchema = z.object({
  email: z.string().trim().email("Valid email required").max(200),
});

export const usernameSchema = z
  .string()
  .trim()
  .transform(normalizeUsername)
  .refine((u) => u.length >= 3 && u.length <= 30, "Username must be 3–30 characters")
  .refine(isValidUsername, "Use letters, numbers, underscores; URL-safe");

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
  title: z.string().trim().min(1, "Title required").max(120),
  description: z.string().trim().min(1, "Description required").max(2000),
  city: z.string().trim().min(1, "City required").max(80),
  country: z.string().trim().min(1, "Country required").max(80),
  category: z.string().trim().min(1, "Category required").max(80),
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
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).optional().default(""),
  category: z.string().trim().min(1).max(80),
  quantity: z.string().trim().max(40).optional().default(""),
  availability: z
    .enum(["available", "limited", "made_to_order", "to_source"])
    .default("available"),
  location: z.string().trim().max(120).optional().default(""),
  price: z.number().nonnegative().optional().nullable(),
  currency: z.string().trim().max(8).optional().default("USD"),
  images: z.array(z.string()).max(12).optional().default([]),
});

export const onboardingIdentitySchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(600).optional().default(""),
  photo: z.string().optional().default(""),
  cover: z.string().optional().default(""),
});

export const onboardingLocationSchema = z.object({
  city: z.string().trim().min(1).max(80),
  country: z.string().trim().min(1).max(80),
  network: z.array(networkLocationSchema).max(30).optional().default([]),
  trips: z.array(tripSchema).max(20).optional().default([]),
});

export const onboardingHelpSchema = z.object({
  specialties: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
  publicDisplayMessage: publicDisplayMessageSchema.optional().default(""),
  statusText: z.string().trim().max(STATUS_TEXT_MAX).optional().default(""),
  opportunity: opportunitySchema.optional().nullable(),
});

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}
