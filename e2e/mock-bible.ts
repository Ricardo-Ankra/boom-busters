/**
 * What the mock provider's drafting run writes, printed as JSON: every section
 * merged into one bible, and the research digest.
 *
 * A separate process because the providers package reads JSON fixtures with
 * plain `import`, which Playwright's loader refuses; tsx runs it as it is. Run
 * by bible.spec.ts, never by Playwright itself (it is not under `tests/`).
 */
import { mergeBibleUnit, mockBibleUnit, mockResearchDigest } from '@boom-busters/providers/prompts'
import { EMPTY_BIBLE, bibleDraftUnits } from '@boom-busters/schemas'

let bible = EMPTY_BIBLE
for (const unit of bibleDraftUnits()) bible = mergeBibleUnit(bible, unit, mockBibleUnit(unit))

const digest = mockResearchDigest({
  description: '',
  audience: '',
  admiredChannels: [],
  videos: [],
  avoid: '',
})
process.stdout.write(JSON.stringify({ bible, digest }))
