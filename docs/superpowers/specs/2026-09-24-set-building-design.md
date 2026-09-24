# Set building: one image to a whole room, and shots from any camera (decision 275)

Status: design approved in conversation 2026-09-24; this document is for the
owner's review before an implementation plan is written.

Research behind it, with a source for every claim:
`scratchpad/scene-research.md` (session scratchpad, 2026-09-24). The parts this
design relies on are quoted where they are used.

## 1. The problem

The owner's report, 2026-09-24: "When choosing the different angles, more or
less the same image is being generated. The angles, perspective are not
changing. Furthermore, the depictions don't seem realistic. What I want to be
able to do is upload an image or generate an image. Then from that image, we
generate different perspectives of the first image to build the set ... even
the Shot itself should be able to change the angle, the camera angles, and
perspectives ... the references angles should just help the image generator
build a more accurate and consistent scene ... the desk, the chair, the laptop
should remain consistent."

Causes found:

1. **Editing models keep the input's framing.** They learn from before and
   after pairs that share geometry, and favour preserving the image over a
   camera instruction. SpatialEdit measured Nano Banana, GPT-Image-1 and
   Seedream 4.0 as "frequently miss metric or viewpoint intent"; CameraEditor
   (September 2026) describes "conservative outputs that ignore geometric
   changes". Decisions 273 and 274 asked for a reverse angle from one plate and
   got the plate back.
2. **The information is missing.** A reverse shot shows the wall behind the
   original camera. One plate contains none of it, and no prompt can supply
   what the model was never given.
3. **The prompt names what to avoid.** "Never reproduce or edit the framing"
   is a negative instruction; Google's guidance is to describe the wanted
   result positively.
4. **The owner's stills run on `gemini-2.5-flash-image`,** which Google lists
   as Legacy and which does no reasoning. Gemini 3 image models reason before
   drawing.
5. **Plates carry no photographic language,** only the Look line and the Brand
   Kit anchors, and a plate that looks rendered passes that look to every
   shot that carries it.

## 2. Goals and non-goals

Goals:

- From one uploaded or generated image, build a set of genuinely different
  views of the same room in one step.
- Plates and stills read as photographs, not renders.
- A still inside a set can take any camera position; the plates and a written
  inventory keep the room's contents consistent, and are never a framing to
  copy.
- The camera of every set shot is data the planner writes and the owner can
  change on the board.

Non-goals (this decision):

- A 3D world (World Labs Marble) or a splat viewer. The set model below leaves
  room to add one later for sets that recur across films; nothing here depends
  on it.
- Dedicated angle models on fal (Qwen or FLUX 2 multiple angles). Trained on
  objects and untested on room reverses.
- Persisting plate candidates across a page reload (still open from decision
  272).
- Changing how cast likeness works.

## 3. Decisions taken with the owner

| Question | Answer |
|---|---|
| Approach | Gemini 3 set sheet: inventory, one 2x2 contact sheet, plates by direction |
| Who decides a shot's camera | The planner writes it; the owner can override it per slot on the board |
| Stills model | Gemini 3.1 Flash Image at 1K, reasoning high (the owner switches the route in Settings; it is already the app default) |
| Sheet model | Gemini 3 Pro Image at 4K, as its own routed task, default |

## 4. What a set holds

### 4.1 Plates face a compass direction

`SET_PLATE_VIEWS` becomes `north`, `east`, `south`, `west`, `detail`, `other`.

- The set's **first image defines north**: whatever it looks at is the north
  wall. The other directions follow clockwise seen from above.
- `detail` is a close view of furniture or materials; `other` is a plate whose
  direction nobody stated.
- **No database migration.** Plates stored under decision 273/274's names are
  read through a `z.preprocess` on `SetPlateSchema.view`: `establishing` is
  north, `reverse` is south, `side` is east. New writes use compass names only.
  `SET_PLATE_ANGLES` and the angle labels are removed.
- `uploadedPlateView` (decision 274) returns `north` for a set's first plate
  and `other` after it.
- `MAX_SET_PLATES` rises from 4 to 6: four compass plates and two details.
  At most two plates still travel with any still (`MAX_SET_REFERENCES`
  unchanged).

### 4.2 The room inventory

A new column `project_sets.layout` (text, not null, default `''`, at most 1,500
characters), shown on the Set card as **Room inventory** beside Look.

Its form is one line per part of the room, each starting with a fixed label:

```
North wall: three tall steel-framed windows, overcast city view, blinds half down.
East wall: walnut credenza, framed revenue chart, door at the south end.
South wall: glass wall onto the corridor, frosted band at eye level.
West wall: bare concrete, wall-mounted screen, dark.
Centre: ten-seat oval walnut table, black mesh chairs, open silver laptop at the head seat facing south.
Light: overcast daylight from the north windows, warm ceiling pendants.
```

