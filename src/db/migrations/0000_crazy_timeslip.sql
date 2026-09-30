CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"actor_via" text NOT NULL,
	"actor_channel" text,
	"event" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"summary" text,
	"meta" jsonb
);
--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
-- audit_log is append-only: no row may be changed or removed, and the table
-- may not be truncated (M1 contract §5.4, ADR 0003 §5).
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
