import { z } from 'zod'
import type { DocumentKind } from './dossier'
import type { GutterWarning, WarningSeverity } from './script'

/** How the dossier researches a case. The channel bible picks one. */
export const RESEARCH_PROFILE_KEYS = ['investigation', 'science'] as const
export type ResearchProfileKey = (typeof RESEARCH_PROFILE_KEYS)[number]
export const ResearchProfileKeySchema = z.enum(RESEARCH_PROFILE_KEYS)

export const RESEARCH_PROFILE_LABELS: Record<
  ResearchProfileKey,
  { label: string; description: string }
> = {
  investigation: {
    label: 'Investigation',
    description: 'Real organisations and people, graded by what courts and regulators found.',
  },
  science: {
    label: 'Science',
    description:
      'Studies and findings, graded by whether they hold up, with scholarly sources first.',
  },
}

export type Tier = 1 | 2 | 3 | 4 | 5

export interface EvidenceStatus {
  key: string
  scriptLabel: string
  reviewLabel: string
}

export interface EvidenceAxis {
  statuses: readonly EvidenceStatus[]
  earned: { status: string; minScholarlyDocuments: number; reviewWords: readonly string[] }
  fallback: string
}

export interface ResearchProfile {
  key: ResearchProfileKey
  subject: { accept: 'business' | 'topic'; relatedWords: RegExp }
  sources: {
    edgar: boolean
    xbrl: boolean
    stooq: boolean
    wayback: boolean
    courtlistener: boolean
  }
  scholarlyHosts: readonly string[]
  tiers: Record<DocumentKind, Tier>
  tierShares: Record<Tier, number>
  evidence: EvidenceAxis | null
  /** What the script reviewer treats as blocking; null when the profile reviews nothing extra. Lists hold evidence status keys. */
  review: { standing: { blocking: readonly string[]; advisory: readonly string[] } } | null
}

const INVESTIGATION_TIERS: Record<DocumentKind, Tier> = {
  filing: 1,
  'web-archive': 1,
  'press-release': 1,
  reporting: 2,
  video: 3,
  figures: 4,
  regulator: 5,
  court: 5,
  scholarly: 2,
}

export const RESEARCH_PROFILES: Record<ResearchProfileKey, ResearchProfile> = {
  investigation: {
    key: 'investigation',
    subject: {
      accept: 'business',
      relatedWords: /\b(scandal|collapse|bankruptcy|fraud|affair)\b/i,
    },
    sources: { edgar: true, xbrl: true, stooq: true, wayback: true, courtlistener: true },
    scholarlyHosts: [],
    tiers: INVESTIGATION_TIERS,
    tierShares: { 1: 0.25, 2: 0.3, 3: 0.15, 4: 0.1, 5: 0.2 },
    evidence: null,
    review: null,
  },
  science: {
    key: 'science',
    subject: {
      accept: 'topic',
      relatedWords: /\b(experiment|effect|replication|controversy|criticism|study)\b/i,
    },
    sources: { edgar: false, xbrl: false, stooq: false, wayback: false, courtlistener: false },
    scholarlyHosts: [
      'doi.org',
      'pubmed.ncbi.nlm.nih.gov',
      'ncbi.nlm.nih.gov',
      'europepmc.org',
      'psycnet.apa.org',
      'apa.org',
      'sciencedirect.com',
      'springer.com',
      'wiley.com',
      'tandfonline.com',
      'sagepub.com',
      'nature.com',
      'science.org',
      'pnas.org',
      'jstor.org',
      'frontiersin.org',
      'plos.org',
      'cambridge.org',
      'academic.oup.com',
      'annualreviews.org',
      'osf.io',
      'psyarxiv.com',
      'arxiv.org',
      'ssrn.com',
    ],
    tiers: { ...INVESTIGATION_TIERS, scholarly: 1 },
    tierShares: { 1: 0.4, 2: 0.3, 3: 0.1, 4: 0.05, 5: 0.15 },
    evidence: {
      statuses: [
        { key: 'established', scriptLabel: 'ESTABLISHED FINDING', reviewLabel: 'Established' },
        { key: 'single_study', scriptLabel: 'ONE STUDY', reviewLabel: 'One study' },
        { key: 'contested', scriptLabel: 'CONTESTED', reviewLabel: 'Contested' },
      ],
      earned: {
        status: 'established',
        minScholarlyDocuments: 2,
        reviewWords: ['meta-analysis', 'meta-analyses', 'meta-analytic', 'systematic review'],
      },
      fallback: 'single_study',
    },
    review: { standing: { blocking: ['contested'], advisory: ['single_study'] } },
  },
}

/** A bible stored before profiles existed has none, and reads as the investigation. */
export function researchProfileOf(bible: {
  researchProfile?: ResearchProfileKey
}): ResearchProfile {
  return RESEARCH_PROFILES[bible.researchProfile ?? 'investigation']
}

/** The label a status carries in the script or the review; null when the profile has no axis or the status is unknown. */
export function evidenceLabel(
  profile: ResearchProfile,
  status: string | null,
  where: 'script' | 'review',
): string | null {
  if (!profile.evidence || status === null) return null
  const found = profile.evidence.statuses.find((s) => s.key === status)
  if (!found) return null
  return where === 'script' ? found.scriptLabel : found.reviewLabel
}

/** The severity a standing warning carries, read from the status label its message names; null when it cannot be resolved. */
export function standingSeverity(
  profile: ResearchProfile,
  message: string,
): WarningSeverity | null {
  if (!profile.review || !profile.evidence) return null
  const found = profile.evidence.statuses.find((s) => message.includes(s.scriptLabel))
  if (!found) return null
  if (profile.review.standing.blocking.includes(found.key)) return 'blocking'
  if (profile.review.standing.advisory.includes(found.key)) return 'advisory'
  return null
}

/** Stamps the profile's severity on each overstated-standing warning it can resolve; everything else passes through untouched. */
export function withStandingSeverity(
  profile: ResearchProfile,
  warnings: readonly GutterWarning[],
): GutterWarning[] {
  return warnings.map((w) => {
    if (w.kind !== 'overstated-standing') return w
    const severity = standingSeverity(profile, w.message)
    return severity ? { ...w, severity } : w
  })
}
