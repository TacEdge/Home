-- Runtime/app role privileges (M1.1 contract §1.7, I5).
--
-- The HOME application connects as `home_app`, the runtime/app credential: a
-- restricted role that owns no database objects and cannot defeat the
-- append-only audit log even if its credential leaks. This migration runs as
-- the migration/admin credential (the schema owner) and is a no-op where the
-- role does not exist, so the same file works locally, in CI and in both Neon
-- projects once the role has been created there.
--
-- Rule for future migrations (docs/runbooks/MIGRATIONS.md): a migration that
-- creates an append-only table must REVOKE UPDATE, DELETE, TRUNCATE on it
-- FROM home_app, because the default privileges below grant them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'home_app') THEN
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO home_app;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE "user", "session", "account", "verification", "rate_limit"
      TO home_app;
    GRANT SELECT, INSERT ON TABLE "audit_log" TO home_app;
    -- Tables created by later migrations (run as this same owner role) get
    -- data access automatically.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO home_app;
    -- Explicit, after the defaults: the audit log is append-only for the app
    -- role at the privilege level; the trigger remains the second layer.
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM home_app;
  END IF;
END
$$;
