CREATE TABLE "capture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_via" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"archived_at" timestamp with time zone,
	"text" text NOT NULL,
	"channel" text NOT NULL,
	"message_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"organised_into" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"organised_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "capture_created_via_check" CHECK ("capture"."created_via" in ('ui', 'kev', 'sync')),
	CONSTRAINT "capture_visibility_check" CHECK ("capture"."visibility" = 'private'),
	CONSTRAINT "capture_created_by_check" CHECK ("capture"."created_by" is not null and "capture"."created_via" <> 'sync'),
	CONSTRAINT "capture_text_check" CHECK ("capture"."text" ~ '[^[:space:]]'),
	CONSTRAINT "capture_channel_check" CHECK ("capture"."channel" in ('web')),
	CONSTRAINT "capture_status_check" CHECK ("capture"."status" in ('new', 'proposed', 'organised', 'dismissed')),
	CONSTRAINT "capture_organised_into_check" CHECK (jsonb_typeof("capture"."organised_into") = 'array'
       and not jsonb_path_exists("capture"."organised_into", '$[*] ? (@.type() != "object"
  || !(exists(@."type")) || @."type".type() != "string"
  || !(@."type" like_regex "^(task|event|project|note|context)$")
  || !(exists(@."id")) || @."id".type() != "string" || !(@."id" like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))')),
	CONSTRAINT "capture_organised_check" CHECK ("capture"."status" <> 'organised'
       or ("capture"."organised_at" is not null and jsonb_array_length("capture"."organised_into") > 0)),
	CONSTRAINT "capture_dismissed_check" CHECK (("capture"."status" = 'dismissed') = ("capture"."dismissed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_via" text NOT NULL,
	"visibility" text DEFAULT 'household' NOT NULL,
	"archived_at" timestamp with time zone,
	"origin_capture_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"content" text NOT NULL,
	"category" text NOT NULL,
	"source_type" text NOT NULL,
	"source_user_id" text NOT NULL,
	"source_ref" uuid,
	"last_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" date,
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "context_created_via_check" CHECK ("context"."created_via" in ('ui', 'kev', 'sync')),
	CONSTRAINT "context_visibility_check" CHECK ("context"."visibility" in ('household', 'private')),
	CONSTRAINT "context_subject_type_check" CHECK ("context"."subject_type" in ('person', 'household', 'project')),
	CONSTRAINT "context_subject_check" CHECK (("context"."subject_type" = 'household') = ("context"."subject_id" is null)),
	CONSTRAINT "context_content_check" CHECK ("context"."content" ~ '[^[:space:]]'),
	CONSTRAINT "context_category_check" CHECK ("context"."category" in ('interest', 'preference', 'routine', 'intention', 'practical', 'other')),
	CONSTRAINT "context_source_type_check" CHECK ("context"."source_type" in ('told_kev', 'manual', 'capture')),
	CONSTRAINT "context_sensitivity_check" CHECK ("context"."sensitivity" in ('normal', 'sensitive')),
	CONSTRAINT "context_status_check" CHECK ("context"."status" in ('proposed', 'active', 'retired')),
	CONSTRAINT "context_retired_check" CHECK (("context"."status" = 'retired') = ("context"."retired_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_via" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"archived_at" timestamp with time zone,
	"conversation_id" uuid,
	"requested_by_user_id" text NOT NULL,
	"capture_id" uuid,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (now() + interval '7 days') NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decided_channel" text,
	"result_ref" jsonb,
	"failure_reason" text,
	CONSTRAINT "proposal_created_via_check" CHECK ("proposal"."created_via" in ('ui', 'kev', 'sync')),
	CONSTRAINT "proposal_visibility_check" CHECK ("proposal"."visibility" = 'private'),
	CONSTRAINT "proposal_requester_check" CHECK ("proposal"."created_by" is not null and "proposal"."created_by" = "proposal"."requested_by_user_id"
       and "proposal"."created_via" <> 'sync'),
	CONSTRAINT "proposal_action_check" CHECK ("proposal"."action" in ('task.create', 'task.update', 'task.schedule', 'event.create', 'event.update', 'event_person.set', 'project.create', 'project.update', 'note.create', 'context.create', 'context.update', 'capture.dismiss')),
	CONSTRAINT "proposal_payload_check" CHECK (jsonb_typeof("proposal"."payload") = 'object'),
	CONSTRAINT "proposal_summary_check" CHECK ("proposal"."summary" ~ '[^[:space:]]'),
	CONSTRAINT "proposal_status_check" CHECK ("proposal"."status" in ('pending', 'approved', 'rejected', 'expired', 'failed')),
	CONSTRAINT "proposal_expiry_check" CHECK ("proposal"."expires_at" > "proposal"."created_at"),
	CONSTRAINT "proposal_decided_channel_check" CHECK ("proposal"."decided_channel" in ('web')),
	CONSTRAINT "proposal_decider_check" CHECK ("proposal"."decided_by" is null or "proposal"."decided_by" = "proposal"."requested_by_user_id"),
	CONSTRAINT "proposal_failure_reason_check" CHECK ("proposal"."failure_reason" is null or "proposal"."failure_reason" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "proposal_status_shape_check" CHECK (case "proposal"."status"
        when 'pending' then "proposal"."decided_by" is null and "proposal"."decided_at" is null and "proposal"."decided_channel" is null
          and "proposal"."result_ref" is null and "proposal"."failure_reason" is null
        when 'expired' then "proposal"."decided_by" is null and "proposal"."decided_at" is null and "proposal"."decided_channel" is null
          and "proposal"."result_ref" is null and "proposal"."failure_reason" is null
        when 'approved' then "proposal"."decided_by" is not null and "proposal"."decided_at" is not null and "proposal"."decided_channel" is not null
          and "proposal"."result_ref" is not null and "proposal"."failure_reason" is null
        when 'rejected' then "proposal"."decided_by" is not null and "proposal"."decided_at" is not null and "proposal"."decided_channel" is not null
          and "proposal"."result_ref" is null and "proposal"."failure_reason" is null
        when 'failed' then "proposal"."decided_by" is not null and "proposal"."decided_at" is not null and "proposal"."decided_channel" is not null
          and "proposal"."result_ref" is null and "proposal"."failure_reason" is not null
        else false end)
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "origin_capture_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "origin_capture_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "origin_capture_id" uuid;--> statement-breakpoint
ALTER TABLE "note" ADD COLUMN "origin_capture_id" uuid;--> statement-breakpoint
ALTER TABLE "capture" ADD CONSTRAINT "capture_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context" ADD CONSTRAINT "context_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context" ADD CONSTRAINT "context_origin_capture_id_capture_id_fk" FOREIGN KEY ("origin_capture_id") REFERENCES "public"."capture"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context" ADD CONSTRAINT "context_source_user_id_user_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_capture_id_capture_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."capture"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capture_created_by_status_idx" ON "capture" USING btree ("created_by","status");--> statement-breakpoint
CREATE INDEX "capture_visibility_created_by_idx" ON "capture" USING btree ("visibility","created_by");--> statement-breakpoint
CREATE INDEX "capture_archived_at_idx" ON "capture" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "capture_dismissed_at_idx" ON "capture" USING btree ("dismissed_at");--> statement-breakpoint
CREATE INDEX "capture_message_id_idx" ON "capture" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "context_subject_idx" ON "context" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "context_origin_capture_id_idx" ON "context" USING btree ("origin_capture_id");--> statement-breakpoint
CREATE INDEX "context_source_user_id_idx" ON "context" USING btree ("source_user_id");--> statement-breakpoint
CREATE INDEX "context_created_by_idx" ON "context" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "context_visibility_created_by_idx" ON "context" USING btree ("visibility","created_by");--> statement-breakpoint
CREATE INDEX "context_archived_at_idx" ON "context" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "proposal_requested_by_status_idx" ON "proposal" USING btree ("requested_by_user_id","status");--> statement-breakpoint
CREATE INDEX "proposal_capture_id_idx" ON "proposal" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "proposal_conversation_id_idx" ON "proposal" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "proposal_decided_by_idx" ON "proposal" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "proposal_created_by_idx" ON "proposal" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "proposal_visibility_created_by_idx" ON "proposal" USING btree ("visibility","created_by");--> statement-breakpoint
CREATE INDEX "proposal_archived_at_idx" ON "proposal" USING btree ("archived_at");--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_origin_capture_id_capture_id_fk" FOREIGN KEY ("origin_capture_id") REFERENCES "public"."capture"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_origin_capture_id_capture_id_fk" FOREIGN KEY ("origin_capture_id") REFERENCES "public"."capture"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_origin_capture_id_capture_id_fk" FOREIGN KEY ("origin_capture_id") REFERENCES "public"."capture"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_origin_capture_id_capture_id_fk" FOREIGN KEY ("origin_capture_id") REFERENCES "public"."capture"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_origin_capture_id_idx" ON "event" USING btree ("origin_capture_id");--> statement-breakpoint
CREATE INDEX "project_origin_capture_id_idx" ON "project" USING btree ("origin_capture_id");--> statement-breakpoint
CREATE INDEX "task_origin_capture_id_idx" ON "task" USING btree ("origin_capture_id");--> statement-breakpoint
CREATE INDEX "note_origin_capture_id_idx" ON "note" USING btree ("origin_capture_id");--> statement-breakpoint
-- Capture first, organise second (CLAUDE.md): a capture keeps the user's own
-- words exactly as given. Organising adds to the row (status, organised_into,
-- organised_at) but nothing may change what was said, who said it, when, how
-- it was created, or through which channel, whichever role or path tries.
-- message_id stays writable (Package 5 attaches the message). Deleting the
-- row (a later purge) is unaffected.
CREATE OR REPLACE FUNCTION capture_source_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."text" IS DISTINCT FROM OLD."text"
     OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR NEW."created_via" IS DISTINCT FROM OLD."created_via"
     OR NEW."channel" IS DISTINCT FROM OLD."channel" THEN
    RAISE EXCEPTION 'a capture keeps its original words: text, created_by, created_at, created_via and channel cannot change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER capture_source_immutable
  BEFORE UPDATE ON "capture"
  FOR EACH ROW EXECUTE FUNCTION capture_source_immutable();
