# Social post shots: a real X post on screen, sized for both frames (decision 284)

Status: design approved in conversation 2026-09-29, section by section; this
document is for the owner's review before an implementation plan is written.

## 1. The problem

The owner, 2026-09-29: "I want to have an option where I can share a Social
Media post like a tweet/Facebook post etc. How can I nicely format this into
the screen so the sizing is right."

A documentary about a company's collapse leans on what its people said in
public, and much of that was said on X. Today the only way to show a post is
a screenshot uploaded as a still: soft at 4K, a shape that depends on the
crop, text that cannot be highlighted, and nothing that says whether it fits
under the captions in a Short.

## 2. Goals and non-goals

Goals:

- A new shot type, `social`, that shows one real X post as a card, in 16:9
  and 9:16, legible at any length the card accepts and never clipped.
- Every word, name, handle and date on the card comes from the post (via X's
  public reader) or from the owner. None is written by a model.
- The board shows exactly what the render draws, by construction rather than
  by test.
- Works in mock-provider mode and costs nothing per post.

Non-goals (decided with the owner):

- Platforms other than X. The data model carries a `platform` field so one
  can be added later, but only `x` exists.
- Like, repost and reply counts, the verified tick and the time of day. X's
  reader does not give them, so any value would be invented.
- A pixel-accurate copy of X's own interface.
- Scrolling long posts, or refusing them. A long post is excerpted.

## 3. Decisions taken with the owner

| Question | Decision |
|---|---|
| Where content comes from | Paste the post's link; the app reads it; the owner corrects or fills in anything |
| Look | Laid out like an X post (avatar, name, handle, date, X mark), drawn in the channel's fonts and colours |
| Platforms | X only |
| Avatar | Cast photo when the handle belongs to a cast member, else an uploaded picture, else initials |
| Attached media | Optional upload shown under the text; the trailing media link is removed |
| Long posts | The owner picks a word-for-word excerpt; the card marks cuts with an ellipsis |
| Architecture | One shared card component and one layout module, drawn by the render and by the board (approach A) |

Approaches considered and rejected: a separate board preview in the headline
card's pattern (the pattern that let the graphic preview and render disagree
twice, decisions 268 and 283), and pre-rendering the card as a still on AWS
(exact, but no animated highlight, and a paid render and a wait per edit).

## 4. X's public reader

`GET https://publish.x.com/oembed?url=<post url>&omit_script=1&dnt=true`
needs no key. Verified 2026-09-29 against two posts; the response for Emad
Mostaque's resignation post:

```json
{
  "url": "https://x.com/EMostaque/status/1771400218170519741",
  "author_name": "Emad",
  "author_url": "https://x.com/EMostaque",
  "html": "<blockquote class=\"twitter-tweet\" data-dnt=\"true\"><p lang=\"en\" dir=\"ltr\">As my notifications are RIP some notes:<br><br>1. My shares have majority of vote <a href=\"https://x.com/StabilityAI?ref_src=twsrc%5Etfw\">@StabilityAI</a> <br>2. They have full board control<br><br>The concentration of power in AI is bad for us all<br><br>I decided to step down to fix this at Stability &amp; elsewhere<br><br>Will be sharing more soon<br><br>Exciting times <a href=\"https://t.co/rknp5lCWh4\">https://t.co/rknp5lCWh4</a></p>&mdash; Emad (@EMostaque) <a href=\"https://x.com/EMostaque/status/1771400218170519741?ref_src=twsrc%5Etfw\">March 23, 2024</a></blockquote>\n\n",
  "provider_name": "X",
  "type": "rich",
  "version": "1.0"
}
```

What it gives: the display name as X shows it today (not necessarily at the
time of posting), the handle, the text with its line breaks, links and
mentions, and the date to the day. What it does not give: the avatar, the
verified state, counts, the time, or attached media (which appears only as a
trailing `t.co` or `pic.twitter.com` link).

The `publish.twitter.com` host answers 301 to `publish.x.com`; the reader
calls `publish.x.com` directly.

## 5. Layout and sizing

All numbers are at 1080p and scale with `frameScale`, like every other card.

### 5.1 Where the card may sit

The card uses the graphic cards' safe area (`safeArea` in
`lib/graphic.ts`): 36 px margins and the caption band's top. In 9:16 it also
clears the Shorts top bar (the top 10 per cent of the frame).

