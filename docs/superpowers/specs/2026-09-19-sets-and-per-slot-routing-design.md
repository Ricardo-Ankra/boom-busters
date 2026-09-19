# Sets, the reference budget, and per-slot routing

**Decision 264.** Drafted 2026-09-19 with the owner.

## The problem

A film re-uses its rooms. Emad Mostaque's office is the same office in
chapter one and chapter five, and a documentary that re-invents it every
time reads as a slideshow of stock offices rather than as one story.

Today it re-invents it every time, and the reason is mechanical. Each
still is an independent text-to-image call carrying words. Words carry a
genre of room, never a room. On the live Stability AI plan the same
boardroom prompt was generated three times inside six minutes and
produced three different boardrooms.

The Director's Book already names the rooms. That film's book holds three
locations, each with a paragraph of look: Stability AI London
Headquarters, Cloud Computing Data Center, Venture Capital Boardroom.
They are rendered as prose into every chapter's planning prompt. Nothing
carries a pixel of them into the image model, because every mechanism
that carries pixels is keyed to a person's name through `depicts`.

Two smaller problems are in the same code and are fixed with it.

The reference budget is one pool of three, spent on people. It was
written for Gemini 2.5 Flash Image, whose limits Google does not
document. The 3.x models document two separate budgets, characters and
objects, several times larger.

The route is decided at generation time from global settings, so the only
way to send one shot to a different model is to move every shot.

## What we are building

A **set** is a place the film returns to, held as reference plates, named
by a brief, and conditioned on when that brief is generated. It is the
cast's twin in every respect that matters: a project-scoped library, a
card beside the Cast card, a name that joins a brief to it, plates that
ride along with the prompt.

Alongside it, the reference budget becomes two pools with per-model
limits, and every still slot carries the route it will be generated on,
chosen by rule when the shot list is planned and changeable by the owner
on the board.

## 1. The set library

### Naming

The book calls them `locations`; the app calls them sets. This is the
same split the cast already lives with: the book names `principals` and
the app holds `cast_members`, seeded from them. The book keeps its own
vocabulary because its field is stored on every existing project, and
`MapBrief.locations` already means geographic pins, which these are not.

### Data model

New table `project_sets`, migration 0026:

```
id            text primary key
project_id    text not null references projects(id) on delete cascade
name          text not null          -- the join key a brief's "set" names
look          text not null default ''  -- the book's look line, editable
plates        jsonb not null default '[]'
dismissed_at  timestamptz            -- as cast_members: a removed set stays
created_at, updated_at
unique index on (project_id, name)
```

`SetPlateSchema` in `packages/schemas/src/sets.ts`, shaped on
`CastPhotoSchema` so the upload path is shared:

```ts
r2Key        // boom-busters/sets/<projectId>/<contentHash>.<ext>
contentHash
mimeType     // the three CAST_PHOTO_MIME types
width, height
view         // 'establishing' | 'detail' | 'other'
origin       // 'uploaded' | 'generated'
sourceUrl?   // provenance for an uploaded plate
```

`MAX_SET_PLATES = 4`, as for a cast member. `referencePlates(set, limit)`
orders establishing views first, mirroring `referencePhotos`.

`origin` exists because a generated plate and a found photograph are
different things to the owner: one is the film's own invention and safe
to regenerate, the other is evidence they chose.

### Seeding

`seedSetsFromLocations(db, projectId, locations)` runs where
`seedCastFromPrincipals` runs, in `draftDirectorsBook`. Same rules: skip
a name already taken live or dismissed, `onConflictDoNothing`, never
resurrect a set the owner removed.

So drafting the book gives you the three sets with their look text and no
plates, exactly as it gives you three cast members with no photographs.

### Where plates come from

Two paths, both on the Set card.

**Upload**, reusing the cast photo actions unchanged in shape: a
presigned PUT for a local file, and a server-side fetch for a web
address. A real photograph of a real building is better than anything we
can invent, so this path is first.