- **Drafted from the first plate.** When a set's first plate lands (upload,
  address or chosen generation), the app makes one vision call with the plate
  image and asks for exactly these six labelled lines, inventing the unseen
  walls plausibly and consistently with the Look line. It runs on the
  existing `shotlist` LLM route (a picture-planning call, well under a cent);
  every LLM adapter already accepts images. It never overwrites a non-empty
  inventory. A plated set with an empty field (a failed draft, or a set
  plated before this decision, which was never drafted) shows the neutral
  note "No inventory yet; write it, or press Redraft from plate."
- **Redraft from plate** (a button beside the field, same call) replaces the
  field after a confirm, since it discards the owner's edits.
- `parseLayout(text)` in `packages/schemas` returns the labelled lines it
  finds; anything unlabelled is kept as a remainder that travels whole.
- Look stays as it is (the book's look line). The inventory is the fuller,
  owner-corrected description; where both exist, prompts use the inventory.

## 5. Building the set: the contact sheet

### 5.1 The action

A new button on the Set card, **Build the set · ≈$0.24**, shown once a set has
at least one plate. `buildSetSheetAction(setId)`:

1. Refuses if the set has no plate, or if fewer than three plates are free
   (east, south and west need room; the north panel may replace the
   original), telling the owner how many to remove.
2. Generates ONE image on the `setSheet` route (section 8.2) at 16:9, 4K, with
   the set's north plate (or first plate) as reference image 1 and the prompt
   in 5.2.
3. Crops it into four panels (5.3) and stores each as a still (R2 plus an
   asset row, as `generateStillCandidates` does), so the existing candidate
   strip, Preview and `chooseSetPlateAction` work unchanged.
4. Returns four candidates, each tagged with its direction. Choosing one
   records a plate with that direction (`chooseSetPlateAction` already takes
   `view`).

The north panel is offered too: the owner may keep it in place of an original
that looks rendered, or skip it.

### 5.2 The sheet prompt

Written positively, with the grid stated before the room:

```
A 2x2 contact sheet of four photographs of one room, <set name>, separated by
thin white borders of equal width, each panel 16:9. All four show the same
room at the same moment in the same light, each taken at eye level with a
35mm lens from the middle of the opposite wall.
Top left: facing north, the view in reference image 1.
Top right: facing east.
Bottom left: facing south.
Bottom right: facing west.
The room: <inventory, or the Look line when the inventory is empty>.
<house photograph line, section 7.1> <Brand Kit anchors>
```

Reference image 1 is labelled "<set name> facing north. Use it for the room's
furniture, materials and light." (the adapter's `referenceLabel`, section 6.4).

### 5.3 Cropping

`splitContactSheet(bytes)` in `apps/web/lib/contact-sheet.ts`, using `sharp`
(already a dependency of the web app):

- Reads the image as greyscale; looks for a horizontal and a vertical band of
  at least 4 pixels, each in the middle 40 to 60 per cent of the image, whose
  mean luminance is at least 235. Trims a matching outer border if present.
- Crops the four rectangles inside the bands and returns them as PNG with
  their direction.
- If either band is not found, returns `null`. The action then answers "The
  sheet came back without clear borders, so it was not split; build the set
  again." and never crops on a guess. (Amended while planning: the whole
  sheet is not offered as a candidate, because a 2x2 grid chosen as a plate
  would teach every later still of the room a grid.)

### 5.4 One view at a time

The decision 273/274 angle picker becomes a direction picker (North, East,
South, West, Detail) beside **Generate a view · ≈$0.07**, for filling or
redoing one direction. It is a normal still on the stills route at 1K,
carrying the set's plates chosen for that direction (section 6.2), the
inventory, and the camera sentence for that direction (section 6.3). Before a
set has a plate the picker is disabled with "Add a plate first, then build the
set from it." and the button reads **Generate a plate** as now.

## 6. Shots inside a set

### 6.1 The camera on a brief

`StillBriefSchema` gains an optional `camera`:

```ts
camera?: {
  facing: 'north' | 'east' | 'south' | 'west'
  position: string // 3 to 120 chars: "south doorway, seated eye height"
  lens?: string    // up to 40 chars: "35mm", "85mm, shallow focus"
}
```

- The shot-list prompt lists each set's inventory with its look in the
  cacheable prefix and requires `camera` on every still that names a set,
  varying facing and position across a chapter's shots of one room. The
  existing rule "two stills of the same room never share a camera position"
  stays, now checkable.