| | 16:9 (1920 by 1080) | 9:16 (1080 by 1920) |
|---|---|---|
| Usable height | 36 to 810 px | 192 to 1,221 px |
| Card width | 1,000 px (52 per cent of the frame) | 950 px (88 per cent) |
| Tallest card allowed | 90 per cent of the usable height (about 700 px) | 90 per cent (about 925 px) |
| Text size range | 60 px down to 34 px | 64 px down to 36 px |
| Fits in full, roughly | 420 characters | 590 characters |

The card is centred horizontally and vertically in the usable area.

### 5.2 Inside the card, top to bottom

1. Header: an 88 px avatar circle; the display name in the heading role,
   bold; beneath it `@handle · 23 March 2024` in the secondary text colour;
   the X mark top right in the secondary text colour.
2. The post text in the body role, at the size chosen in 5.3. The post's own
   line breaks and blank lines are kept. Mentions, hashtags and links are in
   the accent colour. Cuts made by an excerpt show as `…` at the cut end.
3. The attached image, when one is uploaded: full inner width, at most 260 px
   tall in 16:9 and 380 px in 9:16, cropped with `object-fit: cover` about
   its centre, with the card's corner radius.
4. The source line: the post's address without its scheme, elided in the
   middle when long (`articleSourceLabel`'s rule), in the captions role.

Padding is 48 px (16:9) and 44 px (9:16). The card ground is the brand's
`surface` colour on the `background` ground, with the lit radial gradient the
headline and graphic cards use.

### 5.3 Choosing the text size

A pure function in a new `lib/social.ts` tries sizes from the top of the
range down in steps of about 10 per cent (16:9: 60, 54, 48, 44, 40, 37, 34)
and takes the largest at which the estimated text height fits the room left
after the header, the image, the source line and the padding.

The estimate wraps word by word: each word's width is
`estimatedTextWidth(word, px, role)` from `lib/graphic.ts` (decision 283's
per-family estimate), a line breaks when the next word would pass the inner
width, and the post's own line breaks always break. Line height is 1.3.

### 5.4 Why the card cannot clip

The card's height follows its content: only the text size comes from the
estimate, and CSS does the wrapping in both the render and the board, with
the same fonts. The estimate runs about 10 per cent wide (0.56 em against
Inter's measured 0.5), and the tallest card allowed is 10 per cent short of
the usable height. So if Chromium wraps one line more than the estimate, the
card grows by a line and stays inside the safe area. There is no fixed text
box to overflow.

### 5.5 Too long to show

If the text does not fit at the smallest size in every orientation the film
renders (16:9 for the master, and 9:16 when Shorts are made from it), the
layout reports `needsExcerpt`. The slot cannot be approved until the owner
chooses an excerpt:

- a continuous, word-for-word stretch of the post, cut at word boundaries
  (`emphasisFits`'s whitespace-collapsing comparison);
- the card shows `…` at whichever end was cut;
- the highlight, when set, must lie inside the excerpt;
- the excerpt itself must fit, or the board says it is still too long.

The board pre-fills a suggestion: the paragraph holding the highlight, grown
paragraph by paragraph while it fits; with no highlight, the opening
paragraphs that fit.

### 5.6 Motion

The card rises and settles over 420 ms. At 700 ms the accent highlight sweeps
under the highlight phrase (`markerSweep`, as on the headline card). The
whole card drifts by 1.2 per cent across the slot (`graphicDrift`). The
motion takes progress values as props, so the board draws the resting frame
(settled, swept, no drift) from the same component.

## 6. One component, two drawers

- `packages/compositions/src/components/SocialPostCard.tsx`: a pure React
  component taking the payload, the brand, the frame size and three progress
  values (`settle`, `sweep`, `drift`). No Remotion hooks.
- `SocialPost.tsx`: the Remotion wrapper. It reads `useCurrentFrame` and
  `useVideoConfig`, computes the progress values, and renders the card.
- The board renders `SocialPostCard` at its resting values inside a
  container scaled from 1920 by 1080 (or 1080 by 1920) to the slot's width,
  with the brand fonts loaded as the Brand Kit specimen already does.

Both drawers therefore produce the same markup at rest, which a test asserts
(section 11).

## 7. Storage and reading

### 7.1 The post address

`normalisePostUrl(raw)` in `packages/schemas/src/social.ts` returns
`https://x.com/<handle>/status/<id>` or null. It accepts `x.com`,
`twitter.com`, `mobile.twitter.com`, `www.` forms, query strings such as
`?s=20`, and `/photo/1` or `/video/1` endings. Anything that is not a status
address (a profile, a search, a list, another site) is null.

### 7.2 The `social_posts` table

Keyed by the normalised address, because one post can back several claims,
shots and films, and its words do not change after posting.

| Column | Notes |
|---|---|
| `url` | primary key, normalised |
| `platform` | `'x'` |
| `post_id`, `handle` | from the address |
| `author_name` | display name, nullable |
| `text` | verbatim, nullable |
| `posted_at` | `YYYY-MM-DD`, nullable |
| `ended_with_media_link` | boolean |
| `provenance` | per field, `'oembed'` or `'manual'` |
| `status` | `'fetched'`, `'manual'` or `'failed'` |
| `failure_reason` | text, nullable |
| `fetched_at`, `updated_at` | timestamps |

`cast_members` gains an optional `x_handle` (stored without the `@`,
compared case-insensitively).

### 7.3 The reader

`apps/web/lib/social-source.ts`, beside `article-source.ts`:

- Fetch the reader URL with a 10 second timeout and the app's user agent.
- Parse `html`: the `<p>` contents become the text (`<br>` to a newline,
  each `<a>` to its visible text, entities decoded); the trailing
  `&mdash; Name (@handle) <a>Month D, YYYY</a>` becomes the name, handle and
  date. The handle from the address wins if they disagree.
- A trailing `https://t.co/...` or `pic.twitter.com/...` token is removed
  from the text and sets `ended_with_media_link`.
- 404 and 403 (deleted, protected, suspended) and any unparseable response
  are stored as `failed` with a plain reason ("X says this post does not
  exist or is not public."). The owner can then type the details.
- A stored record is reused; **Read again** refetches. A field the owner
  typed is never overwritten by a refetch.
- The fetch is injected, so tests run on saved responses and never reach X.

## 8. Evidence, briefs and the timeline

### 8.1 Which claims can carry a post

`claimCarriesPost(claim)`: true when the claim's `sourceUrl` normalises to an
X post address, whatever its `sourceType`. This is the planner's gate, in
code as well as in the prompt.

### 8.2 The brief

```ts
SocialBriefSchema = z.object({
  type: z.literal('social'),
  ...briefCommon,
  /** The claim the post supports: the audit trail. */
  sourceClaimId: UlidSchema,
  /** The post shown. Filled from the claim's source; the owner may change it. */
  postUrl: z.string().min(1),
  emphasis: z.string().trim().min(1).max(120).optional(),
  excerpt: z.string().trim().min(1).max(2000).optional(),
  avatarAssetId: UlidSchema.optional(),
  mediaAssetId: UlidSchema.optional(),
})
```

This departs from the headline card on purpose. A claim sourced to a news
article is often about a post, and pointing the card at the post must not
rewrite the claim's citation, which the headline card's "Set the article's
address" does. So the post address lives on the brief.

### 8.3 The timeline payload

Everything the card shows is embedded, so a render months later does not
depend on the post still existing or the record not having been corrected:

```ts
SocialPayloadSchema = z.object({
  kind: z.literal('social'),
  platform: z.literal('x'),
  authorName: z.string().min(1),
  handle: z.string().min(1),
  /** The text as shown: the excerpt when there is one. */
  text: z.string().min(1),
  cutBefore: z.boolean(),
  cutAfter: z.boolean(),
  postedAt: IsoDate,
  emphasis: z.string().min(1).optional(),
  avatar: MediaRef.optional(),
  initials: z.string().min(1).max(3),
  media: MediaRef.optional(),
  sourceLabel: z.string().min(1),
  sourceUrl: z.string().min(1),
  claimId: UlidSchema,
})
```

`MediaRef` is whatever the still and upload slots already use for an asset
the broker materialises; the plan confirms the exact type. `social` joins
`TIMELINE_SLOT_TYPES`.

The compiler refuses a social slot whose record is missing the name, handle,
text or date, whose layout still reports `needsExcerpt`, or whose excerpt or
highlight is not word for word.

### 8.4 The avatar

In order: an uploaded `avatarAssetId`; else the photo of the cast member
whose `x_handle` equals the post's handle; else initials from the display
name (first letters of the first two words, upper case), drawn in the accent
colour on a tinted disc. Never matched by name.

## 9. The board

A social slot on the visuals board shows:

- **The preview**: the shared card at rest (section 6).
- **The fields**, each marked "from X" or "typed by you": name, handle,
  date, text. **Edit details** opens a form; **Read again** refetches.
- **Set the post's address**: refuses anything that is not a post: "That is
  not a link to a post. Paste the address of the post itself
  (x.com/…/status/…)." Opens on its own when the slot has no readable post.
- **Highlight**: pre-filled with `suggestEmphasis` on the text (the first
  figure), editable, refused when not in the text word for word.
- **Excerpt**: shown only when needed, pre-filled per 5.5, refused when not
  word for word: "The excerpt must be copied word for word from the post."
  Says "Still too long for the card" when the excerpt does not fit.
- **Avatar**: says where the picture comes from (cast photo, uploaded,
  initials), with **Upload profile picture**. When no cast member has the
  handle, it asks "Is @EMostaque one of the cast?" with a choice of cast
  members; choosing one saves the handle on that member.
- **Attached image**: **Upload the post's image**, and **Remove**. When the
  post ended in a media link and nothing is uploaded: "This post ended with a
  link, usually its image. Upload it to show it under the text."
- **Approval** is blocked while a field is missing or an excerpt is needed,
  and the board says which, in the words the headline card uses (decision
  280).

## 10. The planner

- `social` joins the shot types the planner may choose, gated by
  `claimCarriesPost` on the paragraph's claims (a `socialClaimRefs` list
  beside `newsClaimRefs`).
- Prompt rule: use a social shot when the narration quotes or refers to a
  post that a listed claim cites; name the claim by its reference; never
  write the post's words, name or date.
- `resolvePlannedBrief` fills `postUrl` from the claim and rejects a social
  brief whose claim carries no post, with a reason the repair loop reads.
- **Change shot type** on the board offers Social under the same gate.
- The mock planner emits one social slot when a mock claim cites a post, so
  e2e exercises the path.

## 11. Testing

- Schemas: `normalisePostUrl` (every accepted form folds to one key; profile,
  search and non-X addresses are null), the brief and payload schemas, the
  excerpt and highlight rules (including the highlight inside the excerpt),
  `claimCarriesPost`.
- Reader: parsing against saved responses: the two fetched on 2026-09-29, a
  long post, one ending in a media link, a 404.
- Layout: a one-line post takes 60 px; a 280-character post lands between 42
  and 48 px; a 1,000-character post reports `needsExcerpt`; both
  orientations; an image lowers the text size; the estimated card height
  never passes the tallest card allowed.
- Rendering: golden snapshots `SocialPostWide` and `SocialPostTall`; the
  board's resting card and the Remotion wrapper's final frame render the same
  static markup.
- Database: `social_posts` upsert and read, manual fields surviving a
  refetch, `cast_members.x_handle`.
- App: the address, excerpt and missing-field refusals; board component
  tests; the planner gate; one e2e test of the board with a stored post.
- Optional live check at the end: one draft render of a single social slot
  for Emad's post, a few cents of AWS time, run only with the owner's yes.

## 12. Build order and shipping

One branch, each step green before the next:

1. Schemas and `lib/social.ts` (the layout module).
2. `SocialPostCard`, the Remotion wrapper, the snapshots.
3. The `social_posts` migration, the cast handle, the reader.
4. The board controls and actions.
5. The planner, the brief resolver and Change shot type.

A render with a social slot needs the new broker and Remotion site
(`deploy:stacks boom-busters-broker` and `deploy:remotion`). On "merge and
push", Claude hands the owner a script that runs both, to be run straight
away. No film has a social slot until one is planned or retyped, and if a
render reached the old broker first, decision 282 makes it fail at once with
the reason rather than retrying.

## 13. Failure behaviour

| Condition | What the owner sees |
|---|---|
| Not a post address | "That is not a link to a post. Paste the address of the post itself (x.com/…/status/…)." |
| Deleted, protected or suspended post | "X says this post does not exist or is not public." with Edit details open |
| X unreachable or times out | "X did not answer. Try Read again, or type the details." |
| Field missing | "A post card needs the name, the handle, the text and the date. Missing: …" |
| Too long | "This post is too long to show in full. Choose the part to show." |
| Excerpt not verbatim | "The excerpt must be copied word for word from the post." |
| Highlight outside the excerpt or text | "The highlight must be words from the part of the post on screen." |
