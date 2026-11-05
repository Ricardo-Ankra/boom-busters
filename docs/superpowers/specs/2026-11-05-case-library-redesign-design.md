# Case Library redesign: honest keywords, ranked angles, list and panel

Date: 2026-11-05. Status: design, awaiting the owner's approval.

## Why

The owner researched Stellantis with VidIQ and could not tell what the brief
was saying:

1. **The "keywords" were mostly other people's video titles.** The target
   keyword read "stellantis is losing everything: jeep, dodge & fiat on the
   brink", and six of the ten secondary keywords were titles or YouTube's
   auto-translated Portuguese and Spanish versions of them. VidIQ's
   `matching_terms` mode returns every search phrase containing the subject,
   and a viral video's exact title is a search phrase. The keyword filter
   (`buildKeywordFilterRequest`) keeps anything "about the subject", so the
   titles pass. `chooseTargetKeyword` then picks the highest `overall`, and a
   title has almost no competition (one video matches it), so titles win the
   target every time. Nobody can rank for another creator's title.
2. **The figures were unreadable.** "volume 75, competition 26, overall 75,
   about 109,212 searches a month" mixes VidIQ's 0 to 100 scores with a count
   in one unlabelled run.
3. **The angle options were unranked.** Three options plus "Keep my own
   angle", all at the same weight, with no way to tell which was best.
4. **The page was a wall.** Every case row carries the status select, the
   format picker, Research with VidIQ, New project with its runtime field,
   Remove and Edit details inline at one weight, and an opened brief runs
   into the next case. An Impeccable audit scored the page 14/20 with
   implementation integrity and responsive behaviour the weak dimensions
   (accessible names repeated as "Make target" ten times, fixed `w-96` fields
   overflowing a phone, Remove beside Research).

Success: the owner opens a case and can see, without opening anything, what
to search-optimise for, which angle the data and the model favour and why,
and what to do next.

## Goals

- Keep video titles and other-language terms out of the keyword lists and
  out of the target, and show them as what they are.
- Label every figure so a score cannot be read as a count.
- Rank the angles: a data Demand score on each, plus the model's Recommended
  pick with a one-line reason.
- Replace the stacked rows with a list and side panel.

## Non-goals

- No new VidIQ calls, no new VidIQ tools, no change to what research costs.
- No change to the research run's other steps (fit, questions, outliers,
  winners) beyond what the keyword split and the angle rating need.
- No change to the console's visual system: tokens, buttons, type and the
  dark-first theme stay. This is a restructure of one page, not a new look.
- No restoring Suggest cases. Legacy `idea` rows keep their Accept and
  Dismiss, nothing more.

## Anti-goals

- A score that looks precise but hides what it is made of. Every number the
  owner sees says where it comes from.
- Spending credits to fix the display of an existing brief. Existing briefs
  must read correctly with no new research.
- Hiding an action behind an overflow menu or a keyboard shortcut (spec
  11.1, button-first). Every action stays a visible, labelled button.
- The model inventing facts in a reason (spec 4 anti-goal: directions, not
  facts). The reason may not state a figure no input carries.

## Decided with the owner

### 1. Keywords are split by shape (rules only, with the prefix rule)

A pure function in `packages/schemas/src/search-brief.ts`, say
`classifySearchTerm`, sorts each measured term into one of three kinds:

