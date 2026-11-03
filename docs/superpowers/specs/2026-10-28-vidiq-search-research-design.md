# The owner picks the case, VidIQ shapes it

Status: designed with the owner in conversation on 2026-10-28, then read by
a builder. Calls marked "my call" are Claude's and the owner can overturn
them. Approved by the owner on 2026-11-02 with four answers: remove
`Suggest cases` and retire the case-finder ranking code; score the top 3
titles automatically, with `Score all` for the rest; offer a refresh when a
brief is over 30 days old; leave the `case-finder-seed-quality` branch alone
for now. The plan is `docs/superpowers/plans/2026-11-02-vidiq-case-research.md`;
where it departs from this text (the anti-keyword rule lives in the outline's
brief block, not `script-craft.md`, to keep brief-free prompts identical), the
plan says why. Decision numbers are taken at the merge.

Supersedes the case-finder evidence-ranking design
(`2026-10-20-case-finder-evidence-ranking-design.md`), which is dropped.

## 1. Why

The channel now has a VidIQ subscription, and the way cases are found is
changing. Today:

- `Suggest cases` (`packages/providers/src/prompts/cases.ts:43-70`) asks one
  model to recall cases and to invent `demandNotes`, `competitorLinks` and a
  `priorityScore` from memory.
- Titles, descriptions and tags (`packages/providers/src/prompts/metadata.ts`)
  are written from the claims and the script alone. The tag rule at
  metadata.ts:205 is "company, product, people, events, topic", from the
  model's judgement. Neither request sees the case's angle, demand notes or
  competitor links.
- The only measured YouTube signal is one `search.list` call in the dossier
  gather (`apps/web/inngest/lib/dossier-discover.ts:336`), used to pull
  competitor transcripts for `toldAlready`.

The owner has been running VidIQ research through Claude in a separate chat
and typing the result into the app, so none of the keyword findings travel
with the case. From now on the owner chooses the subject from their own
research, and the app uses VidIQ to decide **the keywords and the angle**.
The same research then feeds the **dossier, script, title, description and
tags**.

## 2. What the owner decided (2026-10-28)

- **The owner picks the subject.** Cases come from the owner's own research,
  not from automatic discovery.
- **VidIQ shapes it.** For a chosen subject, the app queries VidIQ for how
  people search for it, what they ask, and which videos about it win, and
  from that proposes the target keyword and the angle.
- **The app calls VidIQ itself, through its MCP server.** Not research done
  in a Claude session and imported.
- **The research flows into every later stage**: dossier, script, title,
  description, tags. Keywords never get stuffed into the narration.
- **The case-finder is dropped entirely**, and case intake is rebuilt
  cleanly around this flow. Its paper-trail check suited only this channel;
  other channels (multi-channel design, 2026-10-27) will not need it.
- Owner's earlier choice in the same conversation (VidIQ replaces the
  case-finder's demand and competition measures) is moot with the
  case-finder gone.

## 3. What the recon found (2026-10-28, 30 credits, live calls)

Account: the VidIQ login is `ricardo@ankra.solutions`, connected channel
`UCzgd02HrspamnkL-6sW8BDQ` (@boom-busters). Plan balance 1,474 of 2,000
renewable credits, resets 2026-11-27.

- **Generic search stems are noise; a named subject is clean.**
  `keyword_research` on "rise and fall of" returns mostly an Indian reality
  show. Of 60 `matching_terms` rows for "what happened to", one is a company.
  But `matching_terms` on "wework" returns 17 rows that are almost all about
  the company, and they decide the angle: "wework documentary" is volume 64,
  competition 38 (overall 63); "the rise and fall of wework" is volume 62,
  competition 69 (overall 50, demand +172%); "how wework went from $47
  billion to bankruptcy" is 58 / 50 (+91%). A few rows are off-topic
  ("wework office scene", "wework world trade center pune") and must be
  filtered.
- **Outliers show what wins.** One `outliers` call on business-collapse
  documentaries returned 25 videos where small channels (1K to 27K
  subscribers) beat their own median 10x to 365x: Sears, Thomas Cook,
  Iomega, L.A. Gear, RadioShack and others. Their titles share patterns
  such as "From $818 Million to Nothing: How L.A. Gear Lost Everything" and
  "How the Richest Company in America Went Completely Broke: Sears".
