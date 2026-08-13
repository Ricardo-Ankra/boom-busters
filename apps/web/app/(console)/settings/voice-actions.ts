'use server'

import {
  findAudition,
  getSettings,
  listAuditions,
  saveAudition,
  ttsCredential,
  updateSettings,
} from '@boom-busters/db'
import { STATIC_VOICES, ttsAdapter } from '@boom-busters/providers'
import type { KnownVoice } from '@boom-busters/providers'
import { TTS_PROVIDERS, TtsProviderSchema, ttsProviderFromCredential } from '@boom-busters/schemas'
import type { Provider, TtsProvider } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { MAX_AUDITIONS, MAX_SAMPLE_CHARS, sampleHash } from '@/lib/audition'
import type { Audition, AuditionResult } from '@/lib/audition'
import { auditionKey, putObject, storageConfigured } from '@/lib/storage'
import { synthesise } from '@/lib/tts'

/**
 * The voice audition panel (build spec section 11.3, Settings).
 *
 * "Paste a sample paragraph → `Generate auditions` renders it in up to 6
 * candidate voices across providers side by side."
 *
 * Two things are worth stating because they cost money:
 *
 *  - **Auditions go through `withCost` like everything else** (spec §10.1), so
 *    six candidate voices is six ledger rows against the same monthly cap the
 *    pipeline spends from. That is the point — a voice you auditioned twenty
 *    times should show up on the Costs screen.
 *  - **Six is a hard ceiling**, and the sample paragraph is capped. The panel
 *    is the one screen in the app where a human can trigger arbitrary synthesis
 *    with no gate in front of it.
 *
 * The limits live in `lib/audition.ts` rather than here: a `'use server'` module
 * may only export async functions, so a constant exported from this file is a
 * build error rather than a lint warning.
 */

async function requireOwner(): Promise<string> {
  const session = await auth()
  const email = session?.user?.email
  if (!email) throw new Error('Not signed in')
  return email
}

/**
 * Which voices can be offered, by provider.
 *
 * Gemini's list ships with the adapter; ElevenLabs' is the account's, so it
 * needs the key. A provider with no key contributes nothing rather than
 * failing the whole panel — auditioning Gemini voices should not require an
 * ElevenLabs subscription.
 */
export async function listAuditionVoices(): Promise<
  { provider: TtsProvider; voices: KnownVoice[]; error?: string }[]
> {
  await requireOwner()

  return Promise.all(
    TTS_PROVIDERS.map(async (provider) => {
      const shipped = STATIC_VOICES[provider]
      if (shipped) return { provider, voices: [...shipped] }

      const apiKey = await ttsCredential(db, provider, env.SECRETS_ENCRYPTION_KEY)
      if (!apiKey) {
        return {
          provider,
          voices: [],
          error: `No ${provider} key. Add one in Settings → Connections to hear its voices.`,
        }
      }

      try {
        return { provider, voices: await ttsAdapter(provider).voices({ apiKey }) }
      } catch (error) {
        return {
          provider,
          voices: [],
          error: error instanceof Error ? error.message : 'Could not list voices',
        }
      }
    }),
  )
}

/**
 * Synthesise the sample in each chosen voice.
 *
 * The audio comes back **inline as base64**, rather than through the take
 * route: an audition has no `voice_takes` row to address it by, and inventing
 * one would put throwaway rows in the table the pipeline reads. These are a few
 * seconds each and they are compared side by side, so they live as long as the
 * panel does.
 *
 * A copy is also written to R2 when storage is configured, because §10.1 asks
 * for the samples to be kept "for later comparison" — deciding between two
 * voices a week apart is otherwise two more sets of auditions.
 */
export async function generateAuditions(
  sample: string,
  choices: { provider: string; voiceId: string }[],
): Promise<AuditionResult> {
  await requireOwner()

  const text = sample.trim()
  if (text === '') return { ok: false, error: 'Paste a paragraph for the voices to read.' }
  if (text.length > MAX_SAMPLE_CHARS) {
    return {
      ok: false,
      error: `Keep the sample under ${MAX_SAMPLE_CHARS} characters — it is synthesised once per voice.`,
    }
  }

  if (choices.length === 0) return { ok: false, error: 'Choose at least one voice to hear.' }
  if (choices.length > MAX_AUDITIONS) {
    return { ok: false, error: `Up to ${MAX_AUDITIONS} voices at a time.` }
  }

  const settings = await getSettings(db)
  const hash = sampleHash(text)

  const auditions = await Promise.all(
    choices.map(async (choice) => {
      const parsed = TtsProviderSchema.safeParse(choice.provider)
      if (!parsed.success) {
        return {
          provider: 'gemini' as TtsProvider,
          voiceId: choice.voiceId,
          label: choice.voiceId,
          error: 'Unknown provider',
        }
      }

      const provider = parsed.data
      const base = { provider, voiceId: choice.voiceId, label: choice.voiceId }

      /**
       * Bought once, then free forever.
       *
       * Without this, leaving the Settings screen and coming back meant paying
       * to hear the same voice read the same sentence again — the panel's
       * in-memory cache died with the page, which is exactly the moment you
       * want to come back and compare.
       */
      const cached = await findAudition(db, {
        provider,
        voiceId: choice.voiceId,
        sampleHash: hash,
      })
      if (cached) {
        return {
          ...base,
          audio: cached.audioBase64,
          durationMs: cached.durationMs,
          costUsd: 0,
          cached: true,
        }
      }

      try {
        const narration = await synthesise(
          {
            text,
            idempotencyKey: `audition:${provider}:${choice.voiceId}:${hash}`,
            voiceOverride: { provider, voiceId: choice.voiceId },
          },
          // The configured voice must not leak into an audition of a different
          // one, but the pronunciation list and pacing should — you are judging
          // how this voice will read *your* scripts.
          settings,
        )

        if (storageConfigured()) {
          await putObject(
            auditionKey({ provider, voiceId: choice.voiceId, hash }),
            narration.wav,
            'audio/wav',
          )
        }

        const audio = narration.wav.toString('base64')
        await saveAudition(db, {
          provider,
          voiceId: choice.voiceId,
          sampleHash: hash,
          audioBase64: audio,
          durationMs: narration.durationMs,
          costUsd: narration.costUsd,
        })

        return {
          ...base,
          audio,
          durationMs: narration.durationMs,
          costUsd: narration.costUsd,
          ...(narration.droppedPronunciations && narration.droppedPronunciations.length > 0
            ? { droppedPronunciations: narration.droppedPronunciations }
            : {}),
        }
      } catch (error) {
        // One voice failing must not lose the five that worked and were paid
        // for.
        return { ...base, error: error instanceof Error ? error.message : 'Synthesis failed' }
      }
    }),
  )

  return { ok: true, auditions }
}