- **Title**, a person searching for one specific video, when any of:
  - it contains `:` `—` `–` `|` `.` `!` `?` or a straight or curly double
    quote (a hyphen inside a word, as in "co-founder", does not count);
  - it is nine words or more;
  - it is the opening words of another term that is a title by the rules
    above ("stellantis is losing everything" is the start of "stellantis is
    losing everything: jeep, dodge & fiat on the brink"). Compare
    lowercased and trimmed, on whole words, and only when the shorter term
    has at least three words, so "stellantis" alone never becomes a title.
- **Other language**, when it carries a letter with a diacritic (`á à â ã ä
  é è ê í ó ô õ ö ú ü ç ñ` and their capitals). A term that is both a title
  and another language is filed under other language.
- **Keyword**, everything else.

The owner picked rules over model labels: rules fix existing briefs for
free, work the same every time and can be tested. Unaccented foreign terms
will slip through as keywords; that is accepted.

**Target choice.** `chooseTargetKeyword` considers only rows the classifier
calls a keyword (as well as skipping rows with a figure, as now). When no
keyword is left, the target is null and the panel says "No keyword people
search for this subject was measured; the searched titles below show there
is interest" (wording the builder may tighten).

**New briefs.** The research run classifies the full measured list (both
`matching_terms` calls, up to 40 rows) before choosing the target. The brief
stores three lists: `secondaryKeywords` (keywords only, up to 10, as now),
and new `searchedTitles` and `otherLanguages` (each up to 10, by
`estimatedMonthlySearch` descending, nulls last). Both new fields default to
`[]` so stored briefs still parse.

**Existing briefs.** The case read path (`storedBrief` in
`packages/db/src/cases.ts`) runs an upgrade that reclassifies the stored
target and secondaries, moves titles and other-language rows into the new
lists, and re-picks the target from what is left. The upgrade is
idempotent (a brief already split comes back unchanged) and is not written
back on read; it is written the next time anything saves the brief (an
angle choice, a target change, a rating). Project briefs get the same
upgrade on read (the owner's answer, at the end).

**Make target** is offered only on keyword rows. `setCaseTargetKeyword`
refuses a term the classifier calls a title or another language, as it
refuses a figure now.

**Demand notes.** When the upgrade changes the target, `demandNotes` that
still equal `briefDemandNotes(oldBrief)` follow the new target on the next
save, the rule `setCaseTargetKeyword` already uses. Notes the owner edited
stay.

### 2. Angles get a Demand score and a Recommended pick

**Demand score, 0 to 100, computed on read, never stored.** For an option:

- 70% of its keyword's VidIQ `overall` (0 to 100), looked up among the
  brief's target and secondary keywords. When the option's keyword is not
  a keyword any more (an old brief whose option served a title), or the
  brief has no keywords, this part is 0;
- plus 6 points per searched question it answers (at most 5, so at most 30);
- rounded, capped at 100.

The panel shows the number with a thin bar, and on hover or focus a plain
breakdown ("overall 63 for leapmotor stellantis, 2 searched questions").
On narrow screens the breakdown sits under the angle as a line of text.

**Recommended pick, from the model.** A new model step, "rate the angles",
in `packages/providers/src/prompts/search-brief.ts`, given the channel bible
(subject, audience), the subject, the options as stored, each option's
Demand score and breakdown, the searched questions and the told-already
list. It answers `{"recommended": number, "reason": string}`: the index of
one option and one sentence, at most 200 characters, on why. Rules for the
prompt: weigh demand and the gap together; never state a figure, date or
count the inputs do not carry (the parser drops a reason with a digit not
in the inputs and asks again, as `parseAngleOptions` does); an index out of
range is refused for a retry. The brief stores `recommendedAngle: number |
null` and `recommendationReason: string | null`, both defaulting to null.

**When it runs.** New research runs it as a step right after the angle
options. Existing briefs with options and no recommendation show a **Rate
the angles** button in the Angle section, with its cost in the label (an
LLM estimate from the cost ledger rules, a few cents; no VidIQ credits).
It runs the same step alone over the stored brief and saves the result.
The options themselves are not regenerated, so the owner's chosen angle
and the option text stay as they are.

**Ordering.** The options keep their stored order (the chosen index points
into it). The Recommended one is marked, not moved.

### 3. List and side panel

The page becomes a two-pane layout inside the existing console shell.

**Left: the list** (about 340px wide on desktop).
- Header: "Backlog" with the count, and the sort toggle (Newest, Status,
  Category, as now; the active one uses the `selected` button variant).
- Legacy suggestions, when any exist, sit in their own group above the
  backlog headed "Suggested", as now.
- Each row: title (one line, truncated), a status pill, the pillar label,
  the project count when above zero, and one signal line: the target
  keyword in mono, then the angle state ("Angle chosen" in success colour,
  "3 angles, pick one" in warning colour, "Not researched" muted, or the
  live research step label while a run is going).
- A row is a link (`?case=<id>`, keeping `sort`), so the open case
  survives a refresh and can be bookmarked. The open row is marked with
  the accent-text inset bar and `aria-current="true"`.
- With no `case` parameter the first backlog case opens. An empty library
  keeps today's empty state in the list area and an "Add a case" prompt in
  the panel.

**Right: the case panel**, top to bottom in the order the owner decides:
1. **Header**: full title, pillar, project count, researched date; on the
   right the status select and the research control (Research with VidIQ /
   Research again with the credit figure, or the live step, or the failure
   with Try again), unchanged in behaviour. The format picker sits here
   too for a multi-format channel.
2. **Next step strip**: Researched, Angle chosen, Start a project, each
   marked done or current, and one sentence naming the next step. Statuses
   past `shortlisted` read the project step as done.
3. **Warnings**: the fit warning and the "this research is for another
   subject" warning, as now, above the angle.
4. **Angle**: the options as cards with the Demand score on the right,
   the gap sentence at full text strength, the Recommended badge and
   reason on the model's pick, a Chosen badge on the chosen one, Use this
   angle on the others, and Write my own angle at the end (today's
   textarea flow). Rate the angles shows here when there is no
   recommendation.
5. **Start a project**: today's `NewProjectButton` (format, length, New
   project, the cost line, the stale-brief question), shown for
   `shortlisted` cases as now.
6. **Search demand**: the target keyword as a card with four labelled
   figures (searches a month with "VidIQ estimate", search volume /100,
   competition /100 with a word, trend). Competition words: 0 to 33 low,
   34 to 66 medium, 67 to 100 high; volume words the same split as low,
   moderate, high. Then "Other keywords" as a table (keyword, a month,
   volume, competition, Make target in a fixed last column). Then
   "Searched video titles" with its one-line explanation ("People typing
   the title of one specific video. Proof the subject is pulling searches
   now; not a keyword you can rank for.") and the monthly estimate and
   growth for each.
7. **Evidence**, each collapsed with a summary on its closed line: winning
   videos (count and best breakout), searched questions (count), told
   already (count), other languages (count).
8. **Footer**: a one-line summary of subject, people and source links,
   Edit details (opens today's form in place), and Remove case (today's
   two-step confirm) as the last control on the panel.

Suggestion rows open the same panel with Accept and Dismiss in the header
in place of the status select and research control.

**Add case** stays the primary button in the page header; its form opens
in the panel area instead of stretching across the header.

**Below the `xl` breakpoint (phone, tablet, a narrow window)**: the list alone. With `case` set,
the panel replaces the list with a "Back to cases" button at the top.
Form fields lose their fixed widths and go full width.

**Accessibility**: every repeated button carries its subject in its
accessible name ("Make target: stellantis jeep", "Use this angle: Follow
one Jeep dealer…", truncated); the list is a `nav` landmark labelled
"Cases"; the panel is a `section` labelled by the case title; headings run
h1 page, h2 case title, h3 panel sections.

## Constraints

- Mock-provider mode by default (CLAUDE.md rule 6). The rate step has a
  mock answer; no test spends.
- The rating's model call goes through the existing LLM task path and
  writes a `cost_ledger` row like every other research step.
- `searchedTitles`, `otherLanguages`, `recommendedAngle` and
  `recommendationReason` are additions to a jsonb document with defaults;
  no migration is needed.
- Tests land with the code (spec 13): unit tests for the classifier and its
  edge cases (the Sears seven-word term stays a keyword; the Stellantis rows
  from the owner's screenshot classify as in the worked example below;
  "co-founder" is not punctuation; the prefix rule needs three words),
  the upgrade (idempotent, re-picks the target), the Demand score, the rate
  prompt's parser, the panel component, and the e2e spec in mock mode.
- `pnpm typecheck`, `pnpm lint` and Prettier stay clean.

## Worked example: the Stellantis brief as stored

Stored target and secondaries, with the classifier's verdict:

| Term | Kind | Why |
| --- | --- | --- |
| stellantis is losing everything: jeep, dodge & fiat on the brink | title | colon |
| a stellantis está perdendo tudo: jeep, dodge e fiat à beira do abismo | other language | accents |
| stellantis is falling apart — jeep, dodge & chrysler owners should be worried | title | dash |
| stellantis lo está perdiendo todo: jeep, dodge y fiat al borde del abismo | other language | accents |
| stellantis is losing everything across the uk: vauxhall, peugeot & fiat on the brink | title | colon |
| jeep made billions. then stellantis happened. | title | full stop |
| stellantis is losing everything | title | opening words of a title |
| stellantis lo está perdiendo todo en méxico: jeep, dodge y fiat al borde del abismo | other language | accents |
| stellantis lo está perdiendo todo: jeep, dodge y fiat, al borde del abismo | other language | accents |
| leapmotor stellantis | keyword | none of the above |

After the upgrade the target is "leapmotor stellantis" and there are no
other keywords. That is a weak target for a decline story; the panel
makes Research again the obvious suggestion when the target has an
`overall` below 50 or there is none (wording is the builder's).

## Calls made after the builder check (not discussed with the owner)

- **Where the upgrade lives.** One shared function in the schemas package
  (`upgradeSearchBrief`), so cases and projects cannot drift; both read
  paths call it (the owner's answer below).
- **"Angle chosen" covers your own angle.** `cases.angle` also holds the
  owner's angle idea from Add case, so its text alone cannot say whether an
  angle was chosen. The brief gains `ownAngle: boolean` (default false),
  set by `chooseCaseAngle` for an own angle and cleared when an option is
  chosen. The angle counts as chosen when `chosenAngle !== null ||
  ownAngle`. A fresh research run writes a new brief, so both reset; the
  `cases.angle` text stays and feeds the next run as the angle idea, as
  now. Old briefs where the owner kept their own angle read as not chosen
  until Save my angle is pressed again. Accepted.
- **A null target is already legal.** `targetKeyword` has always been
  nullable (research with no measured keyword), and the dossier, script,
  metadata, tags and publish code already handle null. The upgrade adds no
  new state downstream. Start a project is not blocked by a null or weak
  target; the panel shows the Research again suggestion above it instead.
- **Matching answers to questions** for the Demand score: lowercased and
  trimmed, as `parseAngleOptions` already canonicalises them.
- **The rate step sees the numbers.** Each option's Demand score and its
  parts are inputs to the prompt, so the digit guard accepts exactly those
  figures and any figure already in the other inputs.
- **The recommendation follows the options.** Any write that replaces
  `angleOptions` (a research run) also writes `recommendedAngle` and
  `recommendationReason` fresh (the run's own rate step), never carrying
  old ones over. Rate the angles takes the lock `lockCaseResearch` takes,
  is disabled while a research run is going, and refuses to save when the
  options changed under it (compare the option text it rated).
- **Breakpoints.** Two panes from `xl` (1280px) up, where the panel has
  about 660px beside a 280px rail and a 340px list. Below `xl` the
  single-view pattern applies (the list, or the open case with Back to
  cases). The Other keywords table stacks its figures under each keyword
  below `sm`.

## Left to the builder

- Component boundaries and file split under `cases/`, and whether the
  panel is a server or client component (the list must stay fast to
  switch: a `Link` with `scroll={false}` and the server render is fine).
- The exact cost estimate wording on Rate the angles, from existing
  estimate helpers.
- Whether "rate the angles" runs as an Inngest step only, with the button
  sending an event, or as a server action calling the step function. Follow
  the pattern research already uses; the button must show progress and
  survive a refresh like the research control does.
- Loading and error states for the panel, following the research control.
- PROGRESS.md section, branch name and decision numbers (fetch master at
  merge; numbers collide across sessions).

## Answered by the owner after the builder check

- **Frozen project briefs are upgraded too.** The projects read path
  (`storedBrief` in `packages/db/src/projects.ts`) runs the same
  `upgradeSearchBrief`, so a project already in production (Stellantis)
  stops using a video title as its target in titles, description, tags and
  the publish screen. Nothing already generated is rewritten: a script or
  outline written from the old target stays; only steps run from now on
  see the upgraded brief. A regression test pins that a frozen brief with
  a title target reads back with the title in `searchedTitles` and the
  target re-picked.
- **Old angles that served a title say so plainly.** When an option's
  keyword is no longer a keyword, the keyword part of its Demand score is
  0 and the card reads "Serves a searched title, not a keyword" in place
  of "Serves <keyword>". When any option is in that state, or the brief's
  target is null or weak (`overall` below 50), a Research again
  suggestion sits above the angles with its credit figure. Rate the
  angles still runs on such briefs; the model weighs the gap and the
  questions answered, and is told which options serve a searched title.
