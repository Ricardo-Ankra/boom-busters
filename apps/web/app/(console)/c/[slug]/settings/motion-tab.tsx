'use client'

import {
  LAST_RESORT_TECHNIQUES,
  type MotionIdentity,
  type Settings,
  type SettingsPatch,
  type Technique,
} from '@boom-busters/schemas'
import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, NumberInput, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { CopyMotion } from './copy-motion'
import { DeriveSection } from './derive-section'
import type { DerivationView } from './exemplar-actions'
import { IdentityDraft } from './identity-draft'
import type { DerivationEstimateTable } from '@/lib/motion-estimates'
import { ReferencesSection, type ReferenceView } from './references-section'

/**
 * The Motion tab (spec 2026-11-04, section 11.1, plan 1): the channel's motion
 * identity, every field saved on its own as a `motion` patch, the Brand Kit
 * tab's pattern. The house values are the defaults, so a channel that never
 * set them shows them. The references, the readings and the derivation come
 * with later plans; this tab holds the identity and the techniques in use.
 */

export interface TechniqueOption {
  technique: Technique
  description: string
}

interface MotionTabProps {
  channelId: string
  archived: boolean
  settings: Settings
  saving: boolean
  commit: (patch: SettingsPatch, optimistic: Settings) => Promise<void>
  techniqueOptions: readonly TechniqueOption[]
  /** The channel's reference pack, in order (spec 2026-11-04, section 11.2). */
  references: readonly ReferenceView[]
  /** R2 is configured, so a reference can be uploaded. */
  storageReady: boolean
  /** What one reading costs on the graphics route, in dollars. */
  readingEstimateUsd: number
  /** What one identity draft costs on the graphics route, in dollars. */
  draftEstimateUsd: number
  /** The latest derivation (spec 2026-11-04, section 11.3); null before one ran. */
  derivation?: DerivationView | null
  /** A derivation is running: Derive and Copy wait. */
  jobRunning?: boolean
  /** The derivation's prices; absent, the Derive section and Copy are not shown. */
  estimateTable?: DerivationEstimateTable
  /** The techniques with an approved version, so Derive ticks the rest by default. */
  approvedTechniques?: readonly Technique[]
  /** Every other channel, for Copy motion. */
  copySources?: readonly { id: string; name: string; archived: boolean }[]
}

const STYLE_GUIDE_MAX = 4000
const textareaClass =
  'min-h-[96px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50'
const mutedClass = 'text-[12px] text-[var(--color-text-muted)]'

/** A phrase list as the textarea holds it: one per line. */
const linesOf = (phrases: readonly string[]) => phrases.join('\n')
const phrasesOf = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

