CREATE TABLE "kev_budget_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tier" text NOT NULL,
	"period" date NOT NULL,
	"reserved_usd_micros" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"settled_usd_micros" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "kev_budget_reservation_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "kev_budget_reservation_tier_check" CHECK ("kev_budget_reservation"."tier" in ('fast', 'deep')),
	CONSTRAINT "kev_budget_reservation_status_check" CHECK ("kev_budget_reservation"."status" in ('open', 'settled', 'unreconciled')),
	CONSTRAINT "kev_budget_reservation_period_check" CHECK (extract(day from "kev_budget_reservation"."period") = 1),
	CONSTRAINT "kev_budget_reservation_amounts_check" CHECK ("kev_budget_reservation"."reserved_usd_micros" > 0 and ("kev_budget_reservation"."settled_usd_micros" is null or "kev_budget_reservation"."settled_usd_micros" >= 0)),
	CONSTRAINT "kev_budget_reservation_lifecycle_check" CHECK (("kev_budget_reservation"."status" = 'open' and "kev_budget_reservation"."settled_usd_micros" is null and "kev_budget_reservation"."closed_at" is null)
       or ("kev_budget_reservation"."status" = 'settled' and "kev_budget_reservation"."settled_usd_micros" is not null and "kev_budget_reservation"."closed_at" is not null)
       or ("kev_budget_reservation"."status" = 'unreconciled' and "kev_budget_reservation"."settled_usd_micros" is null and "kev_budget_reservation"."closed_at" is not null)),
	CONSTRAINT "kev_budget_reservation_closed_at_check" CHECK ("kev_budget_reservation"."closed_at" is null or "kev_budget_reservation"."closed_at" >= "kev_budget_reservation"."created_at")
);
--> statement-breakpoint
ALTER TABLE "kev_usage" ADD COLUMN "attempt_id" uuid;--> statement-breakpoint
CREATE INDEX "kev_budget_reservation_period_status_idx" ON "kev_budget_reservation" USING btree ("period","status");--> statement-breakpoint
-- kev_budget_reservation is settle-only (M8 contract §4.6, §13.6;
-- MIGRATIONS.md "Append-only tables"): 0002's default privileges gave
-- home_app every DML privilege on this new table, so take back all but
-- SELECT, INSERT and UPDATE (UPDATE stays: a reservation is closed in
-- place), then let the trigger below decide which updates are allowed, for
-- every role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'home_app') THEN
    REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "kev_budget_reservation" FROM home_app;
  END IF;
END $$;
--> statement-breakpoint
-- A reservation only ever closes: an open row may become settled (with its
-- settled amount and close time) or unreconciled (with its close time, and
-- no settlement: it counts at its full reserved amount). Nothing else about
-- it changes, a closed row never changes, and no row is ever removed. The
-- lifecycle CHECK fixes each state's shape; this fixes the transitions.
CREATE OR REPLACE FUNCTION kev_budget_reservation_settle_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'kev_budget_reservation rows are never removed';
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'a closed kev_budget_reservation cannot change';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.period IS DISTINCT FROM OLD.period
     OR NEW.reserved_usd_micros IS DISTINCT FROM OLD.reserved_usd_micros
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a kev_budget_reservation keeps its id, attempt, user, tier, period, reserved amount and creation time';
  END IF;
  IF NEW.status NOT IN ('settled', 'unreconciled') THEN
    RAISE EXCEPTION 'an open kev_budget_reservation may only become settled or unreconciled';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER kev_budget_reservation_settle_only
  BEFORE UPDATE OR DELETE ON "kev_budget_reservation"
  FOR EACH ROW EXECUTE FUNCTION kev_budget_reservation_settle_only();
--> statement-breakpoint
CREATE TRIGGER kev_budget_reservation_no_truncate
  BEFORE TRUNCATE ON "kev_budget_reservation"
  FOR EACH STATEMENT EXECUTE FUNCTION kev_budget_reservation_settle_only();
