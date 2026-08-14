'use client'

// `promptSteered` is safe in a client component: the mock mirrors the live
// answer, so the env-dependent adapter switch cannot change what it returns.
import { promptSteered } from '@boom-busters/providers'
import type { KnownVoice } from '@boom-busters/providers'
import type { PhonemeHint, Settings, SettingsPatch, TtsProvider } from '@boom-busters/schemas'
import { AlertTriangle, Check, Loader2, Play, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { MAX_SAMPLE_CHARS } from '@/lib/audition'
import {
  cachedAuditions,
  checkPronunciation,
  generateAuditions,
  listAuditionVoices,
} from './voice-actions'

/**
 * Settings → Voice (build spec section 11.3).
 *
 * Two things live here, and they belong together: the audition panel that picks
 * the narrator, and the pronunciation list that narrator reads from. Both are
 * properties of the voice rather than of any one video, which is why neither is
 * a per-project setting.
 *
 * There is no lock on the narrator any more — see `chooseVoice` for why the
 * spec's §11.3 lock was built and then taken back out.
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
 * The audition panel. Each voice is a card with exactly two buttons on it:
 * **Play**, which is the only thing that spends money, and **Add voice**, which
 * makes it the narrator.
 *
 * Splitting them is the whole design. Before, the card *was* the button, so
 * listening and choosing were the same press — you could not hear a voice
 * without adopting it, and adopting was tangled up with a lock that then
 * refused the next press. Two labelled buttons, one per intention, and there is
 * nothing to explain.
 *
 * Adding is a radio, not a checkbox: there is one narrator, so adding a voice
 * drops the previous one with no separate un-choosing to do.
 *
 * Two things follow from Play spending money:
 *
 *  - **Each voice is bought once.** The audio is cached against the voice and
 *    the sample, so going back and forth between two candidates is free after
 *    the first pass of each. Editing the sample clears the cache, because it is
 *    then a different question.
 *  - **The price is on the button before you press it.** A voice you have not
 *    heard says what it will cost; one you have says "Play again".
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

function VoiceCard({
  voice,
  provider,
  state,
  selected,
  costUsd,
  onPlay,
  onAdd,
}: {
  voice: KnownVoice
  provider: TtsProvider
  state: VoiceState
  selected: boolean
  costUsd: number
  onPlay: () => void
  onAdd: () => void
}) {
  return (
    <li
      className={cn(
        'flex flex-col gap-1.5 rounded-[8px] border p-2',
        selected
          ? 'border-[var(--color-accent)] bg-[var(--color-surface-raised)]'
          : 'border-[var(--color-border)]',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{voice.label}</p>
          <p className="truncate text-[11px] text-[var(--color-text-muted)]">
            {voice.description ?? provider}
          </p>
        </div>

        {/* Top-right, one per card: the only control that changes the narrator.
            Adding a second voice drops the first — there is nothing to untick,
            so the chosen one carries a state chip rather than a dead button. */}
        {selected ? (
          <span className="inline-flex h-10 shrink-0 items-center gap-2 px-2 text-[13px] font-medium text-[var(--color-accent)]">
            <Check className="size-4" aria-hidden />
            Narrator
          </span>
        ) : (
          <Button variant="outline" size="icon" onClick={onAdd}>
            <Plus aria-hidden />
            Add voice
          </Button>
        )}
      </div>

      {/* The only button that spends. Its label says what it costs, before the
          press, per §11.1. */}
      <Button
        variant="ghost"
        size="icon"
        className="w-full justify-start"
        busy={state === 'loading'}
        onClick={onPlay}
      >
        {state === 'failed' ? (
          <AlertTriangle className="text-[var(--color-danger)]" aria-hidden />
        ) : (
          <Play aria-hidden />
        )}
        <span className="truncate">
          {state === 'failed'
            ? 'Failed — try again'
            : state === 'ready'
              ? 'Play again'
              : `Hear it · $${costUsd.toFixed(4)}`}
        </span>
      </Button>
    </li>
  )
}

interface Heard {
  audio?: string
  error?: string
}

