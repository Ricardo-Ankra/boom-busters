# Dossier back-test, 2026-10-22

Five closed cases, the real gather and the four research passes. Model on the ledger: claude-opus-5-5.

## Quote-found rate

Target: at least 90.0%.

| Case | Rate |
| --- | --- |
| Wirecard | 100.0% |
| Enron | 100.0% |
| Theranos | 100.0% |
| FTX | 100.0% |
| SVB Financial | 98.9% |
| Overall | 99.8% |

## URL resolution rate

Target: at least 95.0%.

| Case | Rate |
| --- | --- |
| Wirecard | 60.2% |
| Enron | 71.1% |
| Theranos | 84.0% |
| FTX | 66.3% |
| SVB Financial | 87.5% |
| Overall | 74.2% |

## Figure match rate

Target: at least 80.0% of checkable points.

| Case | Rate |
| --- | --- |
| Wirecard | not measured (0 matched, 0 mismatched, 0 not checkable) |
| Enron | not measured (0 matched, 0 mismatched, 5 not checkable) |
| Theranos | not measured (0 matched, 0 mismatched, 6 not checkable) |
| FTX | not measured (0 matched, 0 mismatched, 4 not checkable) |
| SVB Financial | 100.0% (14 matched, 0 mismatched, 0 not checkable) |
| Overall | 100.0% (14 matched, 0 mismatched, 15 not checkable) |

## Told-already rate

Target: at least 90.0% over videos with a transcript.

| Case | Rate |
| --- | --- |
| Wirecard | 0.0% |
| Enron | 0.0% |
| Theranos | 0.0% |
| FTX | 0.0% |
| SVB Financial | 0.0% |
| Overall | 0.0% |

## Transcript availability

Target: reported only, no target.

| Case | Rate |
| --- | --- |
| Wirecard | 0.0% |
| Enron | 0.0% |
| Theranos | 0.0% |
| FTX | 0.0% |
| SVB Financial | 0.0% |
| Overall | 0.0% |

## Cost

Target: at most $6.00 per dossier.

| Case | Cost | Model |
| --- | --- | --- |
| Wirecard | $2.38 | claude-opus-5-5 |
| Enron | $2.17 | claude-opus-5-5 |
| Theranos | $2.86 | claude-opus-5-5 |
| FTX | $1.61 | claude-opus-5-5 |
| SVB Financial | $2.16 | claude-opus-5-5 |
| Overall | $2.24 mean, $2.86 highest | |

## Pass durations

Target: every pass under 200.0 s; a step has 300 s. A pass that did not run shows 0.0 s.

| Case | Brief | Scenes | Claims | Answers |
| --- | --- | --- | --- | --- |
| Wirecard | 73.5 s | 95.1 s | 318.7 s | 253.4 s |
| Enron | 82.9 s | 102.4 s | 265.9 s | 122.9 s |
| Theranos | 87.5 s | 108.5 s | 306.8 s | 313.9 s |
| FTX | 80.2 s | 78.1 s | 273.2 s | 52.5 s |
| SVB Financial | 74.7 s | 97.1 s | 282.3 s | 94.6 s |

## Verdict

Fail. The rollout stops until these are fixed.

Failing:

- urlResolved: 74.2% is under the 95.0% target
- toldAlready: 0.0% is under the 90.0% target
- maxPassMs: Wirecard claims pass took 318.7 s, over the 200.0 s limit
- maxPassMs: Wirecard answers pass took 253.4 s, over the 200.0 s limit
- maxPassMs: Enron claims pass took 265.9 s, over the 200.0 s limit
- maxPassMs: Theranos claims pass took 306.8 s, over the 200.0 s limit
- maxPassMs: Theranos answers pass took 313.9 s, over the 200.0 s limit
- maxPassMs: FTX claims pass took 273.2 s, over the 200.0 s limit
- maxPassMs: SVB Financial claims pass took 282.3 s, over the 200.0 s limit
