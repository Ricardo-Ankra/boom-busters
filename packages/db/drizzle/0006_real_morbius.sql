ALTER TABLE "voice_takes" ADD COLUMN "waveform" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_takes" ADD COLUMN "built_from_script_version" integer;