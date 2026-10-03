CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"channel" text NOT NULL,
	"content" jsonb NOT NULL,
	"tier" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_role_check" CHECK ("message"."role" in ('user', 'kev')),
	CONSTRAINT "message_channel_check" CHECK ("message"."channel" in ('web')),
	CONSTRAINT "message_tier_check" CHECK ("message"."tier" in ('fast', 'deep')),
	CONSTRAINT "message_content_check" CHECK (jsonb_typeof("message"."content") = 'object' and "message"."content" ? 'v'
       and jsonb_typeof("message"."content" -> 'v') = 'number'),
	CONSTRAINT "message_author_check" CHECK (("message"."role" = 'kev' and "message"."tier" is not null and "message"."model" is not null)
       or ("message"."role" = 'user' and "message"."tier" is null and "message"."model" is null))
);
--> statement-breakpoint
CREATE TABLE "kev_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" uuid,
	"tier" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd_micros" bigint NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "kev_usage_tier_check" CHECK ("kev_usage"."tier" in ('fast', 'deep')),
	CONSTRAINT "kev_usage_counts_check" CHECK ("kev_usage"."input_tokens" >= 0 and "kev_usage"."output_tokens" >= 0 and "kev_usage"."cache_read_tokens" >= 0
       and "kev_usage"."cache_write_tokens" >= 0 and "kev_usage"."cost_usd_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "insight_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"insight_key" text NOT NULL,
	"response" text NOT NULL,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_response_user_key_unique" UNIQUE("user_id","insight_key"),
	CONSTRAINT "insight_response_response_check" CHECK ("insight_response"."response" in ('dismissed', 'not_useful'))
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_response" ADD CONSTRAINT "insight_response_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_user_id_last_message_at_idx" ON "conversation" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_archived_at_idx" ON "conversation" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "message_conversation_id_created_at_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "message_created_at_idx" ON "message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "kev_usage_at_idx" ON "kev_usage" USING btree ("at");--> statement-breakpoint
CREATE INDEX "kev_usage_user_id_at_idx" ON "kev_usage" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "insight_response_insight_key_idx" ON "insight_response" USING btree ("insight_key");--> statement-breakpoint
ALTER TABLE "capture" ADD CONSTRAINT "capture_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- kev_usage is append-only (M2 contract §4.2, MIGRATIONS.md "Append-only
-- tables"): 0002's default privileges gave home_app every DML privilege on
-- this new table, so take back all but SELECT and INSERT, then refuse
-- changes and removal for every role with a trigger, as for audit_log.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'home_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "kev_usage" FROM home_app;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kev_usage_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'kev_usage is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER kev_usage_no_update_delete
  BEFORE UPDATE OR DELETE ON "kev_usage"
  FOR EACH ROW EXECUTE FUNCTION kev_usage_immutable();
--> statement-breakpoint
CREATE TRIGGER kev_usage_no_truncate
  BEFORE TRUNCATE ON "kev_usage"
  FOR EACH STATEMENT EXECUTE FUNCTION kev_usage_immutable();
