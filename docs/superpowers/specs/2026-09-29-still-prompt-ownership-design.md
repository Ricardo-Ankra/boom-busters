# Still prompts with one owner per fact (decision 285)

Status: design approved in conversation 2026-09-29, section by section; this
document is for the owner's review before an implementation plan is written.

## 1. The problem

The owner's report, 2026-09-29: coffee cups with ring stains appear in almost
every generated still; some stills hold an extra desk, or computer screens face
the wrong way, so images are regenerated many times. Then: "we must just make
sure that the different bibles, and shots are not working against each other
... things getting referenced multiple times means there is a lot of overlap and
it can be causing confusion ... the bible should describe the environment's
condition rather than labelling items specifically, and maybe let the shot list
define ... get us a higher quality output, but we aren't just creating steps to
fix the other steps' mistakes."

### 1.1 Evidence

All 46 still briefs of the Stability AI film were read from production
(read-only, 2026-09-29), and every source of text that reaches the image model
was traced in code.

What the planner actually wrote:

- `HOUSE_PHOTOGRAPH` sits verbatim on 44 of 46 prompts, so "a coffee ring,
  cable runs, papers out of line" was asked for 44 times, including the three
  data centre stills and a macro of a printed licence.
- The planner added its own coffee to 10 more ("a half-drunk coffee" is the
  bible's example human trace), and repeated its own devices: dust motes in 14,
  "thin-bezel developer laptop" in 9, rain in 9, a red standby light in 4 (the
  film's accent is `#ef4444`, handed to it as a hex code).
- The book's palette line, which the planner is told to append verbatim, is
  present in 3 of 46.
- 6 negative prompts of a 2024 film say "no flat screen" (two also "no modern
  objects"): the bible's 1990s example, copied. Gemini folds a negative prompt
  into the text as `Avoid: ...`, so these stills ask for a laptop and avoid
  screens in one prompt.

Where the layers disagree:

| Subject | Stated by | Conflict |
|---|---|---|
| Colour temperature | house line ("window daylight and warm practicals"), book palette ("cold"), anchors ("muted, sombre"), set inventory Light line | Warm against cold; a windowless data centre is asked for window daylight |
| Grain | house line ("slight grain"), anchors ("subtle film grain"), compositor overlay | Three times; with `grainPreset: 'none'` the prompt says both "clean, no grain" and "slight grain" |
| People | house line ("people caught candid") on every plate | Plates are "empty of people" |
| The room | plates, inventory, planner prose, `look` line | The planner is told not to describe the room; code then appends the inventory, including "Behind the camera, out of frame: ..." on wide shots |
| Faces | redirect prompt ("face turned away") | `PEOPLE_RULES` and the bible forbid a face turned away |
| Motion | rebrief and retype shapes offer `pan` | The bible and planner forbid a pan |
| Aspect | teaser clause ("Vertical 9:16 frame") | Both adapters are fixed at 16:9 |

Who assembles the prompt: nobody. The planner LLM is trusted to paste three
fixed lines; `generateStillCandidates` adds only `framingLead` and
`withReferenceClause`. Rebrief, redirect, retype to still and owner edits add
none of the fixed lines, so their stills differ from planned ones, and the live
harness appends the lines in code (`live-set-test.ts:472`), so what decision
275 tuned is not what the app sends. Every live run so far used hand-written
shot prose (PROGRESS, decision 275: "Not covered by the harness: ...
planner-written prose").

### 1.2 Causes

1. **Fixed text lists objects.** The bible says "the image model reads a list
   of objects as a list of things to show", and the house line is such a list.
2. **Examples become defaults.** The planner takes the first example the bible
   gives (a coffee, dust in a beam, rain on the window, a 1990s negative).
3. **An LLM is the assembler.** Fixed lines are pasted by the planner, dropped
   by every other route, and paraphrased where they are kept.
4. **One fact, several owners.** Light, grain, colour, the room and faces are
   each stated by two to four sources that were tuned at different times.
5. **Code names what the lens cannot see.** The wide camera sentence names the
   wall behind the camera and the rest of the room, which the live runs showed
   pulls those things into frame.
6. **Nothing states orientation or count.** No rule says which way a screen
   faces or how many desks the room holds.

## 2. Goals and non-goals

Goals:

- Fewer regenerations because the first image is right: the right room, the
  right geometry, no invented clutter.
- Each fact has one owner, and one code function assembles every still prompt
  on every route.
- The bible describes conditions and craft; the planner names what is in each
  frame.
- Proven before and after on the same chapter with the real planner.

Non-goals:

- No new checking or repair step (no vision review of outputs, no prompt lint
  that rewrites text). The work removes the causes instead.
- No structured scene fields (option B in conversation). Considered for later
  if prose ownership is not enough.
- No change to plate selection (`platesForCamera`), image labels or the
  likeness sentences; runs 9 to 14 tuned them and they held.
- No per-film colour tint in the compositor.
- Hero video stays disabled; its bible paragraph is untouched.

## 3. Decisions taken with the owner

1. Option A: the planner writes the scene; one code function builds the prompt.
2. The compositor owns grade and grain; image prompts carry no grade, grain,
   film stock or colour code.
3. The compositor grade ships in this piece of work, ahead of the prompt
   change, so no still is ever ungraded.
4. The harness may read the chapter, book, sets, plates and cast photos
   (including Emad Mostaque's) from production, read-only.
5. The work branches from master after `social-posts` merges, because the grade
   touches `DocumentaryMaster.tsx`, which carries uncommitted social-post work.

## 4. Ownership

| Fact | Owner | Reaches the model as |
|---|---|---|
| Who is there, what they do, the detail the sentence names, the light of the moment | The planner (the only LLM-written text) | The scene |
| Lens and camera height outside a set | The planner, inside the scene | The scene |
| Shot size | The brief's `shotSize` | The framing lead, written by code, on every still |
| Walls, furniture, materials, the room's fixed light | Set plates and inventory | The camera sentence, written by code, walls in frame only |
| Faces | Cast photographs | The reference sentences, written by code |
| How a photograph looks | One code constant, qualities only | The photographic line |
| Grade and grain | The compositor | Nothing in the prompt |
| Era | The book's era lock | A constraint on the planner, never pasted |
| What to keep out | The planner, concrete nouns of this scene | `Avoid: ...` |

The book's palette stays in the book. Its `temperature` is shown to the planner
as guidance for its light ("this film's light runs cold"); its hex codes and
`note` no longer reach any image prompt.

## 5. The assembler

### 5.1 One function

`assembleStillPrompt` in `apps/web/lib/still-prompt.ts`, a pure function. Input:
the brief (scene text, `shotSize`, `camera`, `negativePrompt`), the resolved
set (name, layout, plates attached), the attached people (names, photo counts),
and a kind: `still`, `plate`, `sheet` or `teaser`. Output: the text part and the
avoid list, ready for the adapter.

Every route calls it:

| Route | Today | After |
|---|---|---|
| Planner stills (`generateStillCandidates`) | framing lead, planner text, reference clause | assembler |
| Draft a different brief (`rebrief.ts`) | planner text only, no fixed lines | assembler (the brief is a still like any other) |
| Refusal redirect (`redirect.ts`) | same | assembler |
| Retype to still (`schemas/visuals.ts:515`) | description plus anchors | description as scene, then assembler |
| Owner edit on the card | raw text | assembler |
| Teaser still (`teaser-still.ts`) | text, 9:16 clause, anchors | assembler, kind `teaser` |
| Set plates (`setPlateBrief`) | prompt with house line and anchors inline | assembler, kind `plate` |
| Contact sheet (`buildSetSheetPrompt`) | house line and anchors inline | assembler, kind `sheet` |
| Live harness (`live-set-test.ts`) | its own concatenation | assembler |

`stillStyleAnchors` stops being passed to any still prompt. Its remaining
callers are removed or reduced to what is not a still (the book's request loses
the line "The palette sits inside the Brand Kit grade").

### 5.2 Segment order

For a still:

1. **Framing** from `shotSize`, on every still (today only set shots):
   close and macro "A close shot, the subject filling most of the frame, the
   background soft and out of focus: "; medium "A medium shot, the subject from
   the waist up: "; wide, aerial and graphic nothing.
2. **Camera and room**, set shots only (section 7).
3. **Scene**: the planner's text, banned words stripped.
4. **People**: the existing likeness sentences from `withReferenceClause`.
5. **Room references**: the existing set sentence.
6. **Photographic line** (5.3).
7. **Avoid**: the planner's nouns, joined as `Avoid: a, b, c.`, with no doubled
   full stop before it (today `withReferenceClause` ends with one and the
   adapter adds `. Avoid:`). The adapters stop folding; the assembler does it
   once, and `fal-ai/imagen3` still receives its real `negative_prompt` field.

Moving the camera sentence ahead of the scene is a change from what runs 1 to
18 tuned (it came last). The reason is the live finding that the opening of a
prompt wins. It is tested in the after run (section 10) before it ships; if it
loses, the camera returns to after the references and nothing else changes.

A plate is: framing of the view, the set name, "empty of people", the `look`
(first plate) or camera sentence (later views), the room reference sentence,
the plate photographic line, `Avoid: people, figures.` A sheet keeps its grid
text from `buildSetSheetPrompt`, then the plate photographic line. A teaser
keeps its composition clause (centre third, headroom, clear bottom quarter)
without "Vertical 9:16", since the adapters produce 16:9 and the teaser crop
is the compositor's.

### 5.3 The photographic line

One constant replaces `HOUSE_PHOTOGRAPH`, with two variants:

- Still: "An available-light documentary photograph: light from the scene's own
  sources, surfaces showing ordinary daily use, people caught candid and
  mid-moment, never posing or acting for the camera."
- Plate and sheet: the same without the people clause.

It names qualities, never objects, never a lens or height, never grain or a
grade. A test holds it to that (section 10). The exact wording is settled in
the after run; "surfaces showing ordinary daily use" is the phrase to watch for
clutter coming back.

### 5.4 Existing briefs

Stored prompts keep their pasted lines. The assembler strips them on read, so
nothing in the database is rewritten, no brief hash changes, no resolved slot
is bought again, and a run parked before the deploy replays safely:

- `HOUSE_PHOTOGRAPH`, exact text.
- The anchors, by their template, not by current Brand Kit values (the kit may
  have changed since planning): `(\w+ film grain|clean, no grain); muted
  documentary colour grade anchored on #hex and #hex against #hex; sombre,
  photographic realism`.
- The palette prefix `accent #hex, cold|neutral|warm;`.

The strip is idempotent: running it on its own output changes nothing.

### 5.5 The board

The card's prompt field shows and edits the scene only (the stored prompt with
5.4 applied). Below it, a read-only disclosure, "Prompt sent to the model",
shows the assembled text for the slot as it stands. Saving an edit stores the
scene only.

## 6. The bible and the rules

### 6.1 Where each rule lives

- **The bible** (`direction-craft.md`, embedded as `DIRECTION_CRAFT`): the craft
  of a frame, read by every LLM task that writes a visual (book, planner,
  rebrief, redirect).
- **Planner rules** (`shotlist.ts` system prompt): output mechanics only (slot
  shapes, seconds, charts, stock queries, headlines, graphics). Removed from
  them because the bible already says it: "the sentence decides the frame",
  staging an abstract sentence, the era lock, motifs.
- **`SET_RULES` and `PEOPLE_RULES`**: the fields only (`set`, `camera`,
  `depicts`, the three kinds of person). The craft behind them stays in the
  bible.
- **A new bible paragraph, "What code adds"**: framing, the room in view, the
  references, the photographic line; never write them. It replaces the house
  line paragraph, "Append the director's book palette line verbatim", and the
  planner's "then the house photograph line verbatim ... then these Brand Kit
  anchors verbatim".

### 6.2 Rules that change

1. **Grade and grain.** "Grade and grain come from the Brand Kit anchors"
   becomes: a prompt never names a grade, grain, film stock or colour code; the
   compositor grades the film.
2. **Three physical facts** is replaced. The frame holds what the sentence
   needs, and a set holds what its room holds. A sign of use appears only where
   it serves the beat, written as the condition of the moment and drawn from
   the sentence or from what the people are doing ("the table at the end of a
   long meeting", "a desk mid-work"), never chosen from a list of props. No
   prop or atmospheric device appears twice in a chapter: a drink, dust in a
   beam, rain on glass, a standby light. The bible carries no example list of
   objects anywhere.
3. **Spatial relations** (new). Every screen, seat and person in frame gets a
   facing relative to someone or something in the frame: "the monitor faces
   her, its light on her face", "his back to the camera". Counts are said where
   they matter: "the room's one desk", "two chairs".
4. **The avoid list.** Concrete nouns that would be wrong in this frame for
   this film's era and story, five at most; never a category, never anything
   the scene itself shows (a shot with a laptop never avoids screens). The
   1990s example is removed.
5. **Written order.** Subject, action or state, the detail the sentence names,
   the light of the moment (source, direction, quality), then lens and height
   outside a set. "Style anchors" leaves the order.
6. **Light.** In a set, the planner names only what differs at that moment
   (time of day, weather, a lamp switched on); the room's fixed sources come
   from the inventory (section 7).
7. **People.** The identity string already begins with the name and role, so
   the rule stops asking for them twice. "The person in the reference photo"
   leaves the planner's text: the reference sentences and Gemini's image labels
   already tie name to photograph. The after run confirms the likeness holds
   without it; if it does not, the phrase returns as a code segment, not
   planner text.

### 6.3 Contradictions removed

- Redirect: the anonymous figure keeps a visible, natural face.
- Rebrief and retype: no `pan` in their motion shapes.
- One banned list: `cast-identity.ts` uses `BANNED_PROMPT_WORDS`.
- The `look` comment in `schemas/sets.ts` is corrected to what `look` does.

The banned-word strip at generation stays: it is one deterministic pass over
the planner's text and does not depend on any other step failing.

## 7. Room geometry

### 7.1 The camera sentence

`describeCamera` names only what the lens can see:

| Framing | Kept | Changed |
|---|---|---|
| Wide | In frame, Frame left, Frame right, Centre, the room's light | "Behind the camera, out of frame" and "The room: ..." removed |
| Medium | Left, right, the room's light | "Behind:" becomes "Ahead, beyond the subject:" |
| Close | The soft wall ahead, the room's light | Unchanged |

The inventory's Light line is introduced as "The room's own light: ...", with
compass words placed in the frame as today.

### 7.2 Counts in the inventory

The inventory drafter (`set-layout-prompt.ts`) is told to give the number of
each piece of furniture and to say "the only" where there is one ("the room's
only desk, two guest chairs"). Existing inventories are untouched until the
owner presses Redraft; the plan lists the sets worth redrafting (the executive
office holds a desk and a credenza that nothing distinguishes).

### 7.3 One description of each room

The planner's references prefix (`referencesPrefix`) shows a set's inventory
alone, and its `look` only when the inventory is empty. `look` returns to its
documented job: drawing the first plate.

### 7.4 Plates and the sheet

- Every view taken from the middle of the opposite wall uses 35mm, matching
  the contact sheet (today "Generate a view" says 24mm).
- The detail plate drops "never reproduce or edit the framing of its
  photographs" for "a new close photograph of one part of this room".
- The sheet prompt passes through the banned-word strip.

## 8. The compositor grade

- `BrandLookSchema` gains `gradePreset: 'none' | 'muted' | 'strong'`, default
  `muted`. The Brand Kit tab shows a labelled Grade select beside Grain.
- `SlotView` wraps `image` and `video` payloads (stills, stock, archival) in a
  CSS filter: muted about `saturate(0.82) contrast(1.06) brightness(0.97)`,
  strong deeper, none nothing. Exact values are set by eye in the player and a
  render. Charts, headlines, graphics, social cards and maps are not filtered.
  Grain stays over everything.
- The board's player shows the graded film; candidate thumbnails stay raw.
- Deploys: `deploy:remotion` for the composition, and `deploy:stacks
  boom-busters-broker`, because the broker bundles schemas at deploy and an old
  broker drops the new field (renders ungraded rather than failing).

## 9. Data changes

- `BrandLookSchema.gradePreset`, with a default; no migration (settings are
  JSON, and the settings patch carries no defaults since decision 275).
- No change to `shot_slots`, `project_sets` or any stored brief.

## 10. Testing

Unit and component tests land with each change:

- `assembleStillPrompt`: segment order; exactly one lens and one camera
  sentence; no grain word, hex code or listed prop in any fixed text; legacy
  strip removes all three pasted lines and is idempotent; plate and sheet
  variants carry no people clause; one `Avoid:` with no doubled full stop.
- A guard test on the fixed code text (the photographic line, the framing
  leads, the reference sentences; not the inventory, which describes a real
  room): none contains a word from a prop list (coffee, cup, mug, cable, paper,
  laptop, monitor, dust, rain).
- Each route in 5.1 produces its prompt through the assembler (mock-mode
  whole-prompt test per route).
- `describeCamera`: no "Behind the camera", the new medium wording, the room's
  light line.
- Contradictions stay gone: redirect keeps faces visible; rebrief and retype
  offer no pan; no prompt text asks for anything "verbatim" to be pasted into a
  still.
- Board: scene-only field and the read-only assembled prompt (component test,
  one e2e).
- Compositions: the grade filter on image and video only; goldens that change
  are regenerated from a package-alone run.
- After any shared schema or prompt change, every consuming package's suite
  runs.

### 10.1 The live proof

- A harness mode, `--from-plan`, reads one chapter of a production project
  read-only (chapter text, book, sets with inventory and plates, cast with
  photos), runs the real planner on it, and generates one image per still
  through the assembler. `LiveBudget` holds each run under $1.
- **Before** run: today's code, first, as the baseline. **After** run: the new
  code, same chapter, same book and sets.
- The Stability AI film's chapter stored at index 5 (zero-based; it opens
  "Reporting described a boardroom that had lost confidence in Emad
  Mostaque"), with the chapter at index 4 as the fallback if index 5 holds too
  few set shots. Between them they cover the boardroom, the executive office,
  Emad Mostaque and anonymous staff.
- The run folder gets a side-by-side page: each still before and after, with
  the prompt, and five faults to tick: extra furniture, screen facing wrong,
  stray props, room mirrored, likeness off.
- Success: fewer ticks per still after than before, and no fault class that
  gets worse.

## 11. Order of work

1. Harness `--from-plan` and the before run.
2. Compositor grade, deployed and checked in player and render.
3. The assembler and every route in 5.1, with the legacy strip.
4. The bible and rules (section 6).
5. Room geometry and inventory counts (section 7).
6. The after run, the owner's review, and the PROGRESS entry.

## 12. Failure behaviour

- A stored prompt the strip does not recognise keeps its text; at worst the
  fixed lines appear twice, as they do today.
- A missing set layout gives a camera sentence with position and lens only, as
  today.
- An old broker renders without a grade; nothing fails.

## 13. What the owner verifies

- The before and after side-by-side page, faults ticked.
- The grade in the player and in one render.
- One board card: the scene field and the assembled prompt read sensibly.

## 14. Unverified, settled during implementation

- Whether the camera sentence ahead of the scene beats it at the end (5.2).
- Whether the likeness holds without "the person in the reference photo"
  (6.2.7).
- Whether "surfaces showing ordinary daily use" brings clutter back (5.3).
- The grade's filter values.
