CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "runs_inngest_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_inngest_run_id_key" ON "runs" USING btree ("inngest_run_id");