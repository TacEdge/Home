CREATE TABLE "calendar_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"provider" text NOT NULL,
	"credentials_encrypted" text,
	"credentials_key_id" text,
	"address_fingerprint" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "calendar_connection_provider_check" CHECK ("calendar_connection"."provider" in ('ics')),
	CONSTRAINT "calendar_connection_status_check" CHECK ("calendar_connection"."status" in ('active', 'disconnected')),
	CONSTRAINT "calendar_connection_state_check" CHECK (("calendar_connection"."status" = 'active' and "calendar_connection"."credentials_encrypted" is not null
            and "calendar_connection"."credentials_key_id" is not null and "calendar_connection"."disconnected_at" is null)
       or ("calendar_connection"."status" = 'disconnected' and "calendar_connection"."credentials_encrypted" is null
            and "calendar_connection"."credentials_key_id" is null and "calendar_connection"."disconnected_at" is not null)),
	CONSTRAINT "calendar_connection_credentials_check" CHECK ("calendar_connection"."credentials_encrypted" is null or (char_length("calendar_connection"."credentials_encrypted") <= 8192
            and "calendar_connection"."credentials_encrypted" ~ '^hc[0-9]+\.[0-9a-f]{16}(\.[A-Za-z0-9_-]+){3}$')),
	CONSTRAINT "calendar_connection_key_id_check" CHECK ("calendar_connection"."credentials_key_id" is null or "calendar_connection"."credentials_key_id" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "calendar_connection_fingerprint_check" CHECK ("calendar_connection"."address_fingerprint" is null or (char_length("calendar_connection"."address_fingerprint") <= 128
            and "calendar_connection"."address_fingerprint" ~ '^fp[0-9]+\.[A-Za-z0-9_-]{16,}$')),
	CONSTRAINT "calendar_connection_ics_fingerprint_check" CHECK ("calendar_connection"."provider" <> 'ics' or "calendar_connection"."address_fingerprint" is not null),
	CONSTRAINT "calendar_connection_error_code_check" CHECK ("calendar_connection"."last_error_code" is null or "calendar_connection"."last_error_code" ~ '^[a-z][a-z_]{0,39}$')
);
--> statement-breakpoint
CREATE TABLE "calendar_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_via" text NOT NULL,
	"visibility" text DEFAULT 'household' NOT NULL,
	"archived_at" timestamp with time zone,
	"connection_id" uuid NOT NULL,
	"external_calendar_id" text NOT NULL,
	"name" text NOT NULL,
	"default_kind" text,
	"default_person_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"feed_hash" text,
	"last_attempt_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_error_code" text,
	"last_skipped_count" integer,
	CONSTRAINT "calendar_source_created_via_check" CHECK ("calendar_source"."created_via" in ('ui', 'kev', 'sync')),
	CONSTRAINT "calendar_source_visibility_check" CHECK ("calendar_source"."visibility" in ('household', 'private')),
	CONSTRAINT "calendar_source_default_kind_check" CHECK ("calendar_source"."default_kind" in ('appointment', 'activity', 'work', 'school', 'social', 'travel', 'birthday', 'deadline', 'other')),
	CONSTRAINT "calendar_source_last_sync_status_check" CHECK ("calendar_source"."last_sync_status" in ('ok', 'partial', 'unreachable', 'address_rejected', 'not_a_calendar', 'too_large')),
	CONSTRAINT "calendar_source_name_check" CHECK (char_length(btrim("calendar_source"."name")) between 1 and 200 and "calendar_source"."name" !~ '://'),
	CONSTRAINT "calendar_source_external_calendar_id_check" CHECK (char_length("calendar_source"."external_calendar_id") between 1 and 200 and "calendar_source"."external_calendar_id" !~ '://'),
	CONSTRAINT "calendar_source_feed_hash_check" CHECK ("calendar_source"."feed_hash" is null or "calendar_source"."feed_hash" ~ '^h[0-9]+:[0-9a-f]{64}$'),
	CONSTRAINT "calendar_source_error_code_check" CHECK ("calendar_source"."last_sync_error_code" is null or "calendar_source"."last_sync_error_code" ~ '^[a-z][a-z_]{0,39}$'),
	CONSTRAINT "calendar_source_skipped_check" CHECK ("calendar_source"."last_skipped_count" is null or "calendar_source"."last_skipped_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "recurrence_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "recurrence_original" text;--> statement-breakpoint
ALTER TABLE "calendar_connection" ADD CONSTRAINT "calendar_connection_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_source" ADD CONSTRAINT "calendar_source_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_source" ADD CONSTRAINT "calendar_source_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_connection_owner_user_id_idx" ON "calendar_connection" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connection_live_fingerprint_unique" ON "calendar_connection" USING btree ("address_fingerprint") WHERE "calendar_connection"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_source_connection_calendar_unique" ON "calendar_source" USING btree ("connection_id","external_calendar_id");--> statement-breakpoint
CREATE INDEX "calendar_source_created_by_idx" ON "calendar_source" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "calendar_source_visibility_created_by_idx" ON "calendar_source" USING btree ("visibility","created_by");--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_calendar_source_id_calendar_source_id_fk" FOREIGN KEY ("calendar_source_id") REFERENCES "public"."calendar_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_recurrence_parent_id_event_id_fk" FOREIGN KEY ("recurrence_parent_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_synced_identity_unique" ON "event" USING btree ("calendar_source_id","external_uid",coalesce("recurrence_original", '')) WHERE "event"."source" = 'synced';--> statement-breakpoint
CREATE UNIQUE INDEX "event_manual_override_unique" ON "event" USING btree ("recurrence_parent_id","recurrence_original") WHERE "event"."source" = 'manual' and "event"."recurrence_parent_id" is not null and "event"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "event_recurrence_parent_id_idx" ON "event" USING btree ("recurrence_parent_id") WHERE "event"."recurrence_parent_id" is not null;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_sync_provenance_check" CHECK (("event"."source" = 'synced') = ("event"."created_via" = 'sync'));--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_recurrence_original_check" CHECK ("event"."recurrence_original" is null
       or "event"."recurrence_original" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)?$');--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_recurrence_parent_check" CHECK ("event"."recurrence_parent_id" is null or "event"."recurrence_original" is not null);