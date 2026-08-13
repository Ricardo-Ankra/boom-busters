import { promptSteered } from '@boom-busters/providers'
import type { PhonemeHint, Settings } from '@boom-busters/schemas'

/**
 * The settings-owned half of a take's identity, in one place.
 *
 * Four callers compute take fingerprints — the runner, the retaker, the review
 * model and the retake action — and each used to assemble the settings fields
 * by hand. Four assemblies is four chances to disagree, and a disagreement here
 * is silent: the screen says "unchanged" while the runner buys, or vice versa.
 *
 * This is also where the provider gate lives: the narrator instructions join
 * the identity only where the vendor actually receives them (`promptSteered` —
 * Gemini). Folding them in for Cloud TTS or ElevenLabs would mark every row
 * stale over an edit that cannot change a byte of audio.
 */
export function voiceKeyFacts(
  tts: Settings['tts'],
  env: Record<string, string | undefined> = process.env,
): {
  voiceId: string
  pronunciations: readonly PhonemeHint[]
  pacing: number
  stylePrompt?: string
} {
  return {
    voiceId: tts.voiceId,
    pronunciations: tts.phonemeHints,
    pacing: tts.pacing,
    ...(promptSteered(tts.provider, env) && tts.stylePrompt.trim() !== ''
      ? { stylePrompt: tts.stylePrompt }
      : {}),
  }
}
