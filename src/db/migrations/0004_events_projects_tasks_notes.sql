CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_via" text NOT NULL,
	"visibility" text DEFAULT 'household' NOT NULL,
	"archived_at" timestamp with time zone,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"time_zone" text,
	"start_date" date,
	"end_date" date,
	"rrule" text,
	"exdates" text[],
	"kind" text NOT NULL,
	"domain" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"calendar_source_id" uuid,
	"external_uid" text,
	"external_etag" text,
	CONSTRAINT "event_created_via_check" CHECK ("event"."created_via" in ('ui', 'kev', 'sync')),
	CONSTRAINT "event_visibility_check" CHECK ("event"."visibility" in ('household', 'private')),
	CONSTRAINT "event_kind_check" CHECK ("event"."kind" in ('appointment', 'activity', 'work', 'school', 'social', 'travel', 'birthday', 'deadline', 'other')),
	CONSTRAINT "event_domain_check" CHECK ("event"."domain" in ('family', 'home', 'us', 'admin')),
	CONSTRAINT "event_source_check" CHECK ("event"."source" in ('manual', 'synced')),
	CONSTRAINT "event_time_shape_check" CHECK (("event"."all_day" and "event"."start_date" is not null and "event"."end_date" is not null
            and "event"."starts_at" is null and "event"."ends_at" is null and "event"."time_zone" is null)
       or (not "event"."all_day" and "event"."starts_at" is not null and "event"."ends_at" is not null
            and "event"."time_zone" is not null and "event"."start_date" is null and "event"."end_date" is null)),
	CONSTRAINT "event_time_order_check" CHECK (("event"."ends_at" is null or "event"."ends_at" >= "event"."starts_at")
       and ("event"."end_date" is null or "event"."end_date" > "event"."start_date")),
	CONSTRAINT "event_synced_check" CHECK ("event"."source" <> 'synced' or ("event"."calendar_source_id" is not null and "event"."external_uid" is not null))
);
--> statement-breakpoint
CREATE TABLE "event_person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_via" text NOT NULL,
	CONSTRAINT "event_person_role_check" CHECK ("event_person"."role" in ('attending', 'responsible')),
	CONSTRAINT "event_person_created_via_check" CHECK ("event_person"."created_via" in ('ui', 'kev', 'sync'))
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_via" text NOT NULL,
	"visibility" text DEFAULT 'household' NOT NULL,
	"archived_at" timestamp with time zone,
	"title" text NOT NULL,
	"summary" text,
	"domain" text DEFAULT 'home' NOT NULL,
	"status" text DEFAULT 'idea' NOT NULL,
	"target_date" date,
	CONSTRAINT "project_created_via_check" CHECK ("project"."created_via" in ('ui', 'kev', 'sync')),
	CONSTRAINT "project_visibility_check" CHECK ("project"."visibility" in ('household', 'private')),
	CONSTRAINT "project_domain_check" CHECK ("project"."domain" in ('family', 'home', 'us', 'admin')),
	CONSTRAINT "project_status_check" CHECK ("project"."status" in ('idea', 'active', 'paused', 'done'))
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_via" text NOT NULL,
	"visibility" text DEFAULT 'household' NOT NULL,
	"archived_at" timestamp with time zone,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"project_id" uuid,
	"domain" text,
	"assignee_person_id" uuid,
	"about_person_id" uuid,
	"due_date" date,
	"estimate_minutes" integer,
	"needs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_starts_at" timestamp with time zone,
	"scheduled_ends_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "task_created_via_check" CHECK ("task"."created_via" in ('ui', 'kev', 'sync')),
	CONSTRAINT "task_visibility_check" CHECK ("task"."visibility" in ('household', 'private')),
	CONSTRAINT "task_status_check" CHECK ("task"."status" in ('open', 'done', 'dropped')),
	CONSTRAINT "task_domain_check" CHECK ("task"."domain" in ('family', 'home', 'us', 'admin')),
	CONSTRAINT "task_estimate_positive_check" CHECK ("task"."estimate_minutes" is null or "task"."estimate_minutes" > 0),
	CONSTRAINT "task_needs_check" CHECK (jsonb_typeof("task"."needs") = 'array' and "task"."needs" <@ '["dry_weather","daylight","two_people","shops_open"]'::jsonb),
	CONSTRAINT "task_scheduled_window_check" CHECK (("task"."scheduled_starts_at" is null) = ("task"."scheduled_ends_at" is null)
       and ("task"."scheduled_ends_at" is null or "task"."scheduled_ends_at" > "task"."scheduled_starts_at"))
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_via" text NOT NULL,
	"visibility" text DEFAULT 'household' NOT NULL,
	"archived_at" timestamp with time zone,
	"body" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	CONSTRAINT "note_created_via_check" CHECK ("note"."created_via" in ('ui', 'kev', 'sync')),
	CONSTRAINT "note_visibility_check" CHECK ("note"."visibility" in ('household', 'private')),
	CONSTRAINT "note_subject_type_check" CHECK ("note"."subject_type" in ('project', 'person', 'event')),
	CONSTRAINT "note_subject_pair_check" CHECK (("note"."subject_type" is null) = ("note"."subject_id" is null))
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_person" ADD CONSTRAINT "event_person_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_person" ADD CONSTRAINT "event_person_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_person" ADD CONSTRAINT "event_person_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_person_id_person_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_about_person_id_person_id_fk" FOREIGN KEY ("about_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_created_by_idx" ON "event" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "event_visibility_created_by_idx" ON "event" USING btree ("visibility","created_by");--> statement-breakpoint
CREATE INDEX "event_archived_at_idx" ON "event" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "event_starts_at_idx" ON "event" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "event_start_date_idx" ON "event" USING btree ("start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "event_person_event_person_role_unique" ON "event_person" USING btree ("event_id","person_id","role");--> statement-breakpoint
CREATE INDEX "event_person_person_id_idx" ON "event_person" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "event_person_created_by_idx" ON "event_person" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "project_created_by_idx" ON "project" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "project_visibility_created_by_idx" ON "project" USING btree ("visibility","created_by");--> statement-breakpoint
CREATE INDEX "project_archived_at_idx" ON "project" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "task_project_id_idx" ON "task" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_assignee_person_id_idx" ON "task" USING btree ("assignee_person_id");--> statement-breakpoint
CREATE INDEX "task_about_person_id_idx" ON "task" USING btree ("about_person_id");--> statement-breakpoint
CREATE INDEX "task_created_by_idx" ON "task" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "task_visibility_created_by_idx" ON "task" USING btree ("visibility","created_by");--> statement-breakpoint
CREATE INDEX "task_archived_at_idx" ON "task" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "note_subject_idx" ON "note" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "note_created_by_idx" ON "note" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "note_visibility_created_by_idx" ON "note" USING btree ("visibility","created_by");--> statement-breakpoint
CREATE INDEX "note_archived_at_idx" ON "note" USING btree ("archived_at");