- **Competitor tags and descriptions are readable.** `get_videos_by_ids`
  returns full tag lists and descriptions (one of five had `tags: null`).
  The winners share a tag shape: the brand, "rise and fall of X", "what
  happened to X", "X bankruptcy", "X documentary", key people, the era, and
  "business documentary". Their descriptions open on a dated scene with a
  number, say "this is the full story", often bust a myth, ask a comment
  question and end with sources.
- **VidIQ has no tag generator** among its tools. It has `generate_titles`
  and `score_title` (0 to 100 click potential, 5 credits).
- **Connection** (vidiq.com/mcp, vidiq.com/codex, terms of 2026-10-19):
  endpoint `https://mcp.vidiq.com/mcp`. An API key created at
  app.vidiq.com/account/settings/mcp is sent as a bearer token, intended for
  clients that cannot open a browser sign-in. **API keys are read-only**,
  which is enough since publishing already goes through the app's own
  YouTube OAuth. The terms ban automated use but exempt the MCP server "when
  used as documented". Data from YouTube "remains subject to those
  platforms' terms, including storage limits". Most research tools cost 5
  credits; `vidiq_balance` is free.

## 4. Goals, non-goals, anti-goals

**Goals**

1. A VidIQ connection in Settings, used server-side, with a mock mode.
2. A rebuilt case intake: the owner adds a subject, presses
   `Research with VidIQ`, and gets a search brief with a target keyword and
   two or three angle options to choose from.
3. The brief reaches the dossier, the script outline, titles, description
   and tags, in the ways section 7 sets out.
4. Every VidIQ call is costed in credits, shown before it is spent, and
   capped.
5. The case-finder's ranking code, its spec and its branch are retired
   without breaking the dossier sources that live in the same package.

**Non-goals**

- Automatic case discovery of any kind, with or without VidIQ.
- A paper-trail or legal check at intake. The dossier already grades every
  claim `ruled`, `alleged` or `none` with its source document
  (`packages/schemas/src/dossier.ts:124`); that is the safety net for every
  channel.
- VidIQ writing scripts (`generate_script`), voiceover, b-roll or
  thumbnails. The app's own pipeline stays the author.
- Updating published videos through VidIQ (needs OAuth; the app owns
  publishing).
- Feeding post-publish VidIQ stats back into anything.
- A free keyword-exploration screen. The owner can use VidIQ directly for
  their own research.

**Anti-goals** (failure even if it works)

- Narration that reads like it was written for an algorithm: keywords
  repeated, phrases bent to fit a search term.
- Numbers in titles or descriptions that come from a keyword phrase or a
  competitor's title rather than the claims (decision 303 grounded titles in
  claims after "$270M" leaked in).
- An angle option that states facts. Angles are directions for the dossier
  to test, not claims.
- Credits spent without the owner seeing the cost first.

## 5. The VidIQ connection

- **Provider.** `vidiq` joins `PROVIDERS` in `packages/schemas/src/settings.ts`
  and gets a field in Settings → Connections, stored encrypted like the
  others, with an optional `VIDIQ_API_KEY` seed in env and `.env.example`.
- **Client.** A small server-side MCP client (the official
  `@modelcontextprotocol/sdk`, streamable HTTP, bearer header; not yet a
  dependency) wrapped in a typed module with one function per tool used:
  `keywordResearch`, `outliers`, `getVideosByIds`, `scoreTitle`, `balance`.
  Keyword research answers as markdown tables, the others as JSON; the
  module parses both into Zod-checked shapes so nothing downstream reads
  markdown. VidIQ's notes say a missing value is unknown, not zero; the
  shapes keep nulls as null.
- **Mock mode.** Under `MOCK_PROVIDERS=1` the module serves fixtures. The
  recon responses in section 3 are the first fixtures (my call).
- **Credit ledger.** Each call records tool, arguments, credits used (each
  response carries `_credits.used`) and the case or project it served.
  Credits are not dollars, so this is its own record, not `cost_ledger`
  (my call; the builder may fold it into `cost_ledger` with a unit column if
  that is simpler).
- **Cap.** A monthly credit cap in Settings (default 1,000 of the plan's
  2,000, my call, leaving room for the owner's own VidIQ use). A run whose
  estimate would cross the cap, or exceed the live balance (`balance`, free),
  is refused before any call, with the numbers shown.

## 6. Case intake, rebuilt

### 6.1 Adding a case

The add form leads with **Subject** (required: the company or founder, as
it would be searched, for example "Iomega"), then an optional **angle idea**
in the owner's words, then the existing optional fields (people, source
links, competitor links, category, working title). `cases.subject` already
exists (decision 312). Duplicate subjects are refused, compared
case-insensitively (my call).

