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
 * Nineteen claims, in the proportions a real research pass actually produces.
 *
 * This used to be three — one per confidence level — which was tidy and taught
 * every test the wrong shape. A live dossier on this same case came back with
 * **19** claims distributed like this:
 *
 * | confidence      | source type   | claims |
 * |-----------------|---------------|--------|
 * | `single_source` | major outlet  | 11     |
 * | `sourced`       | major outlet  | 6      |
 * | `sourced`       | regulator     | 1      |
 * | `unverified`    | other         | 1      |
 *
 * The proportions are the point. Most of what a model returns is single-source
 * reporting from one outlet, not corroborated fact — so the review screen's
 * real job is triaging a long amber-ish list, not looking at three rows. Tests
 * written against three rows never exercise scrolling, ordering, or the density
 * at which "unverified floats to the top" starts to matter.
 *
 * Exactly one is `unverified`, which is deliberate and load-bearing: the gate
 * blocks while any unverified claim is neither sourced nor quarantined, and one
 * blocker is the state the review UI must show.
 *
 * Every claim about a person is written the way the app's own self-check
 * demands — attributed, hedged where not adjudicated — because a fixture that
 * models sloppy attribution teaches the tests to accept it.
 */
export const fixtureClaims: FixtureClaim[] = [
  // The one regulator-sourced claim.
  {
    id: fixtureId('CLAIM', 1),
    text: 'BaFin banned short selling of Wirecard shares for two months in February 2019.',
    sourceUrl: 'https://www.bafin.de/',
    sourceType: 'regulator',
    confidence: 'sourced',
  },

  // Six corroborated claims from major outlets.
  {
    id: fixtureId('CLAIM', 2),
    text: 'Wirecard AG filed for insolvency in June 2020, days after its auditors refused to sign off the accounts.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'sourced',
  },
  {
    id: fixtureId('CLAIM', 3),
    text: 'EY declined to issue an audit opinion on the 2019 accounts, saying it could not verify around €1.9 billion in trustee balances.',
    sourceUrl: 'https://www.reuters.com/',
    sourceType: 'major_outlet',
    confidence: 'sourced',
  },
  {
    id: fixtureId('CLAIM', 4),
    text: 'Wirecard joined the DAX 30 index in September 2018, replacing Commerzbank.',
    sourceUrl: 'https://www.reuters.com/',
    sourceType: 'major_outlet',
    confidence: 'sourced',
  },
  {
    id: fixtureId('CLAIM', 5),
    text: 'The Financial Times published a series of reports from 2015 onwards questioning Wirecard’s accounting.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'sourced',
  },
  {
    id: fixtureId('CLAIM', 6),
    text: 'Chief executive Markus Braun resigned in June 2020 and was arrested days later.',
    sourceUrl: 'https://www.bbc.co.uk/news',
    sourceType: 'major_outlet',
    confidence: 'sourced',
  },
  {
    id: fixtureId('CLAIM', 7),
    text: 'Chief operating officer Jan Marsalek left Germany in June 2020 and has been the subject of an international arrest warrant since.',
    sourceUrl: 'https://www.bbc.co.uk/news',
    sourceType: 'major_outlet',
    confidence: 'sourced',
  },

  // Eleven single-source claims — the bulk of any real pass.
  {
    id: fixtureId('CLAIM', 8),
    text: 'Wirecard reported €1.9 billion in Philippine trustee accounts that auditors could not confirm existed.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 9),
    text: 'Wirecard’s market capitalisation is reported to have peaked at around €24 billion in 2018.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 10),
    text: 'A 2019 special audit commissioned from KPMG is reported to have been unable to verify a substantial share of the third-party acquiring revenue.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 11),
    text: 'Two Philippine banks named as holding the trustee balances are reported to have denied any relationship with Wirecard.',
    sourceUrl: 'https://www.reuters.com/',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 12),
    text: 'Wirecard is reported to have employed roughly 5,800 people worldwide at the time of its collapse.',
    sourceUrl: 'https://www.reuters.com/',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 13),
    text: 'BaFin is reported to have filed a criminal complaint against Financial Times journalists over their reporting on the company.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 14),
    text: 'A German parliamentary inquiry into the regulatory handling of Wirecard is reported to have run through 2020 and 2021.',
    sourceUrl: 'https://www.bbc.co.uk/news',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 15),
    text: 'Wirecard’s share price is reported to have fallen by more than 95 per cent in the week following the auditors’ refusal.',
    sourceUrl: 'https://www.reuters.com/',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 16),
    text: 'Short sellers who published research questioning the accounts are reported to have faced regulatory scrutiny rather than the company.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 17),
    text: 'Wirecard Bank AG, the group’s licensed banking arm, is reported to have been ring-fenced separately from the insolvency.',
    sourceUrl: 'https://www.reuters.com/',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },
  {
    id: fixtureId('CLAIM', 18),
    text: 'Reporting suggests the third-party acquiring business was described internally as the group’s main source of profit.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'single_source',
  },

  /**
   * The single blocker. Unsourced and about a named individual, which is
   * exactly the combination the gate exists to stop reaching a script.
   */
  {
    id: fixtureId('CLAIM', 19),
    text: 'Jan Marsalek is alleged to have maintained contacts with foreign intelligence services.',
    sourceUrl: null,
    sourceType: 'other',
    confidence: 'unverified',
  },
]
