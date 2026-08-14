import type { PhonemeHint, StabilityTier, Settings } from '@boom-busters/schemas'

/**
 * The settings-owned half of a take's identity, in one place.
 *
 * Four callers compute take fingerprints — the runner, the retaker, the review
 * model and the retake action — and each used to assemble the settings fields
 * by hand. Four assemblies is four chances to disagree, and a disagreement here
 * is silent: the screen says "unchanged" while the runner buys, or vice versa.
 *
 * The rule for membership is unchanged from the multi-vendor era: everything
 * that changes how a paragraph is *spoken* without changing a character of it.
 * On ElevenLabs that is the voice, the applicable pronunciations, and the
 * stability tier.
 */
export function voiceKeyFacts(tts: Settings['tts']): {
  voiceId: string
  pronunciations: readonly PhonemeHint[]
  stability: StabilityTier
} {
  return {
    voiceId: tts.voiceId,
    pronunciations: tts.phonemeHints,
    stability: tts.stability,
  }
}
