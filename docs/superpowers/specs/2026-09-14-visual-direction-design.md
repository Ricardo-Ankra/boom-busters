# Visual direction: a house bible and a per-film director's book

Approved in principle by the owner, 2026-09-14 (approach 1 of three). Extends
build-spec section 7.4's visuals-runner and section 11.3's visual board, and
the teaser studio of decision 231. The five pipeline gates are untouched.

## Problem

The shot list is planned one chapter at a time by Haiku from a 40-line prompt
and a one-sentence style anchor derived from the Brand Kit. Nothing tells the
model what the film as a whole should look like, so eight chapters are eight
independently imagined films: the era drifts, motifs never recur, the same
shot size runs for a minute, and every still prompt re-invents its own grade.
Hero (AI video) briefs have no prompt discipline at all, and the teaser
studio's still prompts carry no direction beyond the beat's own words.

The visual bar the channel is aiming at is the Netflix money-documentary
register, delivered almost entirely through AI stills, charts, motion
graphics, stock and (later) AI video, because real archival footage is
expensive to license. That register is a set of learnable rules, and the
rules belong in the prompt, not in the owner's head at review time.

## Research summary

Nothing published fits as-is. Every Claude skill found for AI filmmaking is
written for fiction with actors and free-form prompts; none knows about typed
briefs, claim-sourced charts, a renderer with a fixed motion vocabulary, or
an archival-poor format. Three sources hold craft this design absorbs, with
attribution where the licence requires it:

- smixs/visual-skills (CC BY 4.0, Serge Shima): the three-physical-facts
  audit, the banned-word list, one move and one action per clip, the named
  final image, the montage staircase.
- DirectorSKILL (MIT): a director's book of invariant clauses pasted verbatim
  into every prompt; the "S2" full-description video prompt shape.
- Black Forest Labs official FLUX skills (MIT) and Google's Imagen and Veo
  guides: prose in Subject, Action, Style, Context, Lighting, Technical
  order; no negative prompts on FLUX; lighting has the biggest single effect;
  hex colours beside colour names; Imagen wants subject, context, style with
  lens and proximity words.

## Design

### 1. Two layers of direction

**The House Visual Bible is fixed.** It is a markdown file,
`packages/providers/src/prompts/direction-craft.md`, embedded as the constant
`DIRECTION_CRAFT` exactly as `script-craft.md` is (decision 216), with the
same byte-identity unit test so editing the markdown without re-embedding
fails CI. It sits below the hard rules (claims, legal hedges) and above
taste. Sections:

1. *The house look.* Netflix money-documentary register: dark, patient,
   photographic realism; empty rooms after the people have left; documents,
   hands, screens, glass and reflections; slow push-ins; restraint over
   spectacle. Grade and grain come from the Brand Kit tokens, as today.
2. *Shot grammar for a film made of stills.* Shot sizes (wide, medium, close,
   macro, aerial, graphic) and what each is for; a slot must change emotion,
   advance the story or raise pressure, or it is filler; no three adjacent
   slots at the same size; a paragraph that cites a number wants a chart at
   the number, not after it; stills and stock alternate rather than cluster;
   the montage staircase (long, shorter, shorter, pause, impact) inside a
   paragraph; every chapter builds to one image.
3. *What a still prompt must contain.* One photographable moment; three
   physical facts (an environmental pressure, a human trace, a motif from the
   director's book); the FLUX order (subject, action, style, context,
   lighting, technical); lens and light named; the book's invariant clauses
   appended verbatim; nothing from the banned list ("cinematic", "stunning",
   "dramatic lighting", "high quality", emotions named without a body).
4. *Motion the renderer can actually do.* Static, Ken Burns in or out at
   three speeds. "pan" is compiled as a push-in today, so the direction never
   asks for one; when the renderer grows a real pan the bible changes, not
   the model's habits.
5. *Per-model prompt recipes.* FLUX family (prose, no negatives, hex
   colours), Imagen 3 (subject, context, style; person generation on),
   Gemini image (prose with the same anchors), and hero video in the S2 shape
   for Veo 3.1 or Kling: format, subject with identity, place and era, one
   primary action with an end state, shot size and lens and one camera move,
   light, composition, constraints. Duration 5 to 8 seconds, one move, one
   action, a named final frame.
6. *People.* See section 5.
7. *Pre-flight checklist.* The model checks its own list before answering:
   every paragraph covered, sizes vary, motifs recur, era locks obeyed, the
   chapter's key image present, no banned words, every real person carries
   the guardrail clause.

