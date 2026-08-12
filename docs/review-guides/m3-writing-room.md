# M3 — Writing room · human review walkthrough

The canonical checklist for reviewing what M3 shipped. Run it against the
Vercel deployment rather than `pnpm dev`: the runners have never been driven
against Inngest Cloud, so this walkthrough is also the proof that they work.

## Which mode you are in decides whether this costs money

An earlier version of this guide said the walkthrough runs in mock mode and
costs nothing. That is true locally and **false on the deployment**.

`mockProvidersEnabled()` returns true only when `MOCK_PROVIDERS=1`. That is set
in `.env.local` and in CI; it is deliberately *not* set in production, because
production is where real videos get made. So on the deployment, with a real
Anthropic key stored, **every pipeline run calls Opus and Sonnet and is billed
to you**.

Settings → Connections now states which mode the deployment is in, at the top
of the tab. Check it before you start.

What stands between a walkthrough and a surprise bill is the budget guard:
Anthropic is capped at **$30/month**, and a run that would cross the cap parks
on a budget gate instead of spending. A single dossier run is on the order of a
dollar or two.

If you would rather review without spending, run `pnpm dev` locally —
`.env.local` has `MOCK_PROVIDERS=1`, and everything below behaves identically
with placeholder text.

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

On a *Shortlisted* row → **New project**. That is the whole of it: **there is
no Start button anywhere, and there should not be one.** Research begins when
the project is created, and each later stage begins when the one before it is
approved.

Open the project and the screen says so in as many words: *"Queued. The
pipeline picks this up within a few seconds — nothing to press."*

- The project appears at **Dossier · queued** with the pulsing
  "Updating automatically" marker.
- Within seconds it moves to *running*, then parks at the gate —
  **without you refreshing**.

| What you see | What it means |
|---|---|
| No button, "nothing to press" | Normal. It is on its way. |
| **Stop** | A run is live. This is the only control while one is. |
| **Run the dossier stage again** | Nothing is running — it failed, was stopped, or its event never arrived. Pressing it costs what the stage cost the first time. |
| "Queued for several minutes with no run behind it" | The event never reached Inngest. Check the sync, then use the button beside the message. |

**If you saw "Start demo pipeline" here, you are on an old deployment.** That
button was M2 scaffolding and is gone. Pressing it started a no-op run
*alongside* the real research, which then opened fake review gates on a real
project — approving one sent the script runner after a dossier that had never
been written. See PROGRESS.md, M3.1.

---

## 2b · Moving between stages

The rail at the top is eight buttons, not a progress bar. Any stage that holds
something is a link.

| Do this | Expect |
|---|---|
| From the script stage, click **Dossier** | The dossier and its claims, with the URL at `?stage=dossier` |
| Look at the banner | *"You are reading the dossier. This project is on script, so nothing here can be approved from this screen."* |
| Look for **Approve** | Not there. Approving from an off-stage screen would approve whatever gate the project is actually parked at |
| Click **Back to script** | Returns to where the project is |
| A stage with nothing in it (Voice, before M4) | Plain text, not a link — nothing to open |

**Re-running a stage.** Any completed stage carries a re-run button on its own
screen. The confirm names what it costs you downstream by name:

> *"The script stage will be marked as built from older work — kept and still
> readable, but needing a re-run to be current again."*

Nothing downstream is deleted. That is a deliberate decision (PROGRESS.md,
M3.2): a mis-click must not destroy work you paid for. A stale stage keeps its
screen, keeps its content, and gains a badge and a re-run button.

**What you will see on existing projects.** Scripts written before this shipped
have no record of which dossier they came from, so they report *"predates
provenance tracking"* rather than claiming to be current. That is accurate —
nothing checked it at the time.

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

Approve the dossier. The gate bar stands its buttons down and says *"Handed to
the pipeline"* — an approval is delivered to Inngest and applied seconds later
in another process, so a second press would land on a run no longer waiting for
one.

**That note is temporary in both directions now.** It clears itself after 30
seconds, it carries a **Show the buttons again** control, and it belongs to the
gate it was raised on — so it cannot follow you to the script gate. It used to:
a finished script would arrive at its gate with no Approve and no Request
changes, under a note about an approval given minutes earlier.

The screen then advances on its own to **Script**, and when the script is
written the bar comes back with *"N chapters · N self-check warnings"*.

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
| ~~Shorts candidates generated then discarded~~ | **Fixed** | Persisted to `scripts.shorts_candidates` and shown in the Studio context panel. |
| ~~Chapter outline does not drag-reorder~~ | **Fixed** | Drag, plus up/down buttons so it is not pointer-only. Reordering reports how many chapters now follow different text, because the prose seams are not rewritten. |
| ~~One-click hedge prefixes "Reportedly,"~~ | **Fixed** | The button now runs a regenerate scoped to that sentence and opens the diff, so the wording is approved rather than applied unseen. |
| ~~No Verify button in Connections~~ | **Fixed** | M1 deferred it to M3 and it was missed. A stored key now reads "stored, not verified" until you press Verify. A provider outage leaves it unchecked rather than marking a good key invalid. |
| **The runners are not driven end to end in tests.** `@inngest/test` cannot get past a `waitForEvent`. | Medium | This walkthrough, run on the deployment, is the proof. |
| **Model prices are provisional** (accepted 2026-08-11). | Low | After the first live run, compare ledger totals to the provider dashboards. If they diverge more than ~10%, update the adapter tables. One 15-minute check. |
| **No notification delivery is configured.** | Deferred | Deliberate (2026-08-11). The plumbing is built; `notify()` logs and carries on, and nothing depends on it — the Needs-you queue reads from the database. When it is worth enabling, use **Resend email, not web push**: push needs a running desktop browser, or the site installed as a PWA on iOS. Revisit around M6, when renders make waits long enough to walk away from. |