/**
 * Adopt a voice. One press, and the previously chosen one stops being chosen —
 * there is exactly one narrator, so choosing is the whole interaction.
 *
 * **No lock, in either direction.** Spec §11.3 has choosing write *and lock*
 * the Brand Kit voice, with a typed `CHANGE VOICE` to undo it. Both halves are
 * gone. The lock protected a single-user console from its single user, on the
 * one screen built for comparing voices against each other, and every time it
 * fired it fired on the person it belonged to. What it was guarding — swapping
 * a brand asset by accident — is already guarded by the change being a
 * deliberate press on a settings screen.
 */
export async function chooseVoice(
  provider: string,
  voiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireOwner()

  const parsed = TtsProviderSchema.safeParse(provider)
  if (!parsed.success) return { ok: false, error: `Unknown TTS provider "${provider}"` }
  if (voiceId.trim() === '') return { ok: false, error: 'Pick a voice.' }

  await updateSettings(db, { tts: { provider: parsed.data, voiceId: voiceId.trim() } })

  revalidatePath('/settings')
  revalidatePath('/')
  return { ok: true }
}

/**
 * Ask the vendor whether it will actually accept a pronunciation hint.
 *
 * Google validates a custom pronunciation against a **per-language phoneme
 * inventory**, not merely against X-SAMPA being well-formed — verified against
 * a live key: `aI` is accepted for en-GB and a bare `a` is refused, so a
 * perfectly good IPA transcription of a German name is rejected wholesale. That
 * cannot be predicted from the notation, and encoding Google's inventory here
 * would be guesswork of exactly the kind that has cost this project two days.
 *
 * So the hint is checked with the vendor at the moment it is typed, where a
 * human is present to fix it — rather than in a run, where the adapter drops it
 * and narrates the word its own way. A refusal is a 400 and costs nothing; an
 * acceptance synthesises the term alone, which is a small fraction of a cent.
 */
export async function checkPronunciation(
  term: string,
  hint: string,
): Promise<{ ok: boolean; error?: string; applied?: boolean }> {
  await requireOwner()

  if (term.trim() === '' || hint.trim() === '') {
    return { ok: false, error: 'Both a term and a pronunciation are needed.' }
  }

  const settings = await getSettings(db)
  const provider = settings.tts.provider
  const voiceId = settings.tts.voiceId

  if (voiceId.trim() === '') {
    return { ok: false, error: 'Choose a narrator first — a hint is checked against its voice.' }
  }

  try {
    const narration = await synthesise(
      {
        // The term on its own: enough to exercise the pronunciation, and the
        // shortest thing that can be charged for.
        text: term.trim(),
        idempotencyKey: `hint-check:${provider}:${voiceId}`,
        voiceOverride: { provider, voiceId },
      },
      // Only this hint, so the answer is about this hint.
      { ...settings, tts: { ...settings.tts, phonemeHints: [{ term, hint }] } },
    )

    return narration.droppedPronunciations && narration.droppedPronunciations.length > 0
      ? {
          ok: false,
          applied: false,
          error:
            `${provider} refused this pronunciation. It validates against the voice's own phoneme ` +
            'set, so a transcription can be correct IPA and still be outside it — try the ' +
            'nearest English sounds, or write it as a respelling instead.',
        }
      : { ok: true, applied: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not check it' }
  }
}

/**
 * Everything already bought for this sample, so the panel opens with it.
 *
 * Without this the cache would only help within a page load: you would come
 * back, see every voice offering to charge you again, and have no way of
 * knowing which ones were already paid for.
 */
export async function cachedAuditions(sample: string): Promise<Record<string, Audition>> {
  await requireOwner()

  const rows = await listAuditions(db, sampleHash(sample))
  const byKey: Record<string, Audition> = {}

  for (const row of rows) {
    const tts = ttsProviderFromCredential(row.provider as Provider)
    if (!tts) continue
    byKey[`${tts}:${row.voiceId}`] = {
      provider: tts,
      voiceId: row.voiceId,
      label: row.voiceId,
      audio: row.audioBase64,
      durationMs: row.durationMs,
      costUsd: 0,
      cached: true,
    }
  }

  return byKey
}
