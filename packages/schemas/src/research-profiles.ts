import { z } from 'zod'

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
