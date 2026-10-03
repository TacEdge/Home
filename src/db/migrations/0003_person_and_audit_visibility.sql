CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_via" text NOT NULL,
	"visibility" text DEFAULT 'household' NOT NULL,
	"archived_at" timestamp with time zone,
	"name" text NOT NULL,
	"short_name" text,
	"role" text NOT NULL,
	"relationship" text,
	"in_household" boolean DEFAULT true NOT NULL,
	"date_of_birth" date,
	"stage_note" text,
	"colour" text,
	"user_id" text,
	CONSTRAINT "person_created_via_check" CHECK ("person"."created_via" in ('ui', 'kev', 'sync')),
	CONSTRAINT "person_visibility_check" CHECK ("person"."visibility" in ('household', 'private')),
	CONSTRAINT "person_role_check" CHECK ("person"."role" in ('parent', 'child', 'other')),
	CONSTRAINT "person_colour_check" CHECK ("person"."colour" in ('moss', 'sky', 'sun-soft', 'plum', 'sage', 'mist'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "visibility" text DEFAULT 'household' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "visible_to_user_id" text;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "person_user_id_unique" ON "person" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "person_created_by_idx" ON "person" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "person_visibility_created_by_idx" ON "person" USING btree ("visibility","created_by");--> statement-breakpoint
CREATE INDEX "person_archived_at_idx" ON "person" USING btree ("archived_at");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_visibility_check" CHECK ("audit_log"."visibility" in ('household', 'private'));