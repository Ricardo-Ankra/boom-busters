# Bible tab rework

Date: 2026-11-03. Source: the Impeccable critique of the Bible tab
(`.impeccable/critique/2026-11-03T08-40-32Z__apps-web-app-console-c-slug-settings-bible-tab-tsx.md`,
25/40) and the owner's answers to it.

## Owner's rulings

1. The two graphics worked examples (`graphics-worked-beat`,
   `graphics-worked-chart`) leave the Bible. They are dropped outright, not
   moved: every graphics call already gets a checked exemplar of its technique
   (decision 305), every stored exemplar lays out for 9:16, and Shorts never
   call the designer, so nothing is needed as a new exemplar. The graphics
   system prompt keeps its written answer-format rules and loses the two
   example blocks.
2. All five priority issues are fixed in one pass.

## What changes

### 1. Retire the two graphics slots

- `EXAMPLE_SLOTS` drops both; the registry holds 44. A new
  `RETIRED_SLOT_IDS` names them, so migration 0039's frozen literal still
  checks against today's code.
- `[[example:graphics-worked-*]]` leaves the graphics system prompt.
- `direction-worked-example`, the only other `worked` slot, is prose, not
  shared code, so it becomes `passage` and the `worked` kind is removed. The
  Boom & Busters overlap skip of decision 357 goes with it.
- Saved versions keep their stamped `slot_ids` and stay complete. A bible or
  draft that still holds the retired keys composes as before (no prompt reads
  them), is not overlap-checked on them, and drops them on its next Examples
  edit.

### 2. Examples section

- Each slot gets a human `title`. The slot id, the `teaches` text as a
  visible label and the "In: file.ts" line leave the UI. `teaches` becomes the
  hint under the box, linked by `aria-describedby`.
- Slots are grouped by stage: Script, Research, Direction, Shot list, Titles
  and descriptions. Each group is a collapsible block headed with its name and
  "n of m written", open when it holds an empty or flagged slot.
- A summary line above the groups ("38 of 44 examples written") with a
  "Next missing" button that opens the first empty slot's group and focuses it.
- Boxes are sized by kind: `line` 2 rows, `passage` 6 rows. The character
  count shows in edit mode and turns warning colour at 90 percent of the limit.
- An empty slot reads "No example yet" in muted text, not an amber warning.

### 3. Save bar

The version note, Save, Discard and the blockers move into a bar fixed to the
bottom of the viewport (`sticky bottom-0`) while a draft exists. It says how
many things stop Save and lists them on request. The button keeps the name
"Save".

### 4. Header

One row: the version sentence, then History, Copy from another channel and
Draft with AI. One panel opens at a time, below the row. When the channel's
bible is incomplete and there is no draft, a "Start here" block replaces the
two drafting buttons in the row and offers them as the way in.

### 5. Section cards

Each card's summary shows its title as an `h3`, its status chip with an icon
beside the text, and a one-line count ("5 of 6 filled", "38 of 44 examples
written", "3 hooks, 2 openings, 4 titles"). The tab gets an `h2` ("Channel
bible", visually hidden).

## Out of scope

The 49 arbitrary `text-[Npx]` sizes, the History dialog's raw JSON, and the
blocker strings that name a raw field path.
