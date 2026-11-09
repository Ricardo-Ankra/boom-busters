ALTER TYPE "public"."document_kind" ADD VALUE 'scholarly';--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "evidence_status" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "evidence_document_id" text;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_evidence_document_id_research_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."research_documents"("id") ON DELETE set null ON UPDATE no action;