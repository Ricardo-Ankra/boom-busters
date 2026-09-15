# Cast references: real faces in generated stills

**Date:** 2026-09-15. **Status:** draft for review. **Follows:** decision 252
(visual direction), specifically its People section.

## Problem

The Director's Book and every still prompt now name the real person shown
("Emad Mostaque, founder and former CEO of Stability AI") and the image
still does not look like him. Text-to-image models reproduce only the faces
they memorised in training, which in practice means heads of state and film
stars. For everyone else the name resolves to "a man matching the
description" and the model invents a face. Both stills routes send text
only: the fal adapter sends a prompt and a negative prompt, the Gemini
adapter sends one text part. Neither is ever shown a picture of the person.

Two smaller faults compound it. The identity string the book wrote carried
no face ("dark blazer over a plain t-shirt"), so even a model that partly
knew the person got no help. And the bible told the planner to quote the
guardrail line inside the image prompt, so every still of a principal ends
"never in handcuffs; never mocked; never shown with a gavel". Image models
handle negation badly; each of those phrases raises the odds of the thing it
forbids.

The channel will make many stills, and later video, of the same people
across a film. A face has to be uploaded once and used everywhere, and the
place it lives must survive the plan phase, because the Direction card is
gone once the board is fetched.

## What good practice looks like

Drawn from the reference-image guides for Gemini 2.5 Flash Image, FLUX
Kontext and Veo 3.1, and from the consistent-character workflows the
community has converged on:

- **Condition on photographs, not descriptions.** A likeness comes from one
  to four reference photos passed to the model with the prompt. The text
  names the person and says "the person in the reference photo"; it does
  not try to describe the face the photo already shows.
- **Two to four photos, chosen for identity.** A frontal head-and-shoulders,
  a three-quarter view, optionally a profile and one full-length for build
  and typical dress. Even light, neutral expression, no sunglasses or hat,
  the face at least 512 px across, taken in the era the film covers. Fewer
  good photos beat many mixed ones.
- **The same set every time.** Consistency across shots comes from the
  identical reference set on every call, not from a seed. The set is fixed
  per person per film.
- **Change the scene, not the face.** Prompts vary clothing, place, light
  and posture freely; they never add facial descriptors that could
  contradict the photo.
- **A text backstop.** An identity string written from the photos (face
  shape, hair, beard, glasses, build, typical dress) is kept for models
  that ignore references and for the planner's own reasoning. It is a
  backstop, not the mechanism.
- **Rules for the planner stay with the planner.** Negative constraints on
  people belong in the shot list's reasoning and, where a model has one, in
  the negative prompt as concrete objects. They never appear as prose in
  the positive prompt.
- **Multi-person shots are the exception.** Gemini accepts up to three
  input images; fal's multi-reference Kontext accepts several. A frame with
  two principals sends one photo each. More than three people in one frame
  is planned as an anonymous group.

## Design

### 1. The cast lives on the project

A project gets a **cast**: one entry per real person the film shows, with
their photos. It is its own table and its own card, not part of the
Director's Book, so it exists from the script stage onward and stays through
plan, board, assembly, shorts and publish. The book's principals and the shot
list's `depicts` refer to cast members by exact name.

Per-project rather than channel-wide was the producer's choice: the same
person in a second film is uploaded again. The table is shaped so a
channel-wide library can sit above it later (a cast member has no field that
would not apply to a shared entry), but nothing in this design builds that.

```
cast_members
  id              text pk (ulid)
  project_id      text fk projects, cascade
  name            text not null           -- exact full name; the join key for depicts and principals
  role            text not null           -- "Founder and former CEO, Stability AI"
  identity_string text not null default ''
  guardrail       text not null default ''
  photos          jsonb not null default '[]'   -- CastPhoto[]
  created_at, updated_at
  unique (project_id, name)
```

