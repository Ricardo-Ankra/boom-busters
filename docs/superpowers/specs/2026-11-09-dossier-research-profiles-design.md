# Dossier research profiles

Date: 2026-11-09. Status: approved direction (owner, 2026-11-09: "Proceed with
your recommendations"). Decision 446 (provisional: renumber at merge if master
moves). This is "project 3" of the channel bible design (2026-10-28, sections 2
and 3): research sources per channel and per-channel claim grading.

## 1. Why

The dossier was designed for Boom & Busters: corporate collapses and frauds,
told as documentaries, where the liability is calling an allegation a fact.
Multi-channel work since then moved the wording into the bible (five
`dossier-*` example slots) but not the structure. The owner wants the dossier
to work for other channels and formats: abstracted, with guardrails, rules,
checks and feedback loops instead of corporate rules written into code.

The principle carries over from the formats design (2026-11-03): **the code is
the playbook, the bible is the channel.** A channel cannot write its own
research method; it picks one of the playbooks in code and fills its slots.

## 2. Production state (read 2026-11-09, read only, with permission)

- **Boom & Busters**, bible v3, complete. One "Documentary" format, tension.
- **Real Power Pyschology** (name as stored), bible v1 blank and incomplete;
  its only content is the 2026-11-03 draft, a copy of Boom & Busters' bible.
  No cases, no projects. There is no psychology data to learn from yet.
- Three dossiers were researched by the grounded pipeline (Theranos,
  Stellantis, WeWork). Each read 49 to 65 documents, of which **72 to 83% were
  `reporting`**, almost all Wikipedia-cited. None read a video or a court
  record; one read a figures document and three filings (WeWork). 21 to 31
  documents per gather failed to fetch, about 30%. Zero unverified claims in
  all three.

The corporate sources (EDGAR, XBRL, Stooq, Wayback, CourtListener) add little
in practice. Wikipedia's references carry the corpus, and every topic has
them. That makes subject resolution the largest single unlock.

## 3. Audit

### 3.1 What is already channel-agnostic, and stays

- The extractor rule: every claim, scene and answer cites a numbered document
  and quotes it; grounding finds the quote in stored text
  (`packages/providers/src/research/ground.ts`).
- Confidence computed from found quotes and distinct publishers, wire copies
  counted once (`research/confidence.ts`).
- Honest nulls for unanswered questions.
- Repair then validate, one retry, passes split into parts, the cached corpus
  prefix, the budget gate, the review gate where unverified claims block
  Approve, and the reviser.

### 3.2 What is still Boom & Busters

| Layer | Fixed in code | Effect off corporate topics |
|---|---|---|
| Subject | `resolveEntity` accepts only a business or organisation hit (`dossier-discover.ts:48`, `:193`) | A concept or event resolves `unresolved`, and an unresolved subject reads no Wikipedia page (`:308`) |
| Sources | EDGAR, XBRL, Stooq, Wayback of the company site, CourtListener, Wikipedia references, YouTube | Every source except YouTube and person pages is keyed on a company identifier |
| Primary | Government hosts only (`case-finder/src/sources/references.ts:10`); related articles only on scandal, collapse, bankruptcy, fraud, affair (`dossier-discover.ts:63`) | A journal article is filed as reporting |
| Kinds and tiers | 8 kinds, 5 tiers, fixed shares (`schemas/src/dossier.ts:78-118`) | No kind for a study, review or scholarly book |
| Grading | `ruled / alleged / none` only; the script reads it as ADJUDICATED or NOT adjudicated (`prompts/script.ts:76`) | Nothing says whether a finding replicated |
| Prompt frame | "a documentary channel with commentary", "Real companies and living people" (`prompts/dossier.ts:69-87`) | Wrong frame for an explainer |
| Depth | 120k-token corpus, about 40 claims, two parts | A 180-minute calm format researches like a 15-minute film |
| Evaluation | Five corporate back-test cases (`apps/web/lib/dossier-backtest.ts:18`) | No way to see a regression or a gain off corporate topics |

### 3.3 Defects found on the way

1. The gate line says `Subject: X (company)` whatever the bible's noun
   (`dossier-research.ts:607`).
2. A claim whose lead support is a YouTube video is typed `major_outlet`
   (`ground.ts:34`), the type `claimCarriesArticle` reads to aim a headline
   card at news. A competitor's video can pass for a news article. No
   production dossier has read a video yet, so nothing shipped is affected.
3. The case's category reaches the prompt as its key ("con"), not its pillar
   label. Left alone here: changing it changes Boom & Busters' prompts.
4. `toldAlready` cannot fill while transcripts are off (decision on
   `YOUTUBE_TRANSCRIPTS`). Known; not addressed here.

## 4. Goals, non-goals, anti-goals

**Goals (this design)**

1. A **research profile** in code: everything topic-specific the dossier uses,
   in one object, chosen by the bible.
