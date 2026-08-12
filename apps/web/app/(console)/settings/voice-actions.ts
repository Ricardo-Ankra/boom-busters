'use server'

import { createHash } from 'node:crypto'
import { getSettings, ttsCredential, updateSettings } from '@boom-busters/db'
import { STATIC_VOICES, ttsAdapter } from '@boom-busters/providers'
import type { KnownVoice } from '@boom-busters/providers'
import { TTS_PROVIDERS, TtsProviderSchema } from '@boom-busters/schemas'
import type { TtsProvider } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { MAX_AUDITIONS, MAX_SAMPLE_CHARS } from '@/lib/audition'
import type { AuditionResult } from '@/lib/audition'
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
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16)

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

        return {
          ...base,
          audio: narration.wav.toString('base64'),
          durationMs: narration.durationMs,
          costUsd: narration.costUsd,
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
 * Adopt a voice, and lock it.
 *
 * Locking is the spec's (§10): the narration voice is a brand asset, and
 * changing it halfway through a channel's life makes every earlier video sound
 * like a different show. Unlocking needs a typed confirmation, which the UI
 * enforces and this action re-checks.
 */
export async function chooseVoice(
  provider: string,
  voiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireOwner()

  const parsed = TtsProviderSchema.safeParse(provider)
  if (!parsed.success) return { ok: false, error: `Unknown TTS provider "${provider}"` }
  if (voiceId.trim() === '') return { ok: false, error: 'Pick a voice.' }

  const settings = await getSettings(db)
  if (settings.tts.locked) {
    return {
      ok: false,
      error: 'The narration voice is locked. Unlock it below before choosing a different one.',
    }
  }

  await updateSettings(db, {
    tts: { provider: parsed.data, voiceId: voiceId.trim(), locked: true },
  })

  revalidatePath('/settings')
  revalidatePath('/')
  return { ok: true }
}

/** Unlock the voice — the UI requires the words "CHANGE VOICE" typed out (§10). */
export async function unlockVoice(confirmation: string): Promise<{ ok: boolean; error?: string }> {
  await requireOwner()

  if (confirmation.trim().toUpperCase() !== 'CHANGE VOICE') {
    return { ok: false, error: 'Type CHANGE VOICE exactly to unlock it.' }
  }

  await updateSettings(db, { tts: { locked: false } })
  revalidatePath('/settings')
  return { ok: true }
}
