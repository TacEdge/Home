CREATE TABLE "weather_forecast" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"fetched_at" timestamp with time zone,
	"hours" jsonb,
	"location_fingerprint" text,
	"first_hour" timestamp with time zone,
	"last_hour" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_attempt_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weather_forecast_provider_unique" UNIQUE("provider"),
	CONSTRAINT "weather_forecast_provider_check" CHECK ("weather_forecast"."provider" in ('open_meteo')),
	CONSTRAINT "weather_forecast_last_attempt_status_check" CHECK ("weather_forecast"."last_attempt_status" in ('ok', 'unreachable', 'rate_limited', 'timeout', 'too_large', 'bad_response')),
	CONSTRAINT "weather_forecast_location_fingerprint_check" CHECK ("weather_forecast"."location_fingerprint" is null or "weather_forecast"."location_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "weather_forecast_location_hours_check" CHECK ("weather_forecast"."location_fingerprint" is not null or "weather_forecast"."hours" is null)
);
