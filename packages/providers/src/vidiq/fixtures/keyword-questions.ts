/**
 * A hand-made stand-in for a `questions` mode answer, in the recorded matching_terms format.
 * Not a recording: no live call was made (fixtures/README.md). The figures are invented.
 */
export const KEYWORD_QUESTIONS_MARKDOWN = `## Keyword research — mode: questions · query: wework · sort: volume

### questions (6)
| keyword | volume | competition | overall | estimatedMonthlySearch | searchDemandGrowthPct |
|---|---|---|---|---|---|
| why did wework fail | 61 | 42 | 59 | 12400 | +24.6% |
| how did wework go bankrupt | 58 | 47 | 56 | 8900 | null |
| what happened to wework | 57 | 55 | 51 | 7600 | -12.3% |
| who owns wework now | 49 | 33 | 60 | 3100 | null |
| is wework still in business | 47 | 29 | 62 | 2700 | +8.0% |
| how did adam neumann get rich | 44 | 51 | 47 | 2100 | null |

Note: Null or missing values are unknown, not 0: report those rows separately and keep real zeros and negative changes.
`