- `parseShotList` keeps a brief whose camera is missing or malformed and drops
  the camera, so an older or careless reply still plans.
- The House Visual Bible's set section is rewritten to match: the plates and
  inventory are the room, the camera is the brief's, and the camera is placed
  physically (position, height, facing, lens), never by an angle name.

### 6.2 Which plates travel

`platesForCamera(set, facing, limit)` in `packages/schemas/src/sets.ts`:

1. the plate facing the same direction;
2. then a plate facing an adjacent direction (for north: east, then west);
3. never the opposite direction's plate, which shows what is behind the
   camera;
4. then `detail`, then `other`.

With no camera (an older brief), the current `referencePlates` order applies,
with `north` in the place of `establishing`. A set with only its first plate
sends that plate either way.

### 6.3 The prompt ending

`withReferenceClause` (decision 273) is rebuilt for a set shot with a camera:

```
References attached: 2 photographs of Emad Mostaque and 2 of <set>.
The photographs of Emad Mostaque are for likeness only: ...          (unchanged)
Emad Mostaque is photographed in the scene, never pasted onto it: ... (unchanged)
The camera stands at <position>, facing <facing>, <lens>.
In frame: <that wall's line>. At the edges: <the two adjacent walls' lines>.
Centre: <centre line>. Light: <light line>.
Behind the camera, out of frame: <opposite wall's line>.
The photographs of <set> show this room's furniture, materials and light;
this photograph is a new one from the camera above.
```

- The words "never reproduce or edit the framing" go.
- Without an inventory, the in-frame lines are omitted and the camera
  sentence stays. Without a camera, decision 273's ending is kept.

### 6.4 Image labels

The Gemini adapter's `referenceLabel` (decision 273) gains the direction for a
plate: "Reference image 2 of 3: The boardroom facing north. Use it for the
room's furniture, materials and light." `ImageReference` gains an optional
`facing`. fal has no per-image text; its prompt ending already names the
plates in order.

### 6.5 The board override

A still slot whose brief names a set shows a **Camera** row on its card:

- four buttons North, East, South, West (the current one pressed), a
  **Position** input and a **Lens** input, and **Save camera**;
- saving goes through `editBriefAction` (its patch schema gains `camera`),
  which changes the brief hash, so the slot owes work and **Regenerate**
  applies the new camera with the plates chosen for it;
- a brief with no camera shows the row empty with "No camera yet; set one, or
  re-plan."

### 6.6 The plan check

`craftFindings` gains a finding, graded `auto`: two stills in the same set
with the same facing and the same position after lower-casing and trimming.
The automatic repair and the Fix button handle it like the other auto
findings, and the repair prompt names the slots that share a camera.

## 7. Realism

### 7.1 The house photograph line

One constant, `HOUSE_PHOTOGRAPH`, in `packages/providers/src/prompts/direction-craft.ts`
(with its source in `direction-craft.md`, embedded as today):

> An available-light documentary photograph, 35mm, eye level, slight grain,
> mixed colour temperature from window daylight and warm practicals, real
> materials with wear: scuffed edges, cable runs, a coffee ring, papers out
> of line.

It goes on the plate prompt (`setPlateBrief`), the sheet prompt, and the still
template in the shot-list prompt, before the Brand Kit anchors. When a
camera's lens is given, the lens in the line yields to it.

### 7.2 Banned words

`BANNED_PROMPT_WORDS` gains `ultra-detailed`, `8k`, `4k`, `3d render`,
`cgi`, `octane`, `unreal engine`, `hyperrealistic` and `photorealistic`
(which averages towards a waxy look on Gemini). Plain `render` and
`rendered` stay allowed: they are ordinary verbs in a documentary prompt. They are stripped before the
image model by the existing `stripBannedWords`. `cinematic` is already there.

## 8. Models and settings

### 8.1 The Gemini adapter

- `generationConfig.imageConfig.imageSize` is sent: `1K` for stills and single
  views, `4K` for the sheet. `ImageGenRequest` gains `size?: '1K' | '2K' | '4K'`.
- For `gemini-3.1-flash-image`, reasoning is set to high. The exact field name
  and placement (`thinkingConfig.thinkingLevel` or similar) are verified
  against Google's live API reference before coding, per the project rule on
  model ids and parameters; the research found `thinking_level` with values
  `minimal` (default) and `high`.
- Prices become per size: 3.1 Flash $0.067 at 1K, $0.101 at 2K, $0.151 at
  4K; 3 Pro $0.134 at 1K or 2K, $0.24 at 4K; 2.5 Flash $0.039 at its one size.
  `imageGenPrice` takes the size, so estimates and the ledger stay exact.