```ts
CastPhotoSchema = {
  r2Key: string,          // boom-busters/cast/<projectId>/<contentHash>.<ext>
  contentHash: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
  width: number, height: number,
  view: 'front' | 'three-quarter' | 'profile' | 'full' | 'other',
  sourceUrl?: string,     // where the producer found it; provenance, not licence
}
CastMemberSchema = { id, projectId, name, role, identityString, guardrail, photos: CastPhoto[] (max 4) }
```

Photos are the producer's uploads and are used only as conditioning input.
They are never placed in the timeline, never rendered in the output, and
never fetched from a provider. The altered-content label logic is unchanged:
a generated likeness is still synthetic media.

### 2. The Cast card

Mounted on the project page above the stage screens, visible from the
script stage onward, collapsed to a row of faces once the cast has entries.
Button-first, like everything else.

- **Add person**: name and role. Saves immediately.
- **Per person**: up to four photo tiles with an empty tile that opens the
  file picker. Each tile shows the view it was tagged as (front, three
  quarter, profile, full). Upload goes through the presigned PUT pattern
  the board's "Upload a real image" already uses (create, PUT, finalise),
  under a new key prefix. Finalise records width, height and content hash.
- **Guidance text under the tiles**, short: "One clear front view is
  enough. Two to four help: three-quarter, profile, full length. Even
  light, no sunglasses, the face at least 512 px wide, from the years the
  film covers."
- **Identity string** and **guardrail**: text areas, editable, saved on
  blur. After the first photo finalises, "Describe from photos" runs
  automatically once and fills the identity string; the button stays for
  re-runs. Cost line: "≈$0.02".
- **Remove person** with a confirm, and remove photo per tile.
- The card says, once, where the faces go: "Photos are sent to the image
  model as references so generated stills show this person. They are not
  placed in the video."

### 3. Identity strings written from the photos

A new prompt module, `cast-identity.ts`, on the `direction` task (Sonnet by
default). Input: the person's name, role, and the photos as image parts.
Output: one identity string of at most 60 words covering face shape, hair,
beard or none, glasses or none, apparent age range, build, and typical
dress; and a one-line guardrail seed, which is the bible's standard
defamation and mockery exclusions, for the producer to trim. The model is
told not to infer character, health, ethnicity beyond what is visible, or
anything not in the frame.

This needs the LLM layer to carry images. `Msg` gains
`images?: { mimeType, data }[]` (base64). The Anthropic adapter emits image
blocks before the text block; the Google adapter emits `inlineData` parts;
the OpenAI adapter emits `image_url` data URIs. The router passes them
through untouched. Every other prompt is unaffected because the field is
optional.

### 4. The Director's Book knows the cast

`buildDirectorsBookRequest` gains `cast: { name, role, identityString }[]`.
The prompt lists them as "Cast, already photographed" and requires one
principal per cast member with the exact name and `depiction: "likeness"`,
copying the identity string verbatim; the model may add principals the cast
does not cover (people the claims name but nobody uploaded), and those get
the bible's default rules. `parseDirectorsBook` accepts a `castNames`
argument and reports, as a plan warning rather than a rejection, any cast
member the book left out.

Redrafting the book after the cast changes is the producer's button, as
today. Saving the book never edits the cast; the cast is the source for
names and identity strings, the book adds the per-film guardrail and
depiction.

### 5. The shot list stops quoting the guardrail

Bible and shot-list prompt change together:

- The guardrail governs what the planner may write; it is never pasted into
  the image prompt. The pre-flight line becomes "no guardrail text appears
  in any prompt".
- A prompt showing a cast member names them and says "the person in the
  reference photo": "Emad Mostaque, founder and former CEO of Stability AI,
  the person in the reference photo, seated at a desk...". The identity
  string follows as one sentence. Clothing may be varied by the prompt;
  facial descriptors are not added.