### 6.2 Research with VidIQ

A button on the case row, labelled with its credit estimate (about 20). It
runs as an Inngest function (my call; four network calls plus two model
calls is too long for a server action to hold) and shows progress on the
row:

1. `keyword_research`, `matching_terms` mode, seeded with the subject. A
   model step drops rows that are not about the subject as a story (the
   recon's "wework office scene").
2. `keyword_research`, `questions` mode, on the subject.
3. `outliers` with the subject as keyword, `requireAllTitleTerms`,
   `publishedWithin: allTime` (older nostalgia videos matter), limit 25.
4. `get_videos_by_ids` on the top 10 outliers by breakout score, for their
   descriptions and tags.
5. A model step writes the brief's `titlePatterns` and `toldAlready` (what
   the winning videos already cover, from their titles and descriptions).
6. A model step proposes **two or three angle options**. Each names the
   target or secondary keyword it serves, the searched questions it
   answers, and the gap it leaves relative to `toldAlready`. If the owner
   gave an angle idea, one option develops it. Options may not state
   figures or facts beyond what the brief contains.

The owner picks an option, or keeps their own angle. The chosen angle is
written to `cases.angle`. `demandNotes` is filled with a one-line summary
written from the brief (for example "wework documentary: 18K searches a
month, competition 38; 6 winning videos, best 172K views at 40x"), not
invented.

### 6.3 The search brief

A dated jsonb snapshot on the case row (new nullable column, for example
`cases.search_brief`), shaped by a Zod schema in `packages/schemas`:

- `measuredAt`
- `targetKeyword`: the chosen phrase with volume, competition, overall,
  estimated monthly searches and growth, as VidIQ returned them.
- `secondaryKeywords`: up to 10 more kept rows, same fields.
- `searchedQuestions`: up to 10.
- `outliers`: up to 10 videos, each with id, title, channel, subscribers,
  views, breakout score, published date and tags.
- `titlePatterns`: up to 5 winning title shapes with the subject replaced
  by `{subject}` and figures by `{figure}`.
- `toldAlready`: short lines on what the winning videos cover.
- `angleOptions` and which one was chosen.

**Target keyword choice** (my call): among kept rows, the highest VidIQ
`overall` score, with a tie-break toward phrasings that name the subject
and read as a documentary search ("X documentary", "what happened to X",
"rise and fall of X"). The owner can switch the target to any secondary
keyword on the case row; the switch is stored.

**Keywords with figures** (builder check, my call): a row containing a
digit or a currency amount ("how wework went from $47 billion to
bankruptcy") cannot be the target keyword. It may stay as a secondary
keyword and a tag. Title and description prompts receive such rows with the
figure replaced by `{figure}`, and decision 303's rule stands: any figure in
a title or description comes from a claim.

**Freshness** (my call): when a project starts from a case whose brief is
older than 30 days, the start dialog offers a refresh with its credit cost.
The builder checks YouTube's developer policy on stored data and tightens
this if needed; VidIQ's terms point at it.

### 6.4 What intake loses

- **`Suggest cases`**: the button, its dialog, the `suggestCases` action and
  the recall prompt in `cases.ts` are removed (my call: cases now come from
  the owner's research, and the button would invite the old habit back).
- **Model-written `priorityScore`**: no longer written. The column stays
  for existing rows and leaves the table view (my call).

## 7. What the brief changes downstream

**The brief is frozen onto the project when it starts** (builder check, my
call): a copy on the project row (for example `projects.search_brief`),
taken after the optional refresh and before the dossier runs. Every stage
below reads that copy, so the dossier, script, titles and tags all chase
the same keyword. Later changes on the case row reach only projects started
afterwards; each of a case's projects keeps its own copy. The copy is read
inside Inngest steps, never outside them. A project with no brief behaves
exactly as today.

### 7.1 Dossier

- `caseHeader` (`packages/providers/src/prompts/dossier.ts:101`) gains the
  target keyword and the searched questions, under a line saying these are
  what viewers search for and the research must answer them where the
  record allows.
- The brief pass (dossier.ts:452) gets the searched questions as candidates
  for `openQuestions`. A question the record cannot answer is listed as
  unanswered, never answered from the keyword.
- Outlier video URLs join the competitor documents the gather already turns
  into tier-3 `video` documents (dossier-discover.ts:432), so the dossier's
  own `toldAlready` covers what the winning videos told.
- The rendered markdown (`prompts/dossier-render.ts`) gets a short "Search"
  section: target keyword, the questions, and which ones the dossier
  answers. This is how the script stage sees it, since the script reads
  `dossierMd`.

### 7.2 Script

- `buildOutlineRequest` (`prompts/script.ts:170`) gains the target keyword
  and searched questions as an explicit input.
- New outline rules: the `centralQuestion` should be one a searcher of the
  target keyword would recognise; the subject is named in the first 30
  seconds of narration (YouTube's captions index spoken words).
- The anti-goal goes into `script-craft.md`: the target keyword may be
  spoken once where it is natural and is never repeated for search.

### 7.3 Titles

- `buildTitlesRequest` (`prompts/metadata.ts:48`) gains the target keyword,
  two secondary keywords and the `titlePatterns`. Rule: at least half the
  candidates contain the target keyword or the subject's name in its
  searched form; numbers still come only from claims (decision 303).
- The top 3 of the 8 candidates by the model's own ranking are scored with
  `vidiq_score_title` (with `channelId`, type `long`, 15 credits) and each
  shows its VidIQ score. A `Score all` button scores the rest (25 more).
- Shorts titles get the target keyword only; no scoring by default.

### 7.4 Description

- `buildDescriptionRequest` (metadata.ts:163) gains the target keyword,
  secondary keywords and the searched questions. Rules: the target keyword
  appears in the first 150 characters (the part shown in search); the body
  follows the shape the winners share (an opening dated scene with a figure
  from the claims, the full-story line, a comment question).
- The sources section is the app's own; no change.

### 7.5 Tags

Assembled by code first, then topped up by the model:

1. The target keyword and the secondary keywords, in brief order.
2. Tags that appear on at least two of the brief's outlier videos and
   mention the subject, its people or its era, plus "business documentary"
   when it appears.
3. The cast's names from the dossier.
4. The model's existing tag list fills what is left of YouTube's 500
   characters.

Owner tags still go first (`joinTags`, publish-actions.ts:186). The publish
screen marks which tags came from VidIQ data. YouTube says tags play a
small role in discovery, so the title, description and spoken words carry
most of the search work.

## 8. Retiring the case-finder

- **What goes:** the ranking and back-test code in `packages/case-finder`
  (hitlist seeding, the scorer and its config, `scripts/backtest.ts`,
  back-test fixtures), `buildScoreNamedCasesRequest` in `cases.ts`, and the
  2026-10-20 spec, which gets a "Dropped 2026-10-28, superseded by this
  design" status line.
- **What stays:** the research sources the dossier imports from the
  package through `apps/web/lib/research-sources.ts:32` (YouTube, Wikipedia,
  EDGAR, transcripts and the rest). The builder traces every import from
  `apps/web` and `packages/*` into `packages/case-finder` before deleting
  anything, and may move the sources into a renamed package (my call: keep
  the package name for now; renaming is churn).
- **The branch** `case-finder-seed-quality` and its worktree under
  `.claude/worktrees/case-finder` are never merged. Deleting them is a
  separate step the owner confirms; nothing in this build depends on them.

## 9. Multi-channel

The multi-channel design (2026-10-27) gives `cases` a non-null
`channel_id`, so a brief on a case row is already per channel. The VidIQ
connection and the credit cap stay global (one VidIQ account). The angle
step's sense of "what this channel covers" comes from the channel bible
when multi-channel lands; until then it uses today's hard-coded channel
description.

## 10. Constraints

- Mock by default (CLAUDE.md rule 6). Real VidIQ calls in development only
  on request, within the cap.
- Read-only API key. The app never calls VidIQ write tools.
- `'use server'` files export only async functions.
- Inngest: anything new is computed inside steps.
- A new Settings tab or field adds its actions mock to the Settings form
  tests (project memory).
- Prettier and lint clean on every commit; tests land with the code.

## 11. Left to the builder

- Where the VidIQ client module lives (a new package or inside
  `packages/providers`).
- The credit ledger's table shape.
- Layout of the brief and the angle options on the case row, and of the
  VidIQ score on title candidates, within the button-first rules.
- Exact Zod shapes and the markdown-table parser.
- Prompt wording, within the rules above.
- Build order, as long as the connection and mocks come first.