**Generate a plate.** One button, priced on its face like the cast card's
"Describe from photos". It builds a still prompt from the set's `look`
plus the Brand Kit anchors, generates `STILL_GENERATIONS` variants
through the same generator every still uses, and the owner picks one. The
picked image is stored as a plate with `origin: 'generated'`.

It generates on `modelRouting.stills` and is billed through `withCost`
like any other image call, so a plate appears in the ledger and counts
against the monthly ceiling.

This is the path that makes sets work for a film about a company whose
offices nobody photographed. It costs one generation per set, once, and
every later shot in that room is conditioned on it.

### The Set card

Beside the Cast card on the project page, from the visuals stage onward,
open by default while any set has no plate. Per set: name, look, the
plate grid with per-plate remove, Add plate, Generate a plate, Save,
Remove set. One Add set form.

It is the Cast card's structure with different nouns, deliberately, so
there is one thing to learn.

## 2. The brief names a set

`StillBriefSchema` and `HeroBriefSchema` gain:

```ts
set: z.string().min(1).optional()   // the exact set name, alone
```

The shot-list prompt lists the film's sets in the cacheable prefix the
way it lists photographed people, and the rule is the same shape:

> Sets are the rooms this film returns to. When the sentence puts us in
> one, name it in "set" by name alone, and describe the shot inside it:
> what the camera sees, who is there, what they are doing. Do not
> re-describe the room; the photographs are the room.

The join is `nameMatches(entry, name)`: decision 262's `depictsName`
renamed, with `depictedMembers` kept as the cast wrapper and `setForBrief`
added as the set one. One matcher, two joins, so a planner that
writes "Venture Capital Boardroom, the meeting room" cannot silently
produce an unconditioned still the way it did for people on 2026-09-19.

A brief naming a set the project does not hold is not an error. It
generates as a plain still, and `planWarnings` notes it on the plan
screen, the same way a `depicts` name with no photograph is noted.

### Discipline

Decision 260 exists because a rule that put a motif in every frame put
twelve empty chairs in one chapter. A set carries the same risk, so:

- The bible gains one line: a brief names a set when the sentence puts us
  in that room, never to decorate a shot that happens somewhere else.
- `planWarnings` counts sets per chapter and notes a set used in more
  than half a chapter's picture briefs, and a set in two adjacent slots.

## 3. The reference budget

### Two pools

Google documents the two separately, and they map onto what we have:
cast photographs are characters, set plates are objects.

| model | characters | objects |
| --- | --- | --- |
| gemini-3.1-flash-image | 4 | 10 |
| gemini-3-pro-image | 5 | 6 |
| gemini-2.5-flash-image | not documented | not documented |

`GEMINI_MAX_REFERENCES = 3` is replaced by
`referenceLimits(modelId): { characters: number; objects: number }` on
the provider. An undocumented model keeps today's conservative 3 in
total, split 3 and 0, because guessing a limit spends money to find out.

The app's own policy sits under the model's: at most 3 character photos
and at most 2 set plates in one still. Ten object references buys nothing
for a room and lengthens every request.

### How the budget is spent

1. People in the frame, one front view each, in cast order.
2. One establishing plate for the named set.
3. Whatever character slots remain, round-robin over further angles of
   the same people, as today.
4. One further set plate if an object slot remains.

People first because a wrong face is worse than a wrong room, and a
likeness is the thing a viewer recognises.

### The prompt clause

`withReferenceClause` gains the set: "Emad Mostaque, the person in the
reference photo, in Stability AI London Headquarters, the room in the
reference photograph." The model is told which image is which, because
the adapter sends flat inline parts and only the prompt can label them.

### fal

Unchanged in mechanism. Set plates become more `referenceUrls`, which
moves the call to the reference endpoint exactly as cast photos already
do, and `referenceRoute` already prices by count. fal stays available for
one-off shots; it is not where the film's continuity lives.

## 4. Per-slot routing

### The route is chosen when the shot list is planned

A new column `shot_slots.route jsonb` holding `{ provider, model }`,
null until decided.

After a chapter's slots are parsed, each still and hero slot gets a route
from `routeForBrief(brief, cast, sets, routing)`:

