/** Primary-source host rules and the EDGAR form lists the dossier sources use. */

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
