-- Additive: optional opportunity start date for simplified opportunity form.
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3);
