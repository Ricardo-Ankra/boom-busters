import { fixtureId } from '@boom-busters/schemas'
import type { NewCase, NewProject } from './schema'

/**
 * The fixture case and project used by dev, unit tests and E2E throughout
 * (spec section 14, M1). Ids are deterministic so a Playwright spec can
 * deep-link to `/projects/<FIXTURE_PROJECT_ID>` without first querying, and
 * so golden tests in M6 stay byte-stable.
 *
 * Wirecard is chosen deliberately: it is adjudicated, heavily documented by a
 * regulator (BaFin) and a court, and exercises all three claim confidence
 * levels the dossier gate cares about.
 */

export const FIXTURE_CASE_ID = fixtureId('CASE', 1)
export const FIXTURE_PROJECT_ID = fixtureId('PROJECT', 1)
export const FIXTURE_DOSSIER_ID = fixtureId('DOSSIER', 1)

export const fixtureCase: NewCase = {
  id: FIXTURE_CASE_ID,
  title: 'Wirecard',
  category: 'con',
  angle: 'The €1.9 billion that was never there — and the auditors who signed it off anyway.',
  demandNotes: 'Steady evergreen search demand; spikes on each Braun/Marsalek court date.',
  competitorLinks: [
    { url: 'https://www.ft.com/wirecard', note: 'FT investigation series — the primary source' },
  ],
  priorityScore: 90,
  status: 'shortlisted',
}

export const fixtureProject: NewProject = {
  id: FIXTURE_PROJECT_ID,
  caseId: FIXTURE_CASE_ID,
  title: 'Wirecard: The €1.9 Billion That Never Existed',
  stage: 'dossier',
  // `queued`, not `awaiting_review`: the fixture has never been run, and a
  // project claiming to await a review of work that does not exist is a lie
  // the console would repeat on its dashboard.
  stageStatus: 'queued',
  targetRuntimeMin: 18,
}

export interface FixtureClaim {
  id: string
  text: string
  sourceUrl: string | null
  sourceType: 'court' | 'regulator' | 'major_outlet' | 'book' | 'other'
  confidence: 'sourced' | 'single_source' | 'unverified'
}

/**
 * One claim at each confidence level. The dossier gate blocks approval while
 * any `unverified` claim is neither verified nor quarantined, so the fixture
 * carries exactly one — that is the blocked state the review UI must show.
 */
export const fixtureClaims: FixtureClaim[] = [
  {
    id: fixtureId('CLAIM', 1),
    text: 'BaFin banned short selling of Wirecard shares for two months in February 2019.',
    sourceUrl: 'https://www.bafin.de/',
    sourceType: 'regulator',
    confidence: 'sourced',
  },
  {
    id: fixtureId('CLAIM', 2),
    text: 'Wirecard reported €1.9 billion in trustee accounts that auditors could not confirm existed.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 3),
    text: 'Jan Marsalek is alleged to have maintained contacts with foreign intelligence services.',
    sourceUrl: null,
    sourceType: 'other',
    confidence: 'unverified',
  },
]