- `negativePrompt` is for objects ("no gavel, no handcuffs, no cash"), and
  only on models that have the field; on FLUX it folds into the existing
  "Avoid:" clause. The guardrail's nouns may be turned into that list; its
  sentences may not be quoted.

### 6. Generation carries the photos

`ImageGenRequest` gains
`references?: { name: string; mimeType: string; data: string }[]`, base64
bytes with the person's name for the prompt.

- **Gemini image adapter**: `contents[0].parts` becomes the reference
  images as `inlineData` parts followed by the text part. At most three
  references; the adapter refuses more before spending. No other change;
  the same model id.
- **fal adapter**: when references are present the call goes to an
  identity-conditioned FLUX Kontext endpoint with `image_url` (one
  reference) or the multi-reference variant with `image_urls`, using
  presigned R2 GET URLs valid for fifteen minutes. The exact ids are
  verified against fal's live catalogue with the producer's key before
  they are listed, per the fal adapter's own rule; the plan carries that
  step. Without references the adapter is unchanged.
- **`generateStillCandidates`**: for a still whose `depicts` names cast
  members with photos, it loads the first photo of each (front view
  preferred), builds `references`, and prepends the "person in the
  reference photo" clause if the planner forgot it. Slots that depict
  nobody, or people not in the cast, generate exactly as today. The
  refusal fallback is unchanged: a `ContentPolicyError` still becomes a
  placeholder with Redirect and Upload.
- **Cost**: the Kontext endpoints price above FLUX dev; the registry
  carries their per-image price and the cost guard reserves against it.
  Gemini's price is unchanged.

The teaser studio's still generation goes through the same function and
gets references for free.

### 7. Hero video, later

Veo 3.1 takes reference images for subjects and Kling has a comparable
"elements" input. The `references` field is shaped to be reused by the hero
adapter when it is built; nothing in this design implements it.

## Data and contract changes

- New table `cast_members` (migration 0022) and `packages/schemas/src/cast.ts`.
- `Msg.images?` on the LLM request; three adapters emit it.
- `ImageGenRequest.references?`; two adapters consume it.
- `buildDirectorsBookRequest({ cast })`, `parseDirectorsBook(text, chapterCount, { castNames })`.
- Shot-list prompt and bible: guardrail no longer quoted; "the person in the
  reference photo" clause; pre-flight line.
- New server actions: `addCastMemberAction`, `updateCastMemberAction`,
  `removeCastMemberAction`, `createCastPhotoUploadAction`,
  `finaliseCastPhotoAction`, `removeCastPhotoAction`,
  `describeCastMemberAction`.
- New key helper `castPhotoKey({ projectId, contentHash, ext })` and a
  `getObjectBytes(key)` reader in storage.

## Testing

- Schemas: cast shapes, four-photo cap, view enum.
- DB: integration tests for the cast functions, unique name per project,
  cascade on project delete.
- Providers: adapters emit image parts in the right order (Anthropic,
  Google, OpenAI); Gemini image adapter puts references before text and
  refuses more than three; fal switches endpoint on references and sends
  presigned URLs; cast-identity prompt builds, parses and mocks; the book
  prompt lists the cast and the parser warns on a missing member; the
  shot-list prompt no longer asks for the guardrail to be quoted; the bible
  identity test still holds.
- Web: `generateStillCandidates` attaches references for depicted cast
  members and not otherwise (mock adapters record the request); server
  actions in mock storage mode; Cast card component tests (add, upload
  tiles, describe, edit, remove); the plan screen still works with no cast.
- e2e: add a cast member, upload a fixture photo in mock storage, see the
  tile and the identity string; run the visual plan and see a depicted
  slot's card say "reference: <name>".

## Out of scope (deliberate)

- A channel-wide cast library. The table is ready for one; the UI is not.
- Hero video conditioning.
- Face detection or cropping on upload. The producer crops.
- Any on-screen "Real footage" tag or illustrative opening card; that is a
  compositor task, tracked separately.
