'use client'

import type { KnownVoice } from '@boom-busters/providers'
import type { PhonemeHint, Settings, SettingsPatch, TtsProvider } from '@boom-busters/schemas'
import { Loader2, Lock, LockOpen, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { MAX_AUDITIONS, MAX_SAMPLE_CHARS } from '@/lib/audition'
import type { Audition } from '@/lib/audition'
import { chooseVoice, generateAuditions, listAuditionVoices, unlockVoice } from './voice-actions'

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

function AuditionCard({
  audition,
  chosen,
  onChosen,
  locked,
}: {
  audition: Audition
  chosen: boolean
  onChosen: () => void
  locked: boolean
}) {
  const [busy, setBusy] = React.useState(false)
  const { toast } = useToast()
  const router = useRouter()

  async function choose(): Promise<void> {
    setBusy(true)
    const result = await chooseVoice(audition.provider, audition.voiceId)
    setBusy(false)

    if (!result.ok) {
      toast({ title: 'Could not choose that voice', description: result.error, variant: 'error' })
      return
    }

    toast({ title: 'Voice chosen and locked', description: `${audition.voiceId} will narrate.` })
    onChosen()
    router.refresh()
  }

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-[8px] border p-3',
        chosen ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[14px] font-medium">{audition.voiceId}</span>
        <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
          {audition.provider}
        </span>
      </div>

      {audition.error ? (
        <p className="text-[12px] text-[var(--color-danger)]">{audition.error}</p>
      ) : (
        <>
          {/* A plain <audio> with controls: this is the one place in the app
              where the browser's own transport is exactly right — you scrub
              back over the same six seconds comparing voices. */}
          <audio
            controls
            preload="none"
            src={`data:audio/wav;base64,${audition.audio ?? ''}`}
            className="w-full"
          >
            <track kind="captions" />
          </audio>
          <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
            {((audition.durationMs ?? 0) / 1000).toFixed(1)}s · $
            {(audition.costUsd ?? 0).toFixed(4)}
          </p>
          <Button onClick={choose} disabled={busy || locked || chosen} variant="outline">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {chosen ? 'This is the narrator' : 'Choose this voice'}
          </Button>
        </>
      )}
    </li>
  )
}

function AuditionPanel({ settings }: { settings: Settings }) {
  const [sample, setSample] = React.useState(DEFAULT_SAMPLE)
  const [catalogue, setCatalogue] = React.useState<
    { provider: TtsProvider; voices: KnownVoice[]; error?: string }[] | null
  >(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [auditions, setAuditions] = React.useState<Audition[]>([])
  const [busy, setBusy] = React.useState(false)
  const { toast } = useToast()

  React.useEffect(() => {
    void listAuditionVoices().then(setCatalogue)
  }, [])

  const key = (provider: string, voiceId: string) => `${provider}:${voiceId}`

  function toggle(provider: TtsProvider, voiceId: string): void {
    setSelected((current) => {
      const next = new Set(current)
      const id = key(provider, voiceId)
      if (next.has(id)) next.delete(id)
      // Refused rather than silently dropped: a cap you hit without being told
      // reads as a broken checkbox.
      else if (next.size >= MAX_AUDITIONS) {
        toast({
          title: `${MAX_AUDITIONS} voices at a time`,
          description: 'Each one is a separate synthesis, and each one costs.',
        })
      } else next.add(id)
      return next
    })
  }

  async function generate(): Promise<void> {
    setBusy(true)
    const result = await generateAuditions(
      sample,
      [...selected].map((id) => {
        const [provider = '', voiceId = ''] = id.split(':')
        return { provider, voiceId }
      }),
    )
    setBusy(false)

    if (!result.ok) {
      toast({ title: 'Nothing was generated', description: result.error, variant: 'error' })
      return
    }
    setAuditions(result.auditions ?? [])
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice audition</CardTitle>
        <CardDescription>
          Paste a paragraph and hear it in up to {MAX_AUDITIONS} voices side by side. Each audition
          is a real synthesis and is charged against the same monthly cap as the pipeline.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="audition-sample">Sample paragraph</Label>
          <textarea
            id="audition-sample"
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            rows={3}
            maxLength={MAX_SAMPLE_CHARS}
            className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          />
          <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
            {sample.length}/{MAX_SAMPLE_CHARS}
          </p>
        </div>

        {catalogue === null ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">Loading voices…</p>
        ) : (
          catalogue.map((group) => (
            <div key={group.provider} className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold capitalize">{group.provider}</h3>
              {group.error ? (
                <p className="text-[12px] text-[var(--color-warning)]">{group.error}</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {group.voices.map((voice) => (
                    <li key={voice.id}>
                      <Button
                        variant={
                          selected.has(key(group.provider, voice.id)) ? 'primary' : 'outline'
                        }
                        aria-pressed={selected.has(key(group.provider, voice.id))}
                        onClick={() => toggle(group.provider, voice.id)}
                        title={voice.description ?? voice.label}
                      >
                        {voice.label}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}

        <div>
          <Button onClick={generate} disabled={busy || selected.size === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {busy
              ? 'Generating…'
              : `Generate ${selected.size} audition${selected.size === 1 ? '' : 's'}`}
          </Button>
        </div>

        {auditions.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {auditions.map((audition) => (
              <AuditionCard
                key={`${audition.provider}:${audition.voiceId}`}
                audition={audition}
                chosen={
                  settings.tts.provider === audition.provider &&
                  settings.tts.voiceId === audition.voiceId
                }
                onChosen={() => undefined}
                locked={settings.tts.locked}
              />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The chosen voice, and its lock
// ---------------------------------------------------------------------------

function ChosenVoice({ settings, saving, commit }: TabProps) {
  const [confirmation, setConfirmation] = React.useState('')
  const [unlocking, setUnlocking] = React.useState(false)
  const { toast } = useToast()
  const router = useRouter()

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
            Sent with every paragraph. Gemini follows it as an instruction; ElevenLabs applies it
            through its own voice settings.
          </p>
        </div>

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

  function save(hints: PhonemeHint[]): void {
    const next = structuredClone(settings)
    next.tts.phonemeHints = hints
    void commit({ tts: { phonemeHints: hints } }, next)
  }

  function add(): void {
    if (term.trim() === '' || hint.trim() === '') return
    save([
      ...settings.tts.phonemeHints.filter(
        (existing) => existing.term.toLowerCase() !== term.trim().toLowerCase(),
      ),
      { term: term.trim(), hint: hint.trim() },
    ])
    setTerm('')
    setHint('')
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
          <Button onClick={add} disabled={saving || term.trim() === '' || hint.trim() === ''}>
            <Plus className="size-4" aria-hidden />
            Add
          </Button>
        </div>

        <p className="text-[12px] text-[var(--color-text-muted)]">
          IPA between slashes becomes a phoneme tag where the provider supports one. Anything else
          is treated as a respelling and is read in place of the word.
        </p>
      </CardContent>
    </Card>
  )
}

export function VoiceTab({ settings, saving, commit }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      <ChosenVoice settings={settings} saving={saving} commit={commit} />
      <PhonemeHints settings={settings} saving={saving} commit={commit} />
      <AuditionPanel settings={settings} />
    </div>
  )
}