| the brief | route |
| --- | --- |
| names a photographed cast member | `modelRouting.stillsLikeness` |
| names a set that holds a plate | `modelRouting.stillsLikeness` |
| neither | `modelRouting.stills` |

`modelRouting.stillsLikeness` is null by default and stays null, which
means every row of that table resolves to `modelRouting.stills` and the
split only exists for an owner who configures one. A set-conditioned
still takes the likeness route when there is one because that route is
the reference-capable one, not because a room is a likeness. The setting
keeps its name; its doc comment gains the second reason.

### The owner changes it

The brief editor on the board gains a model select listing every model
both image providers offer, with the current route selected and the
derived route marked as the default. Changing it writes
`shot_slots.route`.

Three things follow the stored route or the control is decorative:

- `generateStillCandidates` prefers `slot.route` over the derived route.
- `stillsEstimateUsd` prices each slot on its stored route.
- The resolution hash covers the route, so changing the model marks the
  slot as owing work and the next fetch actually regenerates it. Without
  this the owner changes the model, presses Fetch, and nothing happens.

A re-plan rewrites briefs and routes together. An override does not
survive a re-plan, and the plan screen says so where it offers one.

### Defaults

The shipped default for `modelRouting.stills` moves from
`gemini-2.5-flash-image` to `gemini-3.1-flash-image`, and
`stillsLikeness` stays null. Everything then generates on one model that
takes both kinds of reference, and the per-slot control handles the
exceptions: Gemini 3 Pro Image for a shot that has to hold a face, fal
for a one-off that needs nothing conditioned.

A project already configured keeps what it has. The live project is on
fal for stills and Gemini 2.5 for likenesses, and moving it is one change
in Settings, the owner's to make.

Cost at two variants per slot, for a 48-still film:

| routing | per slot | per film |
| --- | --- | --- |
| today, flux-2 mixed with 2.5 flash | about $0.05 | $2.24 |
| all gemini-3.1-flash-image | $0.14 | $6.72 |
| all gemini-3-pro-image | $0.30 | $14.40 |

## 5. What this does not do

- **No cross-film set library.** The table is project-scoped, like the
  cast. A channel-wide library is a later decision.
- **No automatic set assignment for existing plans.** A plan drafted
  before this names no sets. Re-plan, or name them by hand in the brief
  editor.
- **No set continuity check.** Nothing verifies that the generated image
  resembles the plate. The owner's eye on the board is the check, as it
  is for likeness.
- **No change to the headline card, charts, maps or stock.** Sets are a
  still and hero concern.

## 6. The risk worth testing first

The fal reference endpoints are edit endpoints, and Gemini's behaviour
with an object reference is not something the docs settle. Conditioning
on a room plate may return the plate with small changes rather than a new
camera angle in that room.

One paid probe answers it: take a real plate, ask for three different
shots inside that room on `gemini-3.1-flash-image`, and look at them.
Roughly $0.21. If the model re-photographs rather than re-stages, the
prompt clause has to name the camera move explicitly and the bible needs
a line about it, which is cheaper to learn now than after the board is
built around it.

This needs the owner's go-ahead, because development calls no paid API
without one. The build does not block on it: without the probe the
prompt clause ships as specified above, and the answer only changes
wording, never the data model or the budget.

## 7. Testing

- **Schemas.** The set shapes, the plate cap, `nameMatches` against the
  cast and set joins, `referencePlates` ordering.
- **DB.** The set functions, the unique name per project, revival of a
  dismissed set, `seedSetsFromLocations` skipping taken names, the route
  column surviving a brief edit.
- **Providers.** `referenceLimits` per model, the Gemini adapter refusing
  a fourth character or a third object before spending, the prompt clause
  naming both kinds, the shot-list prompt listing sets.
- **Web.** The budget split across people and plates, routing by rule,
  the stored route winning over the derived one, the estimate pricing on
  the stored route, the hash covering the route, the set actions in mock
  storage mode, the Set card, the model select.
- **e2e.** Add a set, upload a plate against mock storage, see it on the
  card; change a slot's model and see the estimate move.
