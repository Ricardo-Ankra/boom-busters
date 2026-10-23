-- Decision 311: `revisions` resets to 0 on approval, so the reviser's allowance
-- applies to each round of review. A dossier approved before that change kept
-- its count; this starts it again.
UPDATE "dossiers" SET "revisions" = 0 WHERE "approved_at" IS NOT NULL;
