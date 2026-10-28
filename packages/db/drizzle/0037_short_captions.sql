ALTER TABLE "shorts" ADD COLUMN "captions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Decision 326: burned-in captions start off on the long form. Every project
-- whose latest timeline burns them in gets a NEW version with them off, the
-- same append-only step the preview's captions button takes; earlier versions
-- and the renders pinned to them are untouched. The new row has no s3_key,
-- so the next draft or master render uploads its JSON before invoking, as
-- for any timeline compiled while storage was absent. Ids are ULIDs built
-- here (48-bit millisecond time, 80 random bits, Crockford base32), because
-- the column's default lives in the application, not the database.
DO $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  latest record;
  ms bigint;
  new_id text;
  i int;
BEGIN
  FOR latest IN
    SELECT DISTINCT ON ("project_id") "project_id", "version", "json"
    FROM "timelines"
    ORDER BY "project_id", "version" DESC
  LOOP
    CONTINUE WHEN latest."json" -> 'captions' ->> 'style' IS DISTINCT FROM 'karaoke';
    ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
    new_id := '';
    FOR i IN REVERSE 9..0 LOOP
      new_id := new_id || substr(alphabet, ((ms >> (5 * i)) & 31)::int + 1, 1);
    END LOOP;
    FOR i IN 1..16 LOOP
      new_id := new_id || substr(alphabet, floor(random() * 32)::int + 1, 1);
    END LOOP;
    INSERT INTO "timelines" ("id", "project_id", "version", "json", "compiled_at")
    VALUES (
      new_id,
      latest."project_id",
      latest."version" + 1,
      jsonb_set(latest."json", '{captions,style}', '"none"'),
      now()
    );
  END LOOP;
END $$;