### 8.2 The `setSheet` route

`modelRouting.setSheet` (a `StillRoute`), default
`{ provider: 'google', model: 'gemini-3-pro-image' }`, offered in Settings →
Models with the Google image models only (the grid and 4K are Gemini
features). Settings stored before this fold to the default. The single-view
button uses `modelRouting.stills`.

## 9. Cost

| Item | Price | When |
|---|---|---|
| Inventory draft | under $0.01 | first plate, or Redraft |
| Set sheet | about $0.24 (3 Pro, 4K) | Build the set |
| One view | about $0.07 (3.1 Flash, 1K) | Generate a view |
| Still | about $0.13 (2 x $0.067) | per still, up from about $0.08 on 2.5 |
| A 53-still film | about $7 in stills | up from about $4 |

Every button shows its estimate before it is pressed, from the live adapter's
price for the route and size, as now. Every paid call runs inside `withCost`.

## 10. Failure behaviour

- Sheet cannot be split: the action answers with the message in 5.3; the
  spend is on the ledger and nothing is cropped on a guess.
- Refusal or provider error: shown as the Set card shows any failed generation
  today ("That did not work" with the provider's words).
- Inventory draft fails: field left empty with the note in 4.2; Build the set
  still works from the Look line.
- A camera names a direction the set has no plate for: the nearest plates by
  6.2 travel and the inventory carries the rest.
- A brief with a malformed camera: the camera is dropped at parse; the shot
  plans without it.
- Old plates and old briefs: read through the view preprocess and the
  no-camera path; nothing is migrated except the new `layout` column.

## 11. Data changes

- `project_sets.layout text not null default ''` (one Drizzle migration).
- `SetPlateSchema.view`: compass values, legacy names preprocessed.
- `StillBriefSchema.camera` optional.
- `modelRouting.setSheet` with default.
- `MAX_SET_PLATES` 6.

## 12. Testing

All mocked; nothing spends.

- `splitContactSheet`: synthetic sheets built with `sharp` (clean gutters,
  gutters plus an outer border, no gutters, off-centre gutter) return four
  panels of the right size, or null.
- `platesForCamera`: each facing with full, partial and single-plate sets;
  never the opposite plate; no-camera fallback.
- Legacy view preprocess: `establishing`, `reverse`, `side` read as north,
  south, east.
- `parseLayout` and the prompt ending: in-frame, edges, behind lines for each
  facing; no inventory; no camera.
- Gemini adapter: `imageSize` per request, reasoning field for 3.1 Flash only,
  labels carrying direction, per-size prices.
- Shot-list prompt and parser: inventory in the prefix, camera required on set
  stills, malformed camera dropped.
- `craftFindings`: shared camera finding, graded auto, repaired.
- Set actions (DB): inventory drafted once on the first plate and never
  overwriting; Redraft; Build the set stores four candidates with directions;
  unsplittable sheet returns one; single view carries the chosen direction.
- Set card and visual board components: Room inventory field and Redraft
  confirm; Build the set with estimate; direction picker; Camera row saves
  through `editBriefAction`.
- Settings: `setSheet` route default and fold-forward; the Models tab row.

## 12a. The live set harness (added 2026-09-24 at the owner's request)

"I want you to be able to do single set tests, with permission to use costs to
test a set, and then test how it translates to a shot ... just ensure that
spend doesn't exceed $1 per test. Then it must ask for my approval."

A command-line harness, `pnpm --filter @boom-busters/web live:set`, runs the
real path against Gemini outside the app: inventory draft, the 4K contact
sheet, the split, and one still in the set from a given camera. It writes
every image, prompt and cost to a run folder for review. A budget guard
reserves each call's estimate before it is made and refuses any call that
would take the run past $1 (a `--cap` below $1 is allowed, above is not
without the owner). A typical run costs about $0.32. It needs
`GEMINI_API_KEY` in `.env.local`, never prints it, touches no database, and is
never part of `pnpm test` or `pnpm e2e`. The review-and-improve loop runs it
after the branch is reviewed.

## 13. What the owner verifies

One real run on the boardroom: Build the set (about $0.24), keep the panels,
then regenerate two or three boardroom stills with different cameras (about
$0.13 each). Before that, switch Settings → Models → Stills to Gemini 3.1
Flash Image.

## 14. Unverified, to settle during implementation

- The Gemini 3.1 reasoning field's exact name and placement (live API
  reference).
- How much reasoning on high helps camera placement: judged on the owner's
  run, not assumed.
- How cleanly Gemini 3 Pro draws uniform gutters at 4K: the splitter refuses
  rather than guesses, so the cost of a miss is one redo.
