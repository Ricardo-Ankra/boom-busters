# Generated thumbnails and title sets

Date: 2026-11-24. Status: awaiting the owner's approval. Size: a project, in two phases.

## 1. Why

Today a master's thumbnail is made by hand in Canva and dropped on the Publish
screen as a PNG. Up to three are stored; the first goes up through
`thumbnails.set` and the other two wait for the owner to start a Test & Compare
in YouTube Studio. Titles are generated as eight options, and one is chosen.

The owner wants the app to make the set: three thumbnails that are on brand,
carry the channel mark, and make a viewer want to watch, each with a title of
its own, ready for YouTube to test against each other. The owner also asked
for the tool to follow thumbnail practice that has evidence behind it.

This reverses a recorded position. Build spec section 2 lists thumbnail
generation as out of scope, and `docs/02-app-spec-and-dev-plan.md` says "No AI
thumbnail generation anywhere in the pipeline". The owner's request of
2026-11-24 replaces both; the change is recorded as a decision in `PROGRESS.md`
(484 is the next free number at the time of writing; re-check at merge).

## 2. What the evidence says

Read on 2026-11-24. "First-party" means a Google or YouTube page.

| Finding | Source | Strength |
|---|---|---|
| Test & Compare takes up to 3 variants and tests titles, thumbnails, or both together | [YouTube Help 16391400](https://support.google.com/youtube/answer/16391400) | First-party |
| The winner is the variant with the highest watch time share, not the highest click rate | Same | First-party |
| No clear winner means the first variant uploaded stays | Same | First-party |
| Desktop Studio only. Not for Shorts, Premieres, made-for-kids, mature or private videos | Same | First-party |
| "If a video's title or thumbnail is changed during the test, the test will automatically stop" | Same | First-party |
| If any test thumbnail is below 720p, all are shown at 480p | Same | First-party |
| No API starts a test or reads its result | Data API and Analytics API revision histories hold no such entry; vidIQ's own tool states it "cannot start, stop or edit a YouTube test" | Absence of a documented endpoint |
| `thumbnails.set` takes JPEG or PNG up to 50 MB (raised from 2 MB on 2026-09-14), about 50 quota units | [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set), [revision history](https://developers.google.com/youtube/v3/revision_history) | First-party |
| A title or thumbnail that promises what the video does not deliver can be removed | [Google India blog, 2024-12-18](https://blog.google/intl/en-in/products/platforms/strengthening-enforcement-against-egregious-clickbait-on-youtube/) | First-party |
| A human face is on 69% of 500 breakout videos, 80% of the top 50; 72% carry text, median 5 words | [vidIQ study, 2026-06-30](https://vidiq.com/research/youtube-thumbnail-study/) | One study, no control group, the publisher sells thumbnail tools |
| "Three words at most", shocked expressions, arrows, "never repeat the title", logos helping or hurting | No source found | Folklore |
| Anything specific to business documentaries, or to title length and structure | Not found | Unknown |

Two conclusions shape the design. Watch time decides the winner, so a
thumbnail has to promise what the film's opening delivers. And published
practice is thin enough that the channel's own test results are the better
evidence, so every variant records what it was trying and how it did.

Whether a test can be set up on a scheduled video before it goes public could
not be confirmed; the Help page excludes private videos and does not address
that case. The design assumes the test starts once the video is public.

## 3. Goals

1. One button on a master's Publish card produces three packages. A package is
   a thumbnail and its title, built on one idea, and the three ideas differ.
2. The picture is painted by the image model from the film's own references.
   The headline and the channel mark are set on top by the app from the brand
   kit, never painted by the model.
3. Nothing reaches YouTube without the owner approving it. The owner chooses
   which package is the default; that one goes up through the API as today.
4. The other approved packages are handed over for Studio: a download, a title
   to copy, a link to the video, and a reminder when the video is public.
5. The owner records how the test ended, and those results are kept per idea
   so later sets can be told what has worked on this channel.
6. Uploading a Canva PNG keeps working exactly as it does.

## 4. Non-goals

- Starting, stopping or reading a Test & Compare by API. There is none.
- Rotating thumbnails or titles on a timer and comparing days. Considered and
  refused, see section 6.
- Shorts. Test & Compare does not take them. A Short's thumbnail stays an
  upload.
- Scoring thumbnails with vidIQ, or reading test results through vidIQ.
- Reading impressions and click rate from the Reporting API reach reports.
- Predicting click rate.

## 5. Anti-goals

These make the feature a failure even if it works.

- A thumbnail or title that promises something the film does not show.
- A likeness of a real person who is not in the project's cast, or of a cast
  member in a situation the film does not show.
- Model-painted text, or a model-painted logo.
- A set whose three variants differ only in colour or wording. A test between
  them teaches nothing.
- A picture bought outside the budget gate, or a real provider called in tests.
- The app changing a title or thumbnail on a video whose test is running.
- A results screen that calls a winner the owner did not record.

## 6. Approaches

### 6.1 How the set reaches a test

| Approach | What it is | Trade-off |
|---|---|---|
| **Prepared hand-off (chosen)** | The app uploads the default and hands the others over; the owner starts the test in Studio | About two minutes per video by hand. YouTube's own randomised test, measured on watch time share |
| Timed rotation | The app swaps thumbnail and title every day through `thumbnails.set` and `videos.update` and compares the numbers | Fully automatic. Compares different days, not different viewers, so the day of the week, the traffic mix and the video's age all sit inside the result. YouTube warns such results can differ from its own. The reach numbers arrive 48 to 72 hours late. Not trustworthy on this channel's traffic |

The owner chose the hand-off on 2026-11-24.

### 6.2 How the thumbnail is made

| Approach | What it is | Trade-off |
|---|---|---|
| The model paints everything | One image call returns picture, text and logo | Model text misspells, the logo drifts from the real mark, and each wording change costs a new image |
| **The model paints the picture, the app sets type and mark (chosen)** | One image call for the picture; an HTML page with the brand kit's fonts, colours and logo file is photographed by the headless browser the designer already uses | Headline edits and layout changes are free. The mark is always the real file. One more moving part |
| Crop the film's stills | No image call; a chosen still plus text | Free and true to the film, but those stills are framed as scenes and the subject is too small to read at 168 px wide |

The owner handed this choice over; the second is my pick. The third survives
inside it: the film's chosen stills go to the model as references, so the
thumbnail looks like the film.

## 7. The design

### 7.1 A package

A package holds:

- **Idea**, one of a small fixed list so results add up across videos:
  `person` (a principal of the story), `figure` (the number), `object` (the
  product, building or document), `moment` (the turning point), `contrast`
  (before and after). A set never repeats an idea.
- **Angle**: one sentence saying what this package promises the viewer.
- **Title**: at most 100 characters, written for this thumbnail. On a format
  with a title template, the same required-slot check the title options get.
- **Headline**: the words set on the picture. Zero to four words (the app's
  own ceiling, see 7.5). It adds to the title; the planner is told not to
  repeat it.
- **Picture brief**: subject, framing, which side is left clear for the
  headline, which film stills and which cast members it draws on.
- **Claims**: the ids of the verified claims the title, headline and picture
  rest on.
- **Depicts**: the cast names shown.
- The stored picture, the composed thumbnail, its position in the set, where
  it came from (`generated` or `uploaded`), whether it is approved, and its
  test result.

Packages live in a table of their own, one row per package, keyed to the
publish record. `publish_records.uploaded_thumb_keys` stays what the publish
runner reads: approving a set writes the approved packages' composed keys into
it in order, and the default's title into the draft title. The runner's
upload rounds and its `set-thumbnail` step do not change; its preflight gains
one read (7.9).

Phase 1 is for masters only. The generate action refuses a Short in words.

**Uploads and generated packages share the three places.** "Choose a PNG…"
keeps working as it does, and the uploader also writes a package row
(`uploaded`, no picture brief, idea left for the owner to label or leave
empty), so its result can be recorded too. An uploaded PNG is approved by the
act of uploading, as today. A key stored before this work gets its row the
first time its record is read (package ids are made by the app, so a SQL
migration cannot write them). A record never holds more than three approved
packages:

- with three approved, "Generate a set" is refused: remove one first;
- with one or two approved, it plans only the free places, and the planner is
  told the ideas already held so it does not repeat one;
- generating again replaces unapproved generated packages and nothing else.

**The title.** Approval writes the default package's title into the draft
title, which is the title the runner uploads, so an approved set also
satisfies the runner's "a title is the minimum" check. When a different title
is already saved, the card says so beside the Approve button, naming the title
that will be replaced. My call.

**After the upload, packages freeze.** Generate, regenerate, edit, make
default, approve and remove are open only while the record is `draft` or
`failed`, the same rule every other field on the card follows. Nothing in the
app changes a title or thumbnail on YouTube after the first upload, so the
default package and the video cannot drift apart.

### 7.2 Planning the set

One call on the `metadata` routing tier, the tier the title options use. It is
given:

- the hook and the verified claims, as the title generator is (decision 303);
- the cast: names, roles and guardrail text;
- the film's chosen stills that could serve as references, each with its slot
  id, a line of what it shows and who it depicts;
- the format's filled title template and required slots, when it has one;
- the channel's thumbnail style note and the notes on its reference
  thumbnails (7.6);
- in phase 2, what has won on this channel (7.8).

It returns three packages. The app then checks each one and drops a package
that fails, asking once for a replacement:

- every name in `depicts` is a cast member who is not dismissed;
- every claim id exists and is verified, and there is at least one;
- any figure in the title or headline appears in one of those claims;
- the three ideas differ;
- the headline is within the word ceiling.

A package that depicts a person must name at least one film still that depicts
the same person. That is how "only in a situation the film shows" is held: the
picture is made from the film's own scene, not from an invented one.

### 7.3 Painting the picture

One image call per package through the existing Gemini adapter, behind the
budget gate the stills use, with a routing key of its own
(`modelRouting.thumbnails`).

`modelRouting.thumbnails` gets a catalogue entry and the same preflight the
stills routing has, and the default settings and seed carry it.

The default model is `gemini-3-pro-image` at 2K, 16:9. It is the only current
model with a style channel: up to 6 object, 5 character and 3 style
references. `gemini-3.1-flash-image` and `gemini-nano-banana-2.1` take 10
object and 4 character references and none of style. The cost shown on the
button is the figure the budget gate bills, from the adapter's own price
table: $0.15 an image on Pro at 2K (Google's $0.134 rounded up), so $0.45 for
a set of three. Each regenerated picture is one more image. Verify the ids
against the key's own `ListModels` before wiring them.

References sent: the depicted cast members' stored photos as characters, the
named film stills as objects, and up to three of the channel's reference
thumbnails as style.

The adapter has no style channel today: `ImageReference` is `character` or
`object`, and `ReferenceLimits` counts only those two. Adding a `style` kind,
a `styles` limit per model (3 on Pro, 0 elsewhere), its label in the request
and the mock's handling is part of this work. On a model whose style limit is
0 the reference thumbnails are not sent; the style note still travels as
text, and the card says the references were left out and why. My call.

The prompt leads with framing, because the model follows its opening over its
trailing instructions: 16:9, one subject filling at least half the frame
height, the named side left clear and plain, no text, no logo, no watermark,
no interface elements. The cast member's guardrail text travels with any
likeness, as it does for the film's stills.

The picture is stored in R2 on its own, so the thumbnail can be recomposed
without buying it again.

### 7.4 Setting the type and the mark

A pure function builds one HTML document, 1920 by 1080: the picture
full-bleed, a scrim on the headline's side, the headline in the brand kit's
heading face and colours, and the channel mark. The headless browser
photographs it at exactly that size as a JPEG at quality 90. 1920 by 1080
clears the 720p floor below which YouTube shows every test variant at 480p.
`screenshotDocument` takes a whole page at a fixed 800 px viewport height, so
this needs a sized variant, launched the way the designer's frames are (the
Inngest route cannot import the browser statically).

The mark is the same file the film's watermark uses (`brandKit.look.logoR2Key`),
with the same fallback to the typographic channel name when there is none. It
differs from the film's in two ways, both because a thumbnail is seen small:

- **Corner**: its own setting, `brandKit.look.thumbnailMarkPlacement`, default
  top left. The film's default is bottom right, which is where YouTube draws
  the duration badge. `none` is allowed.
- **Size and weight**: 8% of the frame height at 80% opacity, against the
  film's 3.5% at 60%. This is my call for the owner to check at real size.

Editing the headline, switching its side or changing the mark recomposes for
free.

### 7.5 The checks

Shown as warnings on the package, and they do not block approval. They are the
app's own rules, set where the evidence is thin, and held as named constants
so results can change them:

- **Words**: at most four in the headline. The one study found a median of
  five among thumbnails with text; four leaves room for the size floor below.
- **Size**: the headline's type is at least 6.25% of the frame width, which is
  20 px when the thumbnail is shown 320 px wide.
- **Contrast**: the headline reaches 4.5 to 1 against what is behind it. The
  scrim is the guaranteed way to get there.
- **Keep-out**: no headline and no mark in the bottom-right region the
  duration badge covers.
- **Fit**: the headline's box stays inside the frame, measured in the browser
  as the designer's layout check measures text.

### 7.6 The channel's thumbnail references

A new part of the channel's settings, beside the logos, stored in the
channel's settings as its own `thumbnails` section (the mark's corner sits in
`brandKit.look` with the film's):

- a short style note in the owner's words;
- up to six reference thumbnails, uploaded as files, each with a one-line note
  on what to take from it, and a switch for "in use". At most three in use,
  which is Pro's style limit.

References steer style. The prompt says never to copy a reference's subject or
composition, and the files are never published. In phase 2 a package the owner
marks as a winner offers "Add to references".

### 7.7 The Publish card

On a master's card, the thumbnail area gains a second button beside "Choose a
PNG…":

```
Thumbnails and titles
[ Choose a PNG… ]  [ Generate a set · about $0.45 ]  [ Open the Canva templates ]

┌ 1 · Default ──────────┐ ┌ 2 ───────────────────┐ ┌ 3 ───────────────────┐
│ [ thumbnail, large ]  │ │ [ thumbnail ]        │ │ [ thumbnail ]        │
│ 320 px  168 px        │ │ 320 px  168 px       │ │ 320 px  168 px       │
│ on dark · on light    │ │                      │ │                      │
│ Idea: Person          │ │ Idea: Figure         │ │ Idea: Moment         │
│ Promises: ...         │ │ Promises: ...        │ │ Promises: ...        │
│ Title    [.........]  │ │ Title    [.........] │ │ Title    [.........] │
│ Headline [.........]  │ │ Headline [.........] │ │ Headline [.........] │
│ Shows: Adam Neumann   │ │                      │ │                      │
│ ⚠ headline is 5 words │ │                      │ │                      │
│ [Regenerate picture]  │ │ [Make default]       │ │ [Make default]       │
│ [Text left] [Remove]  │ │ [Regenerate picture] │ │ [Regenerate picture] │
└───────────────────────┘ └──────────────────────┘ └──────────────────────┘
[ Approve this set ]
```

- Every action is a labelled button (spec 11.1). The real-size previews sit
  beside the title as YouTube shows it, on a dark and a light ground.
- "Generate a set" names its cost before it spends. It runs as an Inngest
  function, one run per target, because three pictures take longer than a
  server action may wait. The card shows the run's progress and its failure in
  words.
- "Regenerate picture" buys one image for that package. Title and headline
  edits are free.
- "Approve this set" is the gate. Before it, a master has no thumbnail as far
  as the runner is concerned, so the existing precondition refuses the upload.
  A package that shows a person lists the names under "Shows", so the owner
  approves the likeness knowingly.
- Generating again replaces unapproved generated packages. Approved ones,
  uploads included, are kept until the owner removes them (7.1).

After the upload, the card shows the hand-off:

```
Test & Compare in Studio
Variant 1 is on the video. Start a test with the other two:
 2  [ Download thumbnail ]  [ Copy title ]
 3  [ Download thumbnail ]  [ Copy title ]
[ Open this video in Studio ]      [ I have started the test ]
```

When the analytics run finds a master live and it holds more than one approved
package, it sends one notification: the video is public, start its test, with
the link. A stamp on the publish record makes it once only, whatever later
runs see, and it is sent in mock mode too, which is how the end-to-end test
sees it.

"I have started the test" (phase 2) stamps the record. No app action changes a
live video's title or thumbnail today (7.1). The stamp guards the one path
that could, a record reset to `draft` or `failed` and uploaded again, and any
writer added later: while a test is marked running, such an action is refused
in words, because YouTube stops the test on that change.

### 7.8 Results and learning (phase 2)

On the hand-off panel, once a test is marked started:

```
How did the test end?
[ 1 won ] [ 2 won ] [ 3 won ] [ Performed the same ] [ Inconclusive ]
Watch time share, optional:  1 [ % ]  2 [ % ]  3 [ % ]
```

The result is stored on each package and ends the running state.

A card in the channel's settings, "What has won", counts tests and wins per
idea. Once the channel has five finished tests with a winner, the planner is
given that count as a paragraph. Below five it is given nothing, so it does
not learn from noise. Tests that ended the same or inconclusive are counted
and shown, and are never described as wins or losses.

### 7.9 The altered-content label

A generated thumbnail that depicts a cast member counts toward the upload's
`containsSyntheticMedia` flag, together with the film's own generated
likenesses: the runner's preflight reads the approved generated packages'
`depicts` beside `syntheticLikenesses`. YouTube's rule is written for the video and is silent on
thumbnails; counting it errs toward disclosure, and the channel's description
already says likenesses are AI re-creations. This is my call.

### 7.10 Mock mode and tests

Mock mode is the default, as for every paid provider (working rule 6). The
mock planner returns three fixed packages; the mock image adapter already
returns inline SVGs. The end-to-end suite runs without storage, so a composed
thumbnail shows as the same placeholder tile an unreadable upload shows today.

Tests land with the code:

- the planner's parser and each drop rule in 7.2;
- the composing document as a pure function, and each check in 7.5;
- the actions: generate, regenerate, edit, make default, approve, remove,
  mark started, record result, and the refusal while a test runs;
- the runner function with a mocked adapter, counting image calls;
- approval writing `uploaded_thumb_keys` in order and the draft title;
- the settings tab (and its actions mock in `voice-tab.test.tsx`);
- one end-to-end path in mock mode: generate, approve, schedule, see the
  hand-off.

A paid check on real pictures is the owner's to ask for. One set is $0.45,
inside the standing $1 per run ceiling for image test loops.

## 8. Phases

1. **Phase 1**: packages, planning, painting (with the adapter's style
   channel), composing, the checks, the thumbnail references in settings, the
   Publish card, approval, the hand-off and the reminder.
2. **Phase 2**: "I have started the test", results, "What has won", the
   planner reading it, and "Add to references".

Phase 2 starts when phase 1's tests are green.

## 9. Found along the way, not part of this work

- `gemini-2.5-flash-image` is listed as deprecated with shutdown on
  2027-03-15. Any routing still on it needs moving before then.
- `apps/web/lib/thumbnail-rules.ts` caps uploads at 2 MB, citing the API. The
  API limit is now 50 MB.
- `apps/web/lib/youtube-analytics.ts` says the API has no impressions click
  rate. Since 2026-01-15 the Reporting API's `channel_reach_basic_a1` report
  carries `video_thumbnail_impressions` and
  `video_thumbnail_impressions_ctr` per video per day, about two to three
  days late. Whether the existing `yt-analytics.readonly` scope covers it is
  not stated on Google's page.
- Since 2026-11-03 `thumbnails.set` accepts a Short's custom thumbnail after
  processing, which decision 251 recorded as Studio only.

## 10. Left to the builder

- Table and column names, the migration, and the query helpers.
- Where the planner's prompt lives and its exact wording, within 7.2.
- The image prompt's wording, within 7.3.
- The composing page's CSS, the scrim's shape, and the exact keep-out
  rectangle.
- How the fixed-size screenshot shares code with `screenshotDocument`.
- The Inngest function's step layout, and how the card shows progress.
- Where reference thumbnails are stored and how they are capped.
- Whether a package's title can be sent to the existing VidIQ title scoring.
- How the tests are batched to stay inside the suite's time limits.
