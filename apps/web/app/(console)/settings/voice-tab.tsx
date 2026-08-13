'use client'

import type { KnownVoice } from '@boom-busters/providers'
import type { PhonemeHint, Settings, SettingsPatch, TtsProvider } from '@boom-busters/schemas'
import { AlertTriangle, Check, Loader2, Lock, LockOpen, Play, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { MAX_SAMPLE_CHARS } from '@/lib/audition'
import {
  cachedAuditions,
  checkPronunciation,
  chooseVoice,
  generateAuditions,
  listAuditionVoices,
  lockVoice,
  unlockVoice,
} from './voice-actions'

/**
 * Settings → Voice (build spec section 11.3).
 *
 * Two things live here, and they belong together: the audition panel that picks
 * the narrator, and the pronunciation list that narrator reads from. Both are
 * properties of the voice rather than of any one video, which is why neither is
 * a per-project setting.
 *
 * The lock is the spec's (§10): the narration voice is a brand asset, and
 * swapping it halfway through a channel makes every earlier video sound like a
 * different show. Unlocking takes a typed confirmation, and the server action
 * re-checks it rather than trusting the button.
 */

const DEFAULT_SAMPLE =
  'In June 2020, Wirecard admitted that roughly two billion euros of cash on its balance sheet ' +
  'probably did not exist. The auditors had signed the accounts for years.'

interface TabProps {
  settings: Settings
  saving: boolean
  commit: (patch: SettingsPatch, optimistic: Settings) => Promise<void>
}

// ---------------------------------------------------------------------------
// Auditions
// ---------------------------------------------------------------------------

/**
 * The audition panel: press a voice, hear it, keep the one you leave selected.
 *
 * It used to be a four-press affair — tick up to six voices, press "Generate N
 * auditions", press Play on each result, then press "Choose this voice". Four
 * presses to answer one question, and the question is *what does this sound
 * like*, which only listening answers. A press now synthesises, plays and
 * selects in one go, and **the selected voice is the narrator**: there is
 * nothing else to confirm.
 *
 * Two things follow from a press spending money:
 *
 *  - **Each voice is bought once.** The audio is cached against the voice and
 *    the sample, so going back and forth between two candidates is free after
 *    the first pass of each. Editing the sample clears the cache, because it is
 *    then a different question.
 *  - **The price is on the button before you press it.** A voice you have not
 *    heard says what it will cost; one you have says "play again".
 */

/** Chirp 3 HD's per-character rate — shown where the spending happens (§11.1). */
function estimateAuditionUsd(sample: string): number {
  return (sample.trim().length / 1000) * 0.03
}

const PROVIDER_LABELS: Record<TtsProvider, string> = {
  'google-cloud-tts': 'Google Cloud TTS — Chirp 3 HD',
  gemini: 'Gemini TTS',
  elevenlabs: 'ElevenLabs',
}

type VoiceState = 'idle' | 'loading' | 'ready' | 'failed'

function VoiceButton({
  voice,
  provider,
  state,
  selected,
  costUsd,
  onPress,
}: {
  voice: KnownVoice
  provider: TtsProvider
  state: VoiceState
  selected: boolean
  costUsd: number
  onPress: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPress}
        aria-pressed={selected}
        disabled={state === 'loading'}
        className={cn(
          'flex min-h-[72px] w-full flex-col items-start gap-0.5 rounded-[8px] border px-3 py-2 text-left',
          'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-[var(--color-accent)]',
          selected
            ? 'border-[var(--color-accent)] bg-[var(--color-surface-raised)]'
            : 'border-[var(--color-border)] hover:bg-[var(--color-surface-raised)]',
        )}
      >
        <span className="flex w-full items-center gap-2">
          {state === 'loading' ? (
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          ) : state === 'failed' ? (
            <AlertTriangle className="size-4 shrink-0 text-[var(--color-danger)]" aria-hidden />
          ) : (
            <Play className="size-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{voice.label}</span>
          {selected ? (
            <Check className="size-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
          ) : null}
        </span>

        <span className="w-full truncate text-[11px] text-[var(--color-text-muted)]">
          {voice.description ?? provider}
        </span>

        {/* Never colour or icon alone: what a press will do, in words. */}
        <span className="text-[11px] text-[var(--color-text-secondary)]">
          {state === 'loading'
            ? 'Synthesising…'
            : state === 'failed'
              ? 'Failed — press to try again'
              : state === 'ready'
                ? selected
                  ? 'The narrator · play again'
                  : 'Heard · play again'
                : `Hear it · $${costUsd.toFixed(4)}`}
        </span>
      </button>
    </li>
  )
}

interface Heard {
  audio?: string
  error?: string
}

function AuditionPanel({ settings }: { settings: Settings }) {
  const [sample, setSample] = React.useState(DEFAULT_SAMPLE)
  const [catalogue, setCatalogue] = React.useState<
    { provider: TtsProvider; voices: KnownVoice[]; error?: string }[] | null
  >(null)
  /** Keyed `provider:voiceId`, cleared whenever the sample changes. */
  const [heard, setHeard] = React.useState<Record<string, Heard>>({})
  const [loading, setLoading] = React.useState<string | null>(null)
  const audio = React.useRef<HTMLAudioElement>(null)
  const { toast } = useToast()
  const router = useRouter()

  React.useEffect(() => {
    void listAuditionVoices().then(setCatalogue)
  }, [])

  /**
   * Everything already paid for at this sample, so a voice you have heard says
   * "play again" rather than offering to charge you for it a second time.
   */
  React.useEffect(() => {
    let current = true
    void cachedAuditions(sample).then((bought) => {
      if (!current) return
      setHeard(
        Object.fromEntries(
          Object.entries(bought).map(([id, audition]) => [id, { audio: audition.audio }]),
        ),
      )
    })
    return () => {
      current = false
    }
  }, [sample])

  const keyOf = (provider: string, voiceId: string): string => `${provider}:${voiceId}`
  const selectedKey = keyOf(settings.tts.provider, settings.tts.voiceId)
  const cost = estimateAuditionUsd(sample)

  function play(base64: string): void {
    const element = audio.current
    if (!element) return
    element.src = `data:audio/wav;base64,${base64}`
    void element.play().catch(() => undefined)
  }

  /** Selection *is* the choice — there is no separate confirm step. */
  async function select(provider: TtsProvider, voice: KnownVoice): Promise<void> {
    const result = await chooseVoice(provider, voice.id)
    if (!result.ok) {
      toast({ title: 'Could not choose that voice', description: result.error, variant: 'error' })
      return
    }
    router.refresh()
  }

  async function press(provider: TtsProvider, voice: KnownVoice): Promise<void> {
    const id = keyOf(provider, voice.id)

    // Already bought at this sample: replay it for nothing.
    const already = heard[id]
    if (already?.audio) {
      play(already.audio)
      if (id !== selectedKey && !settings.tts.locked) await select(provider, voice)
      return
    }

    setLoading(id)
    const result = await generateAuditions(sample, [{ provider, voiceId: voice.id }])
    setLoading(null)

    if (!result.ok) {
      toast({ title: 'Nothing was generated', description: result.error, variant: 'error' })
      return
    }

    const audition = result.auditions?.[0]
    if (!audition?.audio) {
      setHeard((current) => ({ ...current, [id]: { error: audition?.error ?? 'No audio' } }))
      toast({
        title: `${voice.label} could not be synthesised`,
        description: audition?.error,
        variant: 'error',
      })
      return
    }

    const bought = audition.audio
    setHeard((current) => ({ ...current, [id]: { audio: bought } }))
    play(bought)

    // Listening while locked is fine; changing the narrator is not.
    if (!settings.tts.locked) await select(provider, voice)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice audition</CardTitle>
        <CardDescription>
          Press a voice to hear it read the sample. Whichever stays selected is the narrator — there
          is nothing else to confirm. Each voice is synthesised once per sample, and charged against
          the same monthly cap as the pipeline.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="audition-sample">Sample paragraph</Label>
          <textarea
            id="audition-sample"
            value={sample}
            onChange={(event) => {
              // A different sample is a different question, so nothing bought
              // against the old one may be replayed as though it answered this.
              // The effect above reloads whatever *has* been bought for the new
              // one, which is usually nothing.
              setSample(event.target.value)
              setHeard({})
            }}
            rows={3}
            maxLength={MAX_SAMPLE_CHARS}
            className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          />
          <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
            {sample.length}/{MAX_SAMPLE_CHARS} · ${cost.toFixed(4)} per voice
          </p>
        </div>

        {settings.tts.locked ? (
          <p className="text-[13px] text-[var(--color-warning)]">
            The narrator is locked, so pressing a voice will play it but not adopt it. Unlock it
            above to change which voice reads the scripts.
          </p>
        ) : null}

        {catalogue === null ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">Loading voices…</p>
        ) : (
          catalogue.map((group) => (
            <div key={group.provider} className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold">{PROVIDER_LABELS[group.provider]}</h3>
              {group.error ? (
                <p className="text-[12px] text-[var(--color-warning)]">{group.error}</p>
              ) : group.voices.length === 0 ? (
                <p className="text-[12px] text-[var(--color-text-muted)]">No voices on offer.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {group.voices.map((voice) => {
                    const id = keyOf(group.provider, voice.id)
                    const entry = heard[id]
                    const state: VoiceState =
                      loading === id
                        ? 'loading'
                        : entry?.error
                          ? 'failed'
                          : entry?.audio
                            ? 'ready'
                            : 'idle'

                    return (
                      <VoiceButton
                        key={voice.id}
                        voice={voice}
                        provider={group.provider}
                        selected={id === selectedKey}
                        costUsd={cost}
                        state={state}
                        onPress={() => void press(group.provider, voice)}
                      />
                    )
                  })}
                </ul>
              )}
            </div>
          ))
        )}

        {/* One player for the whole panel: thirty-three <audio> elements would
            each hold a data URL of their own. */}
        <audio ref={audio} className="sr-only">
          <track kind="captions" />
        </audio>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The chosen voice, and its lock
// ---------------------------------------------------------------------------

/** Providers that take a written style direction. Cloud TTS does not. */
const STEERABLE_PROVIDERS: TtsProvider[] = ['gemini']

function ChosenVoice({ settings, saving, commit }: TabProps) {
  const [confirmation, setConfirmation] = React.useState('')
  const [unlocking, setUnlocking] = React.useState(false)
  const [locking, setLocking] = React.useState(false)
  const { toast } = useToast()
  const router = useRouter()

  async function lock(): Promise<void> {
    setLocking(true)
    const result = await lockVoice()
    setLocking(false)

    if (!result.ok) {
      toast({ title: 'Could not lock it', description: result.error, variant: 'error' })
      return
    }
    toast({ title: 'Voice locked', description: 'Changing it now needs a typed confirmation.' })
    router.refresh()
  }

  async function unlock(): Promise<void> {
    setUnlocking(true)
    const result = await unlockVoice(confirmation)
    setUnlocking(false)

    if (!result.ok) {
      toast({ title: 'Still locked', description: result.error, variant: 'error' })
      return
    }
    setConfirmation('')
    toast({ title: 'Voice unlocked', description: 'Choose a different one below.' })
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>The narrator</CardTitle>
        <CardDescription>
          Stored once, at <code>settings.tts</code>, and projected into the Brand Kit — the two can
          never drift.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <p className="text-[14px]">
          {settings.tts.voiceId === '' ? (
            <span className="text-[var(--color-warning)]">
              No voice chosen yet. The pipeline cannot narrate until one is.
            </span>
          ) : (
            <>
              <span className="font-mono">{settings.tts.voiceId}</span> on{' '}
              <span className="font-mono">{settings.tts.provider}</span>
              {settings.tts.locked ? (
                <span className="ml-2 inline-flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)]">
                  <Lock className="size-3.5" aria-hidden /> locked
                </span>
              ) : (
                <span className="ml-2 inline-flex items-center gap-1 text-[12px] text-[var(--color-warning)]">
                  <LockOpen className="size-3.5" aria-hidden /> unlocked
                </span>
              )}
            </>
          )}
        </p>

        {/* Only where it does something. Cloud Text-to-Speech has no prompt
            steering at all — it is a speech service, not a language model — so
            on Chirp this field was a control that looked live and changed
            nothing, which is worse than not offering it. */}
        {STEERABLE_PROVIDERS.includes(settings.tts.provider) ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="style-prompt">Delivery direction</Label>
            <Input
              id="style-prompt"
              defaultValue={settings.tts.stylePrompt}
              placeholder="Measured, documentary, no theatrics."
              disabled={saving}
              onBlur={(event) => {
                if (event.target.value === settings.tts.stylePrompt) return
                const next = structuredClone(settings)
                next.tts.stylePrompt = event.target.value
                void commit({ tts: { stylePrompt: event.target.value } }, next)
              }}
            />
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Sent with every paragraph, as an instruction the model follows.
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            This narrator takes no written direction — Cloud Text-to-Speech is a speech service
            rather than a language model. What shapes the delivery is the voice you picked, the
            pacing below, and the punctuation in the script itself.
          </p>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor="pacing">Pacing ({settings.tts.pacing.toFixed(2)}×)</Label>
          <input
            id="pacing"
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            defaultValue={settings.tts.pacing}
            disabled={saving}
            onMouseUp={(event) => {
              const pacing = Number(event.currentTarget.value)
              if (pacing === settings.tts.pacing) return
              const next = structuredClone(settings)
              next.tts.pacing = pacing
              void commit({ tts: { pacing } }, next)
            }}
            className="w-full"
          />
        </div>

        {!settings.tts.locked && settings.tts.voiceId !== '' ? (
          <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Locking stops the narrator being changed by accident once the channel is producing.
              Auditioning stays possible either way — a locked voice can still be listened to.
            </p>
            <div>
              <Button variant="outline" onClick={() => void lock()} disabled={locking}>
                {locking ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Lock className="size-4" aria-hidden />
                )}
                Lock this voice in
              </Button>
            </div>
          </div>
        ) : null}

        {settings.tts.locked ? (
          <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
            <Label htmlFor="unlock-voice">
              Type <span className="font-mono">CHANGE VOICE</span> to unlock
            </Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="unlock-voice"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="max-w-[220px]"
              />
              <Button
                variant="outline"
                onClick={unlock}
                disabled={unlocking || confirmation.trim() === ''}
              >
                <LockOpen className="size-4" aria-hidden />
                Unlock the voice
              </Button>
            </div>
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Changing the narrator makes every video made so far sound like a different channel.
              Existing narration is not re-read.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Pronunciation
// ---------------------------------------------------------------------------

function PhonemeHints({ settings, saving, commit }: TabProps) {
  const [term, setTerm] = React.useState('')
  const [hint, setHint] = React.useState('')
  const [checking, setChecking] = React.useState(false)
  const [check, setCheck] = React.useState<{ ok: boolean; error?: string } | null>(null)

  function save(hints: PhonemeHint[]): void {
    const next = structuredClone(settings)
    next.tts.phonemeHints = hints
    void commit({ tts: { phonemeHints: hints } }, next)
  }

  /**
   * Checked with the vendor before it is kept.
   *
   * Google validates a pronunciation against the voice's own phoneme
   * inventory, not merely against the notation being well-formed, so a correct
   * IPA transcription can still be refused — and there is no way to know but to
   * ask. Asking here means finding out with the cursor still in the box, rather
   * than three chapters into a run where the adapter quietly drops the hint and
   * narrates the word its own way.
   *
   * The hint is stored either way: a refusal is worth keeping so it can be
   * edited, and the run degrades safely if it never is.
   */
  async function add(): Promise<void> {
    if (term.trim() === '' || hint.trim() === '') return

    setChecking(true)
    const result = await checkPronunciation(term, hint)
    setChecking(false)
    setCheck(result)

    save([
      ...settings.tts.phonemeHints.filter(
        (existing) => existing.term.toLowerCase() !== term.trim().toLowerCase(),
      ),
      { term: term.trim(), hint: hint.trim() },
    ])

    if (result.ok) {
      setTerm('')
      setHint('')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pronunciation</CardTitle>
        <CardDescription>
          Terms the narrator cannot be trusted to say. Only the ones that appear in a paragraph are
          sent with it, so a long list costs nothing per call.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {settings.tts.phonemeHints.length === 0 ? (
            <li className="text-[13px] text-[var(--color-text-muted)]">
              Nothing listed. Add a term the first time you hear it read wrong.
            </li>
          ) : (
            settings.tts.phonemeHints.map((existing) => (
              <li
                key={existing.term}
                className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-border)] p-2"
              >
                <span className="min-w-[140px] font-mono text-[13px]">{existing.term}</span>
                <span className="min-w-0 flex-1 text-[13px] text-[var(--color-text-secondary)]">
                  {existing.hint}
                </span>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() =>
                    save(settings.tts.phonemeHints.filter((h) => h.term !== existing.term))
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </Button>
              </li>
            ))
          )}
        </ul>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="hint-term">Term</Label>
            <Input
              id="hint-term"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Wirecard"
              className="max-w-[200px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="hint-value">How to say it</Label>
            <Input
              id="hint-value"
              value={hint}
              onChange={(event) => setHint(event.target.value)}
              placeholder="/ˈvaɪɐkart/ or VEER-card"
              className="max-w-[260px]"
            />
          </div>
          <Button
            onClick={() => void add()}
            disabled={saving || checking || term.trim() === '' || hint.trim() === ''}
          >
            {checking ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {checking ? 'Checking with the voice…' : 'Add'}
          </Button>
        </div>

        {check ? (
          <p
            className={cn(
              'text-[12px]',
              check.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]',
            )}
            role="status"
          >
            {check.ok
              ? 'The narrator accepted that pronunciation and will use it.'
              : `Saved, but not applied. ${check.error ?? ''}`}
          </p>
        ) : null}

        <p className="text-[12px] text-[var(--color-text-muted)]">
          IPA between slashes is converted to the notation the narrator takes; anything else is
          treated as a respelling and read in place of the word. A pronunciation is checked with the
          voice when you add it, because each voice validates against its own phoneme set — a
          transcription can be correct IPA and still be refused, and a respelling always works.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Audition, then narrator, then pronunciation — the order you do them in.
 *
 * It used to read narrator → pronunciation → audition, which put the panel that
 * *chooses* a voice below two panels describing one you had not chosen yet, and
 * asked you to write pronunciation hints for a narrator that did not exist.
 */
export function VoiceTab({ settings, saving, commit }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      <AuditionPanel settings={settings} />
      <ChosenVoice settings={settings} saving={saving} commit={commit} />
      <PhonemeHints settings={settings} saving={saving} commit={commit} />
    </div>
  )
}