function AuditionPanel({ settings, commit }: TabProps) {
  const [sample, setSample] = React.useState(DEFAULT_SAMPLE)
  const [catalogue, setCatalogue] = React.useState<
    { provider: TtsProvider; voices: KnownVoice[]; error?: string }[] | null
  >(null)
  /** Keyed `provider:voiceId`, cleared whenever the sample changes. */
  const [heard, setHeard] = React.useState<Record<string, Heard>>({})
  const [loading, setLoading] = React.useState<string | null>(null)
  const audio = React.useRef<HTMLAudioElement>(null)
  const { toast } = useToast()

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

  function sound(base64: string): void {
    const element = audio.current
    if (!element) return
    element.src = `data:audio/wav;base64,${base64}`
    void element.play().catch(() => undefined)
  }

  /**
   * Adding *is* the choice — one narrator, so the previous one simply stops.
   *
   * Through the same optimistic `commit` every other control on this screen
   * uses, and for a reason worth writing down: this was briefly its own server
   * action that called `router.refresh()`, and the card did not change until the
   * page was reloaded. `SettingsForm` holds the settings in `useState`, so a
   * refreshed server component hands down a new prop that the already-mounted
   * state ignores. `commit` updates that state, which is what the cards are
   * actually rendered from — and it rolls back with a toast if the write fails.
   */
  async function add(provider: TtsProvider, voice: KnownVoice): Promise<void> {
    const next = structuredClone(settings)
    next.tts.provider = provider
    next.tts.voiceId = voice.id
    await commit({ tts: { provider, voiceId: voice.id } }, next)
  }

  /** Listening never changes the narrator, and never charges twice. */
  async function play(provider: TtsProvider, voice: KnownVoice): Promise<void> {
    const id = keyOf(provider, voice.id)

    const already = heard[id]
    if (already?.audio) {
      sound(already.audio)
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
    sound(bought)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice audition</CardTitle>
        <CardDescription>
          <strong>Play</strong> hears a voice read the sample; <strong>Add voice</strong> makes it
          the narrator. Only Play spends anything — each voice is synthesised once per sample and
          then replays for free, charged against the same monthly cap as the pipeline.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
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
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                      <VoiceCard
                        key={voice.id}
                        voice={voice}
                        provider={group.provider}
                        selected={id === selectedKey}
                        costUsd={cost}
                        state={state}
                        onPlay={() => void play(group.provider, voice)}
                        onAdd={() => void add(group.provider, voice)}
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
// The chosen voice
// ---------------------------------------------------------------------------

// Which providers take written direction is the adapters' fact
// (`promptSteered`), not a list to maintain here — a second copy of it is how
// the field shows for a narrator that ignores it.

function ChosenVoice({ settings, saving, commit }: TabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>The narrator</CardTitle>
        <CardDescription>
          Stored once, at <code>settings.tts</code>, and projected into the Brand Kit — the two can
          never drift.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <p className="text-[14px]">
          {settings.tts.voiceId === '' ? (
            <span className="text-[var(--color-warning)]">
              No voice chosen yet. The pipeline cannot narrate until one is.
            </span>
          ) : (
            <>
              <span className="font-mono">{settings.tts.voiceId}</span> on{' '}
              <span className="font-mono">{settings.tts.provider}</span>
            </>
          )}
        </p>

        {/* Only where it does something. Cloud Text-to-Speech has no prompt
            steering at all — it is a speech service, not a language model — so
            on Chirp this field was a control that looked live and changed
            nothing, which is worse than not offering it. */}
        {promptSteered(settings.tts.provider) ? (
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
              Sent with every paragraph, as an instruction the model follows. Describe a
              performance, not a genre — pitch, tempo, register — and it holds the narrator steady
              across paragraphs. Editing it changes how everything is read, so existing narration is
              marked “Changed since read” and the next voice run re-reads it.
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            This narrator takes no written direction — Cloud Text-to-Speech is a speech service
            rather than a language model, so there is no prose to steer it with. Delivery is shaped
            by the voice, the pacing below, the punctuation in the script, and{' '}
            <span className="font-mono">[pause]</span> markup written into a paragraph — which is
            what the Voice review screen inserts when you fix the words of a take.
          </p>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor="pacing">Pacing ({settings.tts.pacing.toFixed(2)}×)</Label>
          <input
            id="pacing"
            type="range"
            min={0.25}
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

        {settings.tts.voiceId === '' ? null : (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Changing the narrator makes every video made so far sound like a different channel, so
            it is worth doing once. Narration already recorded is not re-read — press{' '}
            <strong>Add voice</strong> above and only new takes use the new voice.
          </p>
        )}
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
          IPA between slashes is sent to the narrator as written; anything else is treated as a
          respelling and read in place of the word. A pronunciation is checked with the voice when
          you add it, because each voice validates against the phoneme set of its own language — so
          a transcription can be correct IPA and still be refused, usually because it uses a sound
          that language does not have. A respelling always works.
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
    <div className="flex flex-col gap-3">
      <AuditionPanel settings={settings} saving={saving} commit={commit} />
      <ChosenVoice settings={settings} saving={saving} commit={commit} />
      <PhonemeHints settings={settings} saving={saving} commit={commit} />
    </div>
  )
}