2. Two profiles: `investigation` (today's behaviour, byte for byte) and
   `science` (the psychology channel's).
3. An **evidence axis** per profile, beside the legal grading, which stays for
   every channel.
4. Subject resolution that accepts a topic, not only a business.
5. A back-test per profile, so a change is measured, not hoped.

**Roadmap (later plans, same design)**

6. `history` profile, after `science` has proved the seam.
7. Source adapters beyond Wikipedia: OpenAlex or Crossref, PubMed, Wikisource,
   Internet Archive texts; a general web search adapter, mocked unless the
   owner turns it on (paid).
8. Brief shapes per profile: a shared core plus profile sections (an explainer
   needs concept, mechanism, key studies, misconceptions, limits).
9. Research depth from the format: corpus budget, claim caps and parts scale
   with runtime and intent. A format may override depth only, never the
   profile (owner, 2026-11-09).
10. Coverage loop (section 8).
11. Learning loop (section 9).

**Non-goals**

- A channel writing its own research method or prompt.
- Changing how case research (VidIQ) works.
- New brief sections in this plan (goal 8 is later).

**Anti-goals** (failure even if it works)

- Any Boom & Busters prompt changing by one character: the lift fixtures stay
  unchanged.
- A profile able to switch off an invariant (section 5.1).
- A model raising a claim's standing without checked documents behind it.
- Paid calls in development or tests without the owner asking.

## 5. Architecture

### 5.1 Three layers

1. **Invariants**, code, every channel, no switch: the extractor rule and the
   quote check; computed confidence; honest nulls; unverified claims block
   Approve; the budget gate; and the **legal grading** (`ruled / alleged /
   none`, the verdict words, ruled needing a court or regulator document or a
   reported verdict). The legal grading is the living-person guardrail: a
   psychology film that says a researcher faked data carries "alleged" exactly
   as a fraud film does.
2. **Research profiles**, code, chosen in the bible (section 6).
3. **Channel values**, the bible: the profile choice, the five dossier slots,
   hedging rules. Later: trusted and blocked domains, extra sources.

### 5.2 One rule for every graded axis

**A downgrade is free; an upgrade is earned.** The model may always give a
claim a weaker standing. A stronger one stands only when grounding finds the
documents that earn it, and otherwise falls to the profile's fallback with a
repair notice. This is the rule `ruled` already follows (decision 6) and the
one every evidence axis follows.

## 6. Research profiles

### 6.1 The shape

Data in `packages/schemas/src/research-profiles.ts`; prompt text in
`packages/providers/src/prompts/dossier-profiles.ts`, keyed by profile.

| Field | Meaning |
|---|---|
| `key` | `investigation` or `science` |
| `label`, `description` | Shown in the Bible tab |
| `subject.accept` | `business` (today's test) or `topic` (any article that is not a disambiguation page or a list) |
| `subject.relatedWords` | Words in a hit's title that make it a related article to read |
| `sources` | Which keyed sources run: `edgar`, `xbrl`, `stooq`, `wayback`, `courtlistener` |
| `scholarlyHosts` | Hosts whose references are filed as `scholarly`; empty for none |
| `tiers` | Tier per document kind |
| `tierShares` | Share of the corpus budget per tier |
| `evidence` | The evidence axis, or null (section 7) |

Prompt text per profile: the opening paragraph of the house rules (who the
researcher is) and the stakes line, and the evidence rules paragraph when the
profile has an axis.

### 6.2 `investigation`

Today's values moved, not changed: `accept: business`, the five related words,
every keyed source on, no scholarly hosts, `DOCUMENT_TIERS` and
`DOSSIER_TIER_SHARES` as they are, `evidence: null`, and today's house rules
text. A stored bible without a profile reads as `investigation`.

### 6.3 `science` (v1)

- `accept: topic`; related words: experiment, effect, replication,
  controversy, criticism, study.
- No keyed source (no company identifiers to key them on).
- Scholarly hosts: doi.org, pubmed.ncbi.nlm.nih.gov, ncbi.nlm.nih.gov,
  europepmc.org, psycnet.apa.org, apa.org, sciencedirect.com, springer.com,
  wiley.com, tandfonline.com, sagepub.com, nature.com, science.org, pnas.org,
  jstor.org, frontiersin.org, plos.org, cambridge.org, academic.oup.com,
  annualreviews.org, osf.io, psyarxiv.com, arxiv.org, ssrn.com. Matched on the
  registrable domain or a subdomain of it, as `isPrimaryReference` matches.
- Tiers: `scholarly` 1, `reporting` 2, `video` 3, `figures` 4, `regulator` and
  `court` 5; the corporate kinds keep their tiers (unused). Shares: tier 1
  0.40, tier 2 0.30, tier 3 0.10, tier 4 0.05, tier 5 0.15.
- House rules: the researcher looks for the studies, what they measured and
  found, the people who ran them and what they wanted to show, the moments a
  film can show, the numbers, and what earlier videos told. Stakes: real
  researchers, participants and living people are the subject. Two added
  bullets: distinguish what a study MEASURED from what its authors or the press
  CLAIMED it shows, and say when a finding failed to replicate; never turn a
  finding into advice to the viewer.
- Evidence axis: section 7.2.

## 7. Evidence axis

### 7.1 Shape and storage

A profile's axis is a closed list of statuses, each with a script label and a
review label, one **earned** status with its rule, and the fallback an unearned
claim falls to. The model writes it per claim beside `legal`:

`"evidence": {"status": <one of the profile's>, "doc": number} | null`

null for a claim that states no finding (a date, who ran a study). The JSON
shape and its rules appear in the claims and answers prompts only when the
profile has an axis, so `investigation` prompts do not change.

Stored on `claims` as `evidence_status text` and `evidence_document_id text`
(references `research_documents`, set null on delete), both nullable. Text
rather than an enum because each profile has its own list; the profile
validates on write. The grounded claim carries
`evidence: { status, documentId } | null`.

The script's claim list appends the profile's script label after today's
markers, so a Boom & Busters claim list is unchanged. The channel's
`hedgingRules` say how to narrate each label; the bible already owns that.

### 7.2 `science` statuses

| Status | Script label | Review label | How it stands |
|---|---|---|---|
| `established` | ESTABLISHED FINDING | Established | Earned: at least two distinct `scholarly` documents among the claim's found supports, or one found `scholarly` support whose quote says meta-analysis, meta-analyses, meta-analytic or systematic review |
| `single_study` | ONE STUDY | One study | The fallback for an unearned `established` |
| `contested` | CONTESTED | Contested | Always allowed: a downgrade |

The earning words are deliberately narrow. "Replicated" is not one: "was not
replicated" contains it.

## 8. Coverage loop (later plan)

1. **Research plan** before the gather: the questions the dossier must answer,
   from the profile's template, the angle, the searched questions and the
   format.
2. **Coverage check** after the passes, in code: plan questions answered,
   material in proportion to runtime, a floor on source variety, a dated
   current status where the profile needs one.
3. **Critic** pass: one-sidedness, missing counter-evidence (failed
   replications, dissenting historians).
4. Gaps get **one** targeted gather and research round, budget gated; the
   gate card shows coverage either way. Plan 3 of the motion work is the
   precedent for a bounded critic loop.

## 9. Learning loop (later plan)

The owner's verify, quarantine and Request changes notes are logged per
channel. A tuning proposal suggests profile adjustments (hosts, shares,
related words); nothing changes until the owner approves, as with the motion
preference ledger.

## 10. Bible

`researchProfile: 'investigation' | 'science'`, in the Identity section,
default `investigation`. A select in the Identity editor with each profile's
label and description; Draft with AI is told the choices; Copy carries it. A
project freezes its bible, so a project keeps the profile it started with.
Not required by `missingBibleFields`: the default is a working value.

## 11. Evaluation

The back-test gains a profile per case and science cases: Stanford prison
experiment (Philip Zimbardo), Ego depletion (Roy Baumeister), Stanford
marshmallow experiment (Walter Mischel), Power posing (Amy Cuddy), Milgram
experiment (Stanley Milgram). The replication crisis runs through all five,
so a working axis must show `contested` and `single_study` claims, not only
`established`. New measures: subject resolved, the scholarly share of read
documents (target 0.2 or more for `science`), and the status mix. Live runs
spend money and run only when the owner asks.

## 12. Plans

1. **This plan**: the profile seam, `investigation` byte for byte, the bible
   field, topic resolution, the `scholarly` kind, the evidence axis, the
   `science` profile, the back-test, defects 3.3.1 and 3.3.2.
2. Sources: OpenAlex or Crossref, PubMed, Wikisource, Internet Archive texts,
   web search (mocked by default); the `history` profile.
3. Brief shapes per profile.
4. Depth from the format.
5. Coverage loop.
6. Learning loop.

## 13. Owner actions at deploy (this plan)

1. One migration: `document_kind` gains `scholarly`; `claims` gains
   `evidence_status` and `evidence_document_id`. Compare journals with master
   before merging: another session holds 0052.
2. `PUT /api/inngest` after the Vercel deploy.
3. Optional, paid, owner's go-ahead: the live back-test on the science cases.

## 14. Risks

- Journal pages are often paywalled: a scholarly reference may give only an
  abstract. Accepted for v1; plan 2's open-access adapters address it.
- A topic resolver can pick the wrong article for an ambiguous subject. The
  gate line names the subject it resolved, so the owner sees it before
  Approve.
- Parked runs replay old step results: a profile read outside a step would
  crash a run parked before the deploy. The profile is read inside each step
  from the frozen bible, as the bible is today.
