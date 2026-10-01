-- Creates the runtime/app role for local Docker and CI databases, using a
-- known, test-only password. This is the restricted database role used by the
-- HOME application: it owns no objects and gets only the grants that migration
-- 0002_app_role applies. Idempotent so it can run on every start.
--
-- Production and home-dev do this by hand with the migration/admin credential
-- (docs/runbooks/DEPLOY.md) and a generated password that is never committed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'home_app') THEN
    CREATE ROLE home_app LOGIN PASSWORD 'home_app' NOINHERIT NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
