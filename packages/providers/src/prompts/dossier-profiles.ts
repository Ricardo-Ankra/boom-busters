import type { ChannelBible, ResearchProfileKey } from '@boom-busters/schemas'
import { literalBibleText, noun } from './bible'

/**
 * The prompt text that differs by research profile: who the researcher is,
 * who the stakes fall on, and any rules added to the shared ones. The shared
 * rules (quote word for word, cite by number, court versus alleged) stay in
 * `dossier.ts`, because no profile may drop them.
 *
 * `opening` keeps its slot tokens unfilled: the system prompt is filled as a
 * whole after it is composed.
 */
export interface ProfilePrompt {
  opening: (bible: ChannelBible) => string
  stakes: (bible: ChannelBible) => string
  extraRules: readonly string[]
  /**
   * Rules for the evidence axis, appended to the generic one in the claim
   * rules. Empty for a profile with no axis.
   */
  evidenceRules: string
}

const investigation: ProfilePrompt = {
  opening: () =>
    `You research [[example:dossier-channel-subject]] for a documentary
channel with commentary. You work as the story researcher: you look for the
scenes, the people and what they wanted, the numbers that draw the arc, and
what earlier videos already told.`,
  stakes: (bible) =>
    `Real ${literalBibleText(noun(bible, 'plural'))} and living people are the
subject, so:`,
  extraRules: [],
  evidenceRules: '',
}

export const PROFILE_PROMPTS: Record<ResearchProfileKey, ProfilePrompt> = {
  investigation,
  // Task 7 writes science's own text; until then it reads as the investigation.
  science: investigation,
}
