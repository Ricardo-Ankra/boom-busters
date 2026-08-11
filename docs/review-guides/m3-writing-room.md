# M3 — Writing room · human review walkthrough

The canonical checklist for reviewing what M3 shipped. Run it against the
Vercel deployment rather than `pnpm dev`: the runners have never been driven
against Inngest Cloud, so this walkthrough is also the proof that they work.

Everything below runs in **mock-provider mode** — no paid API calls, no spend.
The dossiers and scripts you see will be placeholder text that says so.

---

## Before you start

- Sign in as the allowlisted owner account.
- The seeded **Wirecard** fixture project exists and is parked at the dossier
  gate. It carries one claim at each confidence level on purpose.

---

## 1 · Case Library — `/cases`

| Do this | Expect |
|---|---|
| **Suggest cases** → 5 → **Get suggestions** | A "Suggested — 5 waiting on you" block appears above the backlog |
| Read the row titles | Every one reads *"[mock suggestion N] not a real case"* |
| **Get suggestions** again, same count | Toast reports mostly *"already in your library"* |
| **Accept** one | Leaves the suggested block, appears in Backlog as *Shortlisted* |
| **Dismiss** another | Disappears entirely |
| **Add case** by hand | Lands *Shortlisted*, not *Suggested* |
| The four **Sort by** buttons | URL gains `?sort=…`; order changes; survives reload |

**Judgement:** does the screen keep "a model proposed this" visibly separate
from "I decided to make this"? That separation is the point of triage.

**Why mock titles shout:** mock rows get accepted during a demo and researched
for real weeks later by someone who has forgotten where they came from.

---

## 2 · Starting a project

On a *Shortlisted* row → **New project**.

- The project appears at **Dossier · queued** with the pulsing
  "Updating automatically" marker.
- Within seconds it moves to *running*, then parks at the gate —
  **without you refreshing**.

If it sits on *queued* forever, the dossier runner is not receiving
`project/created` and the Inngest sync is the thing to check.

---

## 3 · Dossier review

Open the fixture project (or the one you just made).

| Do this | Expect |
|---|---|
| Layout | Document left, claims right |
| Claim order | Unverified floats to the top, amber left rule |
| **Approve** | Disabled, with *"1 unsourced claim(s) — verify or quarantine each one"* beside it |
| **Quarantine** the unverified claim | Struck through, "excluded from scripting"; Approve enables |
| **Un-quarantine** | Approve disables again |
| **I checked this — add source**, paste a URL | Chip flips to *One source*; Approve enables |
| Same, but save with no URL | Refused |
| Click a source | Opens in a new tab; the row shows the domain, not the query string |

**Judgement:** is it obvious what blocks approval and what the two ways out
are?

**Enforced server-side.** The disabled button is a hint; `approveGate` refuses
outright, so a stale tab cannot bypass it.

---

## 4 · Script Studio

Approve the dossier. The screen advances on its own to **Script**.

| Do this | Expect |
|---|---|
| Header | Runtime vs target, live word count; amber *"Written with a fallback model"* only if the router downgraded |
| Left column | Chapters with runtime and warning counts |
| Editor | Warned sentences carry an amber wavy underline **in place** |
| **Insert "Reportedly"** on a `missing-alleged` warning | Sentence changes; state goes *Unsaved* → *Saving…* → *Saved* |
| Type, then stop | Autosaves after ~500ms |
| Click away without typing | **No** save recorded — the edit trail stays readable |
| Edit *around* a warned sentence | The warning stays attached |
| Genuinely rewrite a warned sentence | Listed as *"no longer in the chapter"* — reported, not dropped |

### The regenerate flow

1. Select 20+ characters → a bar appears.
2. Type an instruction → **Regenerate…**
3. You get a **diff, not a replacement**.

Verify deliberately:

- **Apply 0 of N** → the chapter returns **byte-identical**. This is what makes
  *Discard* safe.
- Accept some but not all → only those land.

**Judgement:** could a regenerate overwrite something you wrote without you
seeing it first? It should not be possible.

---

## 5 · Cross-checks

- **Costs** — the suggestion run appears in the ledger, attributed to no
  project. Every model call in M3 goes through the budget guard; there is no
  second path.
- **Settings → Models** — dropdowns show real wire ids (`claude-opus-5`, not
  `opus`). An M1-era stored value was upgraded silently on read.
- **Activity drawer** — step-by-step runner trace, including any fallback.

---

## Known gaps

| Gap | Severity | Recommended fix |
|---|---|---|
| **Shorts candidates are generated then discarded.** The gate counts them; Studio is handed an empty array and says "None marked". A model call is paid for and thrown away on every script run. | High | Persist to a `shortsCandidates` jsonb column on `scripts`, and pass it through. Not the `shorts` table — that represents a Short being produced (title, renderId), and writing rows at script time would fill the M7 Shorts screen with unbuilt items. ~1 hour. |
| **Chapter outline does not drag-reorder** (spec §11.3). | Medium | Two-phase index swap in one transaction, because `(scriptId, index)` is unique. Reordering does **not** invalidate `claim_ref` rows — they key on `chapterId`. It does leave the prose seams reading wrongly, so flag moved chapters. ~half a day. |
| **The one-click hedge prefixes** "Reportedly," rather than placing it naturally. | Low | Reuse the regenerate flow: the button pre-fills the instruction for that sentence and opens the diff. Keeps "never write without approval" and drops the awkward prefix. ~1 hour, best value of the three. |
| **The runners are not driven end to end in tests.** `@inngest/test` cannot get past a `waitForEvent`. | Medium | This walkthrough, run on the deployment, is the proof. |
| **Model prices are provisional** (accepted 2026-08-11). | Low | After the first live run, compare ledger totals to the provider dashboards. If they diverge more than ~10%, update the adapter tables. One 15-minute check. |
| **No notification delivery is configured.** | Deferred | Deliberate (2026-08-11). The plumbing is built; `notify()` logs and carries on, and nothing depends on it — the Needs-you queue reads from the database. When it is worth enabling, use **Resend email, not web push**: push needs a running desktop browser, or the site installed as a PWA on iOS. Revisit around M6, when renders make waits long enough to walk away from. |
