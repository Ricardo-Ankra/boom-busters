CREATE TABLE "model_catalogue" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"preview" boolean DEFAULT false NOT NULL,
	"context_tokens" integer,
	"max_output_tokens" integer,
	"dialect" text,
	"price_per_image" numeric(12, 4),
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_catalogue_provider_model_key" UNIQUE("provider","model_id")
);
--> statement-breakpoint
CREATE TABLE "model_catalogue_refresh" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_catalogue_refresh_provider_key" UNIQUE("provider")
);
