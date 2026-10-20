/**
 * Every value here is pre-registered by the committed design (b5d5e4d).
 * They must not change after a live back-test run without invalidating that
 * run: the point of fixing them first is that they cannot be tuned to the
 * answer. Bump CONFIG_VERSION with any change so old results are never
 * compared against new rules.
 */

/** Score weights for the four components D, G, S and W; they sum to 1. */
export const WEIGHTS = { D: 0.4, G: 0.3, S: 0.15, W: 0.15 } as const

export const RANKED_PER_LANE = 250
export const FLOOR_MEDIAN_MONTHLY = 300
export const DEMAND_WINDOW_MONTHS = 24
export const SPIKE_WINDOW_DAYS = 14
export const SPIKE_BASELINE_DAYS = 365
export const LONG_FORM_MIN_SEC = 480
export const SEARCH_RESULTS = 25
export const COVERAGE_WINDOW_MONTHS = 24
export const OUTLIER_CAP = 5

/** Primary-document counts that map to the thin, enough and strong levels. */
export const PAPER_TRAIL_LEVELS = { thin: 1, enough: 3, strong: 10 } as const

export const PRIMARY_DOMAIN_SUFFIXES = [
  '.gov',
  '.gov.uk',
  '.gov.za',
  '.gov.au',
  '.gc.ca',
  '.gov.in',
  '.go.jp',
  '.gouv.fr',
  '.bund.de',
  '.europa.eu',
] as const

export const PRIMARY_HOSTS = [
  'sec.gov',
  'justice.gov',
  'courtlistener.com',
  'supremecourt.gov',
  'judiciary.uk',
  'bailii.org',
  'saflii.org',
  'austlii.edu.au',
  'canlii.org',
  'parliament.uk',
  'aph.gov.au',
  'parliament.gov.za',
  'fca.org.uk',
  'bafin.de',
  'finra.org',
  'jse.co.za',
  'asic.gov.au',
  'sfc.hk',
  'mas.gov.sg',
  'sebi.gov.in',
  'cvm.gov.br',
  'amf-france.org',
  'consob.it',
  'fsca.co.za',
  'cftc.gov',
  'ftc.gov',
  'fdic.gov',
  'federalreserve.gov',
] as const

/** Any host whose first label is one of these (inspectors general) counts as primary. */
export const PRIMARY_HOST_FIRST_LABELS = ['oig'] as const

export const EDGAR_FORMS = {
  success: ['10-K', '20-F', '40-F', 'S-1', 'F-1', '424B4'],
  downfall: ['NT 10-K', 'NT 20-F', '10-K/A', '8-K'],
} as const

/** An 8-K counts for the downfall lane only when its items include this one (non-reliance on financials). */
export const EDGAR_8K_DOWNFALL_ITEM = '4.02'

export const FORTUNE_CLIMB = { places: 200, years: 10, lateEntryAfter: 1970, topRank: 100 } as const

export const BACKTEST = {
  from: '2018-01-01',
  to: '2026-06-30',
  size: 40,
  maxPerChannel: 12,
  minSuccess: 12,
  outcomeWindowMonths: 6,
  settledDays: 90,
  bootstrap: 2000,
  seed: 20261020,
  passRho: 0.3,
  intervalLevel: 0.9,
} as const

export const CHANNEL_HANDLES = [
  '@BrightSunFilms',
  '@MagnatesMedia',
  '@Coffeezilla',
  '@HowMoneyWorks',
  '@ModernMBA',
] as const

export const CONFIG_VERSION = 1
