# Multiple channels, stage A: production rollout

Branch `multi-channel` carries one migration, `0038_channels`. It follows
the captions migration `0037_short_captions`, which production already has.
It moves the one settings row into the first channel and a workspace row,
gives every case, project, ledger row, run, publish record, snapshot and
logo the first channel's id, moves the YouTube credential into
`youtube_connections`, adds a partial unique index so one YouTube channel
can belong to only one console channel, and drops the `settings` table.

`apps/web` runs `scripts/deploy-migrate.mjs` before `next build`, so on
Vercel the migrations run first and the old deployment keeps serving until
the new build is live. During that window the old code reads a table that
no longer exists. These steps keep the window short and recoverable.

## 1. Rehearse on a Neon branch

1. In Neon, create a branch from production. Copy its connection string.
2. On the branch, before migrating, note these counts:
   `select count(*) from cases;` and the same for `projects`,
   `publish_records`, `analytics_snapshots`, `cost_ledger` and `runs`;
   `select count(*) from assets where kind = 'logo';`;
   `select count(*) from assets where kind = 'music';`;
   `select count(*) from provider_credentials where provider = 'youtube';`.
3. From the merge commit: `DATABASE_URL=<branch string> pnpm db:migrate`
   (applies 0038_channels).
4. Read only, on the branch, each expected to equal its step 2 count:
   `select count(*) from cases where channel_id = '01BB0000000000000000000001';`
   and the same for `projects`, `publish_records`, `analytics_snapshots`,
   `cost_ledger` and `runs`;
   `select count(*) from assets where kind = 'logo' and channel_id = '01BB0000000000000000000001';`;
   `select count(*) from assets where kind = 'music' and channel_id is null;`.
5. `select slug, (settings ? 'budgets') from channels;` returns
   `boom-busters | f`.
6. `select value->'budgets', value->'modelPrices' from workspace;` shows the
   ceiling and any price overrides you had set, not fresh defaults.
7. `select count(*) from youtube_connections;` equals the step 2 YouTube
   credential count (one if YouTube was connected, none if not), and
   `select count(*) from provider_credentials where provider = 'youtube';`
   is now zero.

Stop here if any check differs. The branch is also the restore point for
step 3.

## 2. Before you push

- Run `pnpm build` locally on the merge commit and see it pass. A build
  that fails on Vercel after the migration has run leaves production on old
  code against the new schema.
- Pick a quiet moment: no live run in the console, no gate you are about to
  press, and not near 06:00 UTC, when the analytics cron runs.

## 3. Deploy

1. Push. Watch the Vercel deployment until it is Ready (if no build starts
   within ten minutes, deploy by hand from a clean `master`).
2. Expect a few minutes of errors on the old deployment while the build
   runs. They stop when the new deployment goes live.
3. `PUT /api/inngest` so Inngest registers the new step ids and the new
   event shape.
4. Open `/`: it lands on `/c/boom-busters`. Open Settings, Channel tab, and
   check the bible reads as the house register. Open the Connections tab:
   if YouTube was connected, press Verify once to store the YouTube channel
   id.
5. Delete the Neon branch.

If the Vercel build fails after the migration, fix forward and redeploy.
Do not revert the code: the old code cannot run against the new schema.
Restoring the database to the Neon branch point is the last resort, and it
loses anything written since.

## 4. Before connecting a second YouTube account

Connect the new channel's YouTube from that channel's Settings, Connections
tab. If the Google consent screen offers the Boom & Busters account, choose
the other one; the console now refuses an account another channel already
holds and says so. A wrong connection can be removed with Disconnect.
