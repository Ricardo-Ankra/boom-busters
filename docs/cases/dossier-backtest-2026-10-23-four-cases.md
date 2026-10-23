# Dossier back-test, 2026-10-23

Five closed cases, the real gather and the four research passes. Model on the ledger: claude-opus-5-5.

## Quote-found rate

Target: at least 90.0%.

| Case | Rate |
| --- | --- |
| Enron | 100.0% |
| Theranos | 100.0% |
| FTX | 100.0% |
| SVB Financial | 100.0% |
| Overall | 100.0% |

## URL resolution rate

Target: at least 70.0%.

| Case | Rate |
| --- | --- |
| Enron | 79.4% |
| Theranos | 84.0% |
| FTX | 65.2% |
| SVB Financial | 84.8% |
| Overall | 78.8% |

## Figure match rate

Target: at least 80.0% of checkable points.

| Case | Rate |
| --- | --- |
| Enron | not measured (0 matched, 0 mismatched, 6 not checkable) |
| Theranos | not measured (0 matched, 0 mismatched, 5 not checkable) |
| FTX | not measured (0 matched, 0 mismatched, 4 not checkable) |
| SVB Financial | 95.5% (21 matched, 1 mismatched, 1 not checkable) |
| Overall | 95.5% (21 matched, 1 mismatched, 16 not checkable) |

## Told-already rate

Target: Reported only; no transcript source exists (the YouTube caption endpoint answers 404 to unsigned requests, confirmed 2026-10-22).

| Case | Rate |
| --- | --- |
| Enron | 0.0% |
| Theranos | 0.0% |
| FTX | 0.0% |
| SVB Financial | 0.0% |
| Overall | 0.0% |

## Transcript availability

Target: reported only, no target.

| Case | Rate |
| --- | --- |
| Enron | 0.0% |
| Theranos | 0.0% |
| FTX | 0.0% |
| SVB Financial | 0.0% |
| Overall | 0.0% |

## Cost

Target: at most $6.00 per dossier.

| Case | Cost | Model |
| --- | --- | --- |
| Enron | $2.70 | claude-opus-5-5 |
| Theranos | $2.35 | claude-opus-5-5 |
| FTX | $1.47 | claude-opus-5-5 |
| SVB Financial | $1.88 | claude-opus-5-5 |
| Overall | $2.10 mean, $2.70 highest | |

## Pass durations

Target: every step under 200.0 s; a step has 300 s, and a split pass shows its slowest part. A pass that did not run shows 0.0 s.

| Case | Brief | Scenes | Claims | Answers |
| --- | --- | --- | --- | --- |
| Enron | 182.3 s | 885.6 s | 85.4 s | 65.9 s |
| Theranos | 86.3 s | 137.7 s | 87.2 s | 100.2 s |
| FTX | 73.2 s | 77.7 s | 81.0 s | 62.1 s |
| SVB Financial | 74.5 s | 82.3 s | 76.4 s | 60.9 s |

## Verdict

Incomplete. Not every case was scored, so this run proves nothing yet; the rollout stops.

Failing:

- skipped: Wirecard
- maxPassMs: Enron scenes pass took 885.6 s, over the 200.0 s limit
## Cases not scored

- Wirecard: read ECONNRESET
