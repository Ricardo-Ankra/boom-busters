CREATE TYPE "public"."document_kind" AS ENUM('filing', 'web-archive', 'press-release', 'reporting', 'video', 'figures', 'regulator', 'court');--> statement-breakpoint
CREATE TYPE "public"."legal_status" AS ENUM('ruled', 'alleged', 'none');--> statement-breakpoint
CREATE TABLE "claim_supports" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"document_id" text NOT NULL,
	"rank" integer NOT NULL,
	"quote" text NOT NULL,
	"found" boolean DEFAULT false NOT NULL,
	"offset" integer,
	"locator_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dossier_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"rank" integer,
	"tier" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dossier_documents_project_document_key" UNIQUE("project_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "research_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"http_status" integer,
	"fetched_at" timestamp with time zone NOT NULL,
	"content_type" text,
	"kind" "document_kind" NOT NULL,
	"tier" integer NOT NULL,
	"title" text,
	"published_at" text,
	"text" text DEFAULT '' NOT NULL,
	"text_hash" text,
	"tokens" integer DEFAULT 0 NOT NULL,
	"archived_url" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"failure" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_documents_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "legal_status" "legal_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "legal_status_date" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "legal_status_document_id" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "series" jsonb;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "research" jsonb;--> statement-breakpoint
ALTER TABLE "claim_supports" ADD CONSTRAINT "claim_supports_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_supports" ADD CONSTRAINT "claim_supports_document_id_research_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."research_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_documents" ADD CONSTRAINT "dossier_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_documents" ADD CONSTRAINT "dossier_documents_document_id_research_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."research_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_supports_claim_idx" ON "claim_supports" USING btree ("claim_id");--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_legal_status_document_id_research_documents_id_fk" FOREIGN KEY ("legal_status_document_id") REFERENCES "public"."research_documents"("id") ON DELETE set null ON UPDATE no action;