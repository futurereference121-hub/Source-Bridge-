-- After the profile migration has run against the empty-database stub,
-- drop those stub tables so 20260727150000_init_postgresql can CREATE them.
-- No-op unless the bootstrap marker exists and init has not been applied.
-- Production already has init applied and never creates the marker.

DO $$
DECLARE
  r RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'MigrationOrderBootstrap'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '20260727150000_init_postgresql'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;
END $$;
