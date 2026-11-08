ALTER TABLE "channel_exemplars" ADD COLUMN "proposal" jsonb;--> statement-breakpoint
ALTER TABLE "motion_derivations" ADD COLUMN "propose" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "motion_derivations" ADD COLUMN "proposal" jsonb;