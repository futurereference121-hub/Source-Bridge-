-- Empty-database bootstrap so 20260727140000 can alter StockListing
-- before 20260727150000 creates it. No-op when User already exists
-- (Production and any database that already applied the historical schema).
-- The marker table is removed by the following bootstrap-drop migration
-- before init runs. It is not a Prisma model.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'User'
  ) THEN
    RETURN;
  END IF;

  CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
  );

  CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
  );

  CREATE TABLE "StockListing" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "StockListing_pkey" PRIMARY KEY ("id")
  );

  CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "reviewerId" TEXT,
    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
  );

  CREATE TABLE "MigrationOrderBootstrap" (
    "id" TEXT NOT NULL,
    CONSTRAINT "MigrationOrderBootstrap_pkey" PRIMARY KEY ("id")
  );
END $$;