**The Director's Book is per film.** It decides only what legitimately varies
between films and is generated once, after voice approval and before the
chapter shot lists. Schema (`packages/schemas/src/direction.ts`,
`DirectorsBookSchema`):

```
visualThesis        one or two sentences: what this film looks like and why
eraLocks[]          { span: "1995 to 2008", rules: "CRT monitors, paper ledgers, ..." }
palette             { accent: hex within the house range, temperature: cold|neutral|warm, note }
motifs[3]           exactly three recurring visual motifs
anchorObject        the one object the film keeps returning to
neverShow[]         this story's exclusions (beyond the house list)
principals[]        { name, role, depiction: likeness|anonymous|archival-only,
                      identityString, guardrail }
locations[]         { name, look }
chapters[]          { chapterId, dominantShotFamily: environment|document|human|
                      data|map|object, moodShift, keyImage }
finalImage          what the viewer carries out of the film
```

`identityString` is the clause pasted verbatim into every prompt that shows
that person (DirectorSKILL's invariant). `guardrail` is the per-person
depiction rule from section 5. The book is stored on the project row
(`projects.direction` jsonb, nullable) and shown at the top of the plan
screen.

### 2. Generating the book

A new prompt module `packages/providers/src/prompts/direction.ts` with
`buildDirectorsBookRequest`, `parseDirectorsBook` and `mockDirectorsBook`.
Inputs: case title, the outline's `centralQuestion` and per-chapter
`withhold` fields (from `scripts.outline`), every chapter's paragraphs, the
claim list, the Brand Kit style anchors, and `DIRECTION_CRAFT`. One call per
film; the output is validated by the schema, and a malformed answer retries
like every other prompt.

A new LLM task `direction` joins `LLM_TASKS` and `ModelRoutingSchema`, default
Sonnet (one call per film; the book is the highest-leverage prompt in the
picture department, so it gets the drafting tier, not the mechanical one).
The routing field carries a schema default so stored settings without it
still parse; the Settings form gets the label "Visual direction".

In the visuals-runner a step `directors-book` runs after `load-narration`.
If the project already holds a book (a re-run of the stage after the owner
edited it), the stored book is used and nothing is called; otherwise the
model drafts one and it is saved before the chapter loop starts.

### 3. The shot list consumes both layers

`buildShotListRequest` gains a `direction` input. The system prompt embeds
`DIRECTION_CRAFT`; the book, rendered as plain text, joins the claim list in
the cacheable prefix (identical for every chapter of one film). Rule changes
in the prompt itself:

- Still `prompt` follows the FLUX order and ends with the palette,
  grain and the relevant `identityString`s verbatim. `negativePrompt` is
  still emitted (Imagen uses it; FLUX and Gemini fold it in, as today).
- Every brief carries an optional `shotSize` (wide|medium|close|macro|aerial|
  graphic) in the common fields. Optional so stored rows keep parsing; the
  board shows it as a small chip.
- Still and hero briefs carry an optional `depicts: string[]`, the real
  people shown by likeness. This is what the label and the refusal fallback
  key on.
- Hero briefs, still gated behind `HERO_SLOTS_ENABLED`, are written in the S2
  shape so the future adapter needs no prompt work.

A pure `planWarnings(slots)` in the schemas package reports craft misses the
model let through: three adjacent slots at one size, a chapter without its
key image's family, a still prompt containing a banned word. Warnings are
appended to the plan park summary and shown on the plan screen. They never
reject a slot.

### 4. The plan screen

The plan-phase card grows a **Direction** section above the shot plan: the
book's fields as labelled text areas (lists one item per line), with
**Save direction** and two model-backed buttons:

- **Redraft direction · est. $** re-runs the book prompt and replaces the
  stored book (the owner's edits are lost, and the confirm says so).
- **Re-plan shot list · est. $** regenerates every chapter's slots from the
  saved book. Slots already fetched during plan review are discarded, and
  the confirm says how many.

Both go through a new Inngest function `visuals-replanner`
(`visuals/replan.requested`, `op: 'direction' | 'shots'`, singleton per
project, cost-guarded like every model call). The parked visuals-runner is
untouched: it re-reads the slots when the plan is approved, exactly as the
staged-visuals design already requires. The per-chapter planning code moves
out of the runner into a shared `planShotList` helper both functions call.

### 5. People: likenesses, the guardrail, the label, the fallback

Owner's decision, 2026-09-14: real principals may be depicted by likeness,
the video carries YouTube's altered-content label, and the direction guards
against defamation and mockery.

Noted and accepted by the owner: Black Forest Labs' usage policy forbids
likenesses of public figures without consent and Google's image models
refuse named people in practice, so a share of likeness prompts will be
refused. The fallback below is how that share is handled.

**The guardrail, in the bible and in every prompt that names a person:**

- Depict people only in documentary-neutral situations the claims support:
  a press conference, a courtroom corridor, an office, a car, a doorway.
  Never in an invented act that implies guilt: no cash changing hands, no
  shredders, no handcuffs, no scenes that did not happen.
- No exaggeration of features, no ageing or deforming, no expressions of
  malice or stupidity, no caricature, no costume that mocks. Neutral to
  sombre expression, natural posture, period-correct dress.
- The mood is carried by environment and light, never by the face.
- Every person shown by likeness is listed in `depicts`.

The director's book writes one `guardrail` line per principal (for example
"shown only at podiums and in corridors; never at a desk with documents") so
the rule is specific to what the claims establish.

**The label.** The publish stage already knows which stills were chosen.
When any chosen still or hero clip has a non-empty `depicts`, the upload job
sets `status.containsSyntheticMedia: true` on the YouTube video, and the
Publish screen states "AI likenesses of real people: the altered-content
label is set" above the schedule button. This adds one boolean to the
media-utils upload job and a Lambda redeploy; if the redeploy is not wanted
in this pass, the Publish screen reminder ships alone and the box is ticked
in Studio.

**The refusal fallback.** The image adapters learn to recognise a policy
refusal (Gemini's empty response, fal's safety-checker and content-policy
responses) and throw a typed `PolicyRefusalError`. The fetch resolves such a
slot to `placeholder` and stores `refusal: { reason, at }` on the row instead
of failing the batch. The card then reads "The image model declined this
person" and offers two buttons, in this order:

1. **Redirect the scene · est. $**: one shot-list-model call that rewrites the
   still brief to the same beat without the likeness (anonymous figure, face
   turned or in shadow, or an environmental image of the same moment),
   keeping `coversText`, then fetches it. Reuses the slot-retyper's pattern.
2. **Upload a real image**: the existing own-upload flow, with the card
   showing the depiction brief above the dropzone: who it must show, in what
   setting and era, and what would make it unusable.

### 6. The teaser studio

`generateTeaserStill` appends the house anchors and a vertical framing clause
server-side (subject in the centre third, headroom for the hook text, clear
of the caption band), and the beat's default prompt is written in the FLUX
order. The stored teaser slot snapshots are unchanged.

## Data and contract changes

- `projects.direction` jsonb, nullable (migration 0021).
- `shot_slots.refusal` jsonb, nullable (same migration).
- `ShotBriefSchema` common fields: `shotSize?`, and on still and hero
  `depicts?: string[]`.
- `LLM_TASKS` adds `direction`; `ModelRoutingSchema.direction` with default
  Sonnet; settings label.
- New events: `visuals/replan.requested { projectId, op }`.
- New Inngest function `visuals-replanner`.
- `MediaJob 'upload-youtube'` gains `containsSyntheticMedia?: boolean`.
- Build spec section 7.4 amended in place with a dated note; PROGRESS.md gets
  the decision entry and the attribution note for the CC BY 4.0 source.

## Testing

- `direction-craft.test.ts`: byte identity with the markdown; the bible names
  the hard rules it sits under; the banned list and the guardrail clause are
  present.
- `direction.test.ts`: request assembly includes the outline fields, claims
  and bible; parse accepts a good book, rejects two motifs or a principal
  without a guardrail; mock book is deterministic.
- `shotlist.test.ts`: the book text is in the cacheable prefix; still prompts
  in fixtures carry the identity string; `shotSize` and `depicts` parse and
  are optional; `planWarnings` flags a same-size run and a banned word.
- Visuals-runner test: the `directors-book` step runs once, is skipped when
  a book is stored, and the shot-list requests receive it.
- Replanner test: `op: 'shots'` replaces slots; `op: 'direction'` replaces
  the book only.
- Adapter tests: a Gemini empty response and a fal policy body become
  `PolicyRefusalError`; the fetch marks the slot placeholder with a refusal.
- Component tests: the Direction section renders and saves; a refused card
  shows both buttons and the depiction brief.
- e2e (mock providers): plan screen shows the mock book, Re-plan replaces
  the slots, the refused-slot card offers the two ways out.

## Out of scope (deliberate)

- The hero video adapter and flipping `HERO_SLOTS_ENABLED`.
- A real pan in the renderer, or DepthFlow parallax.
- Editing the book as structured JSON; v1 is labelled text areas.
- Retro-fitting a book onto projects already past the visuals stage.
