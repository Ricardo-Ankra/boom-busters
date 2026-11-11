# Hand-made channel exemplars

Decision 463. A channel's exemplars written by hand in a session instead of by the
paid Derive loop. Each folder is one technique for one channel:

- `plan.json`: an `ExemplarPlan` (the catalogue slot rewritten in the channel's
  register, the concept, the storyboard, the mechanisms, the references leaned on)
- `design.jsx`: the design's source, as the designer would answer it
- `meta.json`: `{ "title": "...", "facts": [{ "text": "...", "claim": 1 }] }`

The words a design is checked and played against are the plan's spoken words spread
evenly across the slot (`estimatedWords`), not the plan's own `atMs`; write the
storyboard to those times. Each storyboard line starting `N.N s` is photographed
four frames apart, as the deriver does.

## Check

Every check a derived version passes, under the channel's settings, offline, with
the frames written to `<folder>/out`:

    pnpm --filter @boom-busters/web exemplar:hand -- \
      --technique lower-third --dir docs/exemplars/boom-busters/lower-third \
      --settings <the channel's settings as JSON>

The settings come from the channel's row (`channels.settings`), read read-only with
the owner's permission; they are not kept in the repo.

## Review

Every design and every revision goes to a fresh reviewer agent with
`review-brief.md`, the plan, the source and the frames, never with the author's
conclusions. Reviewers disagree between rounds; the channel's style guide and the
owner's own steers decide.

## Upload

With the owner's go-ahead for the batch, from `apps/web`:

    pnpm exec tsx --import ./scripts/stub-server-only.mjs --env-file=<main .env.local> \
      scripts/hand-exemplar.ts upload --channel boom-busters \
      --technique lower-third --dir <folder>

It runs the checks again under the live settings, stores the version as a draft at
no cost and keeps its frames in R2. The owner approves it on the Exemplars tab.

A revision made on the owner's note adds the version it revises and the owner's words:

    ... upload --channel boom-busters --technique typewriter --dir <folder> \
      --parent <version id> --steer "<the owner's words>"

It is filed as the app's Refine files one: the parent must be the technique's approved
version or, with none approved, its latest draft; the new draft sits beside its parent
on the Exemplars tab, and the steer is recorded as the owner's verdict on the parent.
Approving the revision retires the other drafts.

## The owner's rulings

When the owner rules on a design against the written style guide, the ruling goes in
the brief's own section and wins for every later review. The first: the typewriter
types a letter at a time, an exception to "letter by letter animation".