export function MotionTab({
  channelId,
  archived,
  settings,
  saving,
  commit,
  techniqueOptions,
  references,
  storageReady,
  readingEstimateUsd,
  draftEstimateUsd,
  derivation = null,
  jobRunning = false,
  estimateTable,
  approvedTechniques = [],
  copySources = [],
}: MotionTabProps) {
  const motion = settings.motion
  // Typed text is held locally until blur, so a keystroke does not save a patch.
  const [never, setNever] = React.useState(linesOf(motion.never))
  const [allow, setAllow] = React.useState(linesOf(motion.allow))
  const [guide, setGuide] = React.useState(motion.styleGuideMd)
  const [camera, setCamera] = React.useState(motion.cameraRule)
  const [cadence, setCadence] = React.useState(String(motion.changeEveryMs))
  const [still, setStill] = React.useState(String(motion.stillMaxMs))
  React.useEffect(() => {
    setNever(linesOf(motion.never))
    setAllow(linesOf(motion.allow))
    setGuide(motion.styleGuideMd)
    setCamera(motion.cameraRule)
    setCadence(String(motion.changeEveryMs))
    setStill(String(motion.stillMaxMs))
  }, [motion])

  /** A typed number saved on blur, when it parses and differs from what is stored. */
  const saveNumber = (key: 'changeEveryMs' | 'stillMaxMs', raw: string) => {
    const value = Number(raw)
    if (raw.trim() === '' || Number.isNaN(value)) return
    if (value !== motion[key]) set(key, value)
  }

  const set = <K extends keyof MotionIdentity>(key: K, value: MotionIdentity[K]) => {
    const next = structuredClone(settings)
    next.motion[key] = value
    void commit({ motion: { [key]: value } }, next)
  }

  const setLength = (key: keyof MotionIdentity['ms'], raw: string) => {
    const value = raw.trim() === '' ? undefined : Number(raw)
    const ms = { ...motion.ms }
    if (value === undefined || Number.isNaN(value)) delete ms[key]
    else ms[key] = value
    set('ms', ms)
  }

  const toggleTechnique = (technique: Technique, on: boolean) => {
    const techniques = on
      ? techniqueOptions
          .map((option) => option.technique)
          .filter((key) => key === technique || motion.techniques.includes(key))
      : motion.techniques.filter((key) => key !== technique)
    set('techniques', techniques)
  }

  const lengths: { key: keyof MotionIdentity['ms']; label: string }[] = [
    { key: 'enter', label: 'Entrance (ms)' },
    { key: 'exit', label: 'Exit (ms)' },
    { key: 'reveal', label: 'Wipe (ms)' },
    { key: 'draw', label: 'Draw on (ms)' },
    { key: 'count', label: 'Count (ms)' },
    { key: 'move', label: 'Move (ms)' },
    { key: 'gap', label: 'Gap (ms)' },
  ]

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Motion identity</CardTitle>
          <CardDescription>
            What every graphic on this channel moves like. The designer reads these on every call;
            the house values stand until you change them, and a change applies to the next design,
            never to one already stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motion-ease">Signature easing</Label>
            <Select
              id="motion-ease"
              value={motion.signatureEase}
              disabled={saving}
              onChange={(event) =>
                set('signatureEase', event.target.value as MotionIdentity['signatureEase'])
              }
            >
              <option value="soft">Soft: arrivals settle long, moves ease both ways</option>
              <option value="crisp">Crisp: arrivals snap in, moves ease hard</option>
              <option value="gentle">Gentle: sine curves, nothing abrupt</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motion-entrance">Entrance</Label>
            <Select
              id="motion-entrance"
              value={motion.entrance}
              disabled={saving}
              onChange={(event) =>
                set('entrance', event.target.value as MotionIdentity['entrance'])
              }
            >
              <option value="rise">Rise: a fade with a small lift</option>
              <option value="fade">Fade: opacity only</option>
              <option value="scale">Scale: in from 90%</option>
              <option value="wipe">Wipe: a clip-path reveal</option>
              <option value="slide">Slide: in from the side</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motion-overshoot">Overshoot</Label>
            <Select
              id="motion-overshoot"
              value={motion.overshoot}
              disabled={saving}
              onChange={(event) =>
                set('overshoot', event.target.value as MotionIdentity['overshoot'])
              }
            >
              <option value="none">None: every spring settles without passing its mark</option>
              <option value="hair">A hair: the hero once per beat, snap on small things</option>
              <option value="welcome">Welcome: loose hero and snap springs</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motion-3d">3D</Label>
            <Select
              id="motion-3d"
              value={motion.threeD}
              disabled={saving}
              onChange={(event) => set('threeD', event.target.value as MotionIdentity['threeD'])}
            >
              <option value="never">Never</option>
              <option value="whenMeaningful">When it carries meaning</option>
              <option value="welcome">Welcome where it reads</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motion-cadence">Change cadence (ms)</Label>
            <NumberInput
              id="motion-cadence"
              min={500}
              max={10000}
              step={100}
              value={cadence}
              disabled={saving}
              onChange={(event) => setCadence(event.target.value)}
              onBlur={() => saveNumber('changeEveryMs', cadence)}
            />
            <p className={mutedClass}>Something changes about this often.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motion-still">Still limit (ms)</Label>
            <NumberInput
              id="motion-still"
              min={1000}
              max={20000}
              step={500}
              value={still}
              disabled={saving}
              onChange={(event) => setStill(event.target.value)}
              onBlur={() => saveNumber('stillMaxMs', still)}
            />
            <p className={mutedClass}>
              A graphic in which nothing changes for longer is refused. At least the cadence.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="motion-camera">The camera</Label>
            <Input
              id="motion-camera"
              value={camera}
              maxLength={200}
              disabled={saving}
              onChange={(event) => setCamera(event.target.value)}
              onBlur={() => {
                if (camera.trim() !== motion.cameraRule) set('cameraRule', camera.trim())
              }}
            />
            <p className={mutedClass}>
              Completes the sentence &quot;and the camera ...&quot;: &quot;never moves&quot;, or
              &quot;never stops: a slow push ...&quot;.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="motion-blur"
              checked={motion.blurFollowsSpeed}
              disabled={saving}
              onCheckedChange={(checked) => set('blurFollowsSpeed', checked)}
            />
            <Label htmlFor="motion-blur">Blur follows speed</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="motion-charts"
              checked={motion.chartsConventional}
              disabled={saving}
              onCheckedChange={(checked) => set('chartsConventional', checked)}
            />
            <Label htmlFor="motion-charts">Charts stay conventional</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lengths</CardTitle>
          <CardDescription>
            Overrides on the house lengths, 40 to 3000 ms. Leave a field empty to keep the house
            value.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          {lengths.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`motion-ms-${key}`}>{label}</Label>
              <NumberInput
                id={`motion-ms-${key}`}
                min={40}
                max={3000}
                step={10}
                defaultValue={motion.ms[key] ?? ''}
                disabled={saving}
                onBlur={(event) => setLength(key, event.target.value)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Words for the designer</CardTitle>
          <CardDescription>
            The never list is what the designer is told not to use; allow takes a phrase out of it
            for this channel. The style guide is plain prose the designer and the critic read every
            call.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motion-never">Never</Label>
            <textarea
              id="motion-never"
              className={textareaClass}
              value={never}
              disabled={saving}
              onChange={(event) => setNever(event.target.value)}
              onBlur={() => {
                const phrases = phrasesOf(never)
                if (linesOf(phrases) !== linesOf(motion.never)) set('never', phrases)
              }}
            />
            <p className={mutedClass}>One phrase per line, at most 16.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motion-allow">Allow</Label>
            <textarea
              id="motion-allow"
              className={textareaClass}
              value={allow}
              disabled={saving}
              onChange={(event) => setAllow(event.target.value)}
              onBlur={() => {
                const phrases = phrasesOf(allow)
                if (linesOf(phrases) !== linesOf(motion.allow)) set('allow', phrases)
              }}
            />
            <p className={mutedClass}>One phrase per line, taken out of the never list.</p>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="motion-guide">Style guide</Label>
            <textarea
              id="motion-guide"
              className={textareaClass}
              value={guide}
              maxLength={STYLE_GUIDE_MAX}
              disabled={saving}
              onChange={(event) => setGuide(event.target.value)}
              onBlur={() => {
                if (guide !== motion.styleGuideMd) set('styleGuideMd', guide)
              }}
            />
            <p className={mutedClass}>
              {guide.length} of {STYLE_GUIDE_MAX} characters.
            </p>
          </div>
        </CardContent>
      </Card>

      <IdentityDraft
        channelId={channelId}
        current={motion}
        draftEstimateUsd={draftEstimateUsd}
        disabled={archived || saving}
        onApply={(identity) => commit({ motion: identity }, { ...settings, motion: identity })}
      />

      <Card>
        <CardHeader>
          <CardTitle>Techniques in use</CardTitle>
          <CardDescription>
            The techniques this channel designs with. An unticked technique is skipped when a slot
            is matched to an exemplar; a steer that names one still gets it. The word stack and the
            bar chart are always in use, so every slot has a fallback.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {techniqueOptions.map((option) => {
            const lastResort = (LAST_RESORT_TECHNIQUES as readonly Technique[]).includes(
              option.technique,
            )
            const id = `motion-technique-${option.technique}`
            return (
              <div key={option.technique} className="flex items-start gap-3">
                <input
                  id={id}
                  type="checkbox"
                  className="mt-1 h-5 w-5 accent-[var(--color-accent)]"
                  checked={motion.techniques.includes(option.technique)}
                  disabled={saving || lastResort}
                  onChange={(event) => toggleTechnique(option.technique, event.target.checked)}
                />
                <div className="flex flex-col">
                  <Label htmlFor={id}>{option.technique}</Label>
                  <p className={mutedClass}>
                    {option.description}
                    {lastResort ? ' Always in use.' : ''}
                  </p>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <ReferencesSection
        channelId={channelId}
        references={references}
        storageReady={storageReady}
        readingEstimateUsd={readingEstimateUsd}
        archived={archived}
      />
      {estimateTable ? (
        <>
          <DeriveSection
            channelId={channelId}
            derivation={derivation}
            jobRunning={jobRunning}
            techniques={techniqueOptions}
            defaults={motion.techniques.filter((key) => !approvedTechniques.includes(key))}
            estimateTable={estimateTable}
            storageReady={storageReady}
            archived={archived}
          />
          <CopyMotion
            channelId={channelId}
            sources={copySources}
            disabled={archived || jobRunning}
          />
        </>
      ) : null}
    </div>
  )
}
