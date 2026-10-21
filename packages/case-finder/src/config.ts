/**
 * Every value here is pre-registered by the committed design (b5d5e4d).
 * They must not change after a live back-test run without invalidating that
 * run: the point of fixing them first is that they cannot be tuned to the
 * answer. Bump CONFIG_VERSION with any change so old results are never
 * compared against new rules.
 * Version 2 (2026-10-20, before any live run) added FOUNDER_MIN_MEDIAN_VIEWS and HITLIST_EXCLUDED_CLASSES from the final review; the weights, thresholds and pass rule are unchanged from b5d5e4d.
 * Version 3 (2026-10-21, before any live run) replaced ruling R2 with the owner's channel-median middle ground (decision 11); the weights, thresholds and pass rule are unchanged from b5d5e4d.
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

/**
 * The founder-link seed's popularity bar: an English median of this many
 * monthly views over some 24 consecutive months to enter the hitlist, and
 * over the 24 months before T for the tag to count at T.
 */
export const FOUNDER_MIN_MEDIAN_VIEWS = 1000

export const FORTUNE_CLIMB = { places: 200, years: 10, lateEntryAfter: 1970, topRank: 100 } as const

/**
 * Wikidata kinds (P31 values) that are never a company case, however their
 * articles reached a seed: the scandal categories and collapse lists also
 * hold the people, countries, films, books, laws and agencies around a case,
 * and their pageviews would take the top demand places. The hitlist drops any
 * entity that is an instance of one of these, and any entity that is itself a
 * class (has a P279 subclass-of claim), which is a concept such as "Ponzi
 * scheme" rather than a company. Keyed by QID; the label names the reason in
 * the build's summary.
 */
export const HITLIST_EXCLUDED_CLASSES = {
  Q5: 'human',
  Q6256: 'country',
  Q3624078: 'sovereign state',
  Q11424: 'film',
  Q5398426: 'television series',
  Q7725634: 'literary work',
  Q571: 'book',
  Q49371: 'legislation',
  Q327333: 'government agency',
} as const

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

/**
 * Channel medians within the quota (decision 11): a channel's uploads are paged
 * back at most this far (1,000 uploads, about 40 units) to reach a counted
 * video's six-month window; a channel cut short uses its latest 50 long-form
 * uploads instead.
 */
export const CHANNEL_HISTORY_MAX_PAGES = 20
export const CHANNEL_FALLBACK_UPLOADS = 50

export const CHANNEL_HANDLES = [
  '@BrightSunFilms',
  '@MagnatesMedia',
  '@Coffeezilla',
  '@HowMoneyWorks',
  '@ModernMBA',
] as const

export const CONFIG_VERSION = 3
