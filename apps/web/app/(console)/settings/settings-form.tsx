'use client'

import {
  LLM_PROVIDERS,
  LLM_TASKS,
  PROVIDERS,
  STILL_PROVIDERS,
  type LlmProvider,
  type LlmTask,
  type Provider,
  type Settings,
  type SettingsPatch,
  type StillProvider,
} from '@boom-busters/schemas'
import { LIVE_IMAGE_GEN_ADAPTERS, LLM_MODELS, knownModel, topModel } from '@boom-busters/providers'
import type { MaskedCredential } from '@boom-busters/db'
import dynamic from 'next/dynamic'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VoiceTab } from './voice-tab'
import { MusicTab, type MusicBedView } from './music-tab'
import { YoutubeCard } from './youtube-card'
import { useToast } from '@/components/ui/toast'
import { saveProviderKey, saveSettings, verifyProviderKey } from './actions'

/**
 * Loaded on demand: the specimen carries @remotion/player and the whole
 * composition library, which the other five tabs never need. `ssr: false`
 * because the Player draws frames — there is nothing to server-render.
 */
const BrandSpecimenPanel = dynamic(
  () => import('./brand-specimen').then((module) => module.BrandSpecimenPanel),
  {
    ssr: false,
    loading: () => (
      <p className="text-[13px] text-[var(--color-text-muted)]">Loading the specimen…</p>
    ),
  },
)

const TASK_LABELS: Record<LlmTask, string> = {
  research: 'Research (dossiers)',
  scripting: 'Script drafting',
  editing: 'Editing and self-checks',
  shotlist: 'Shot lists',
  metadata: 'Titles and descriptions',
  digest: 'Weekly digest',
}

const CREDENTIAL_PROVIDERS: Provider[] = [...PROVIDERS]

/**
 * What each key is *for*, beside the id it is stored under.
 *
 * Not decoration: the Gemini era proved that two confusable names with no
 * stated purpose is how a key ends up filed against the wrong API and
 * reported as refused. Saying what each one drives is
 * the cheapest thing that stops the next person making the same mistake, and
 * "the next person" here is the same person.
 */
const PROVIDER_PURPOSE: Record<Provider, string> = {
  anthropic: 'Research, scripting and the self-check — the default for every task',
  openai: 'Alternative for any task, and the cross-provider fallback',
  google:
    'Gemini text models, and still-image generation for the visual board ' +
    '(~$0.04 per image). A key from AI Studio, not the Cloud console',
  elevenlabs: 'The narration voice (Eleven v3), with free word timings for alignment',
  pexels: 'Stock footage and stills for the visual board. Free API — searches cost nothing',
  pixabay: 'Stock footage and stills for the visual board. Free API — searches cost nothing',
  fal:
    'Alternative still generator (FLUX, ~$0.03 per image) — used only when ' +
    'no Google key is stored',
  // The milestone note matters: this card stores a key that nothing reads
  // yet. A card that silently swallows a key reads as wired; saying when it
  // starts spending is the difference between a store and a trap.
  'hosted-alignment': 'Fallback caption alignment, when Whisper is not used. Not used until M6',
}

export function SettingsForm({
  initialSettings,
  credentials,
  mockProviders,
  youtubeEnvReady = false,
  initialTab = 'models',
  musicBeds = [],
}: {
  initialSettings: Settings
  credentials: MaskedCredential[]
  /** Resolved on the server: `process.env` is not readable from the client. */
  mockProviders: boolean
  /** Whether the YouTube OAuth client env vars exist — server-resolved too. */
  youtubeEnvReady?: boolean
  /** From `?tab=`, validated by the page — deep links land on the right tab. */
  initialTab?: string
  musicBeds?: MusicBedView[]
}) {
  const [settings, setSettings] = React.useState(initialSettings)
  const [saving, setSaving] = React.useState(false)
  const { toast } = useToast()

  /**
   * Optimistic update with a rollback toast on failure (spec section 11.1).
   * The previous value is captured before the write so a rejected patch
   * restores exactly what was on screen, not a stale refetch.
   */
  const commit = React.useCallback(
    async (patch: SettingsPatch, optimistic: Settings) => {
      const previous = settings
      setSettings(optimistic)
      setSaving(true)

      const result = await saveSettings(patch)

      setSaving(false)
      if (!result.ok) {
        setSettings(previous)
        toast({ title: 'Could not save', description: result.error, variant: 'error' })
      } else {
        toast({ title: 'Saved' })
      }
    },
    [settings, toast],
  )

  return (
    <Tabs defaultValue={initialTab}>
      <TabsList>
        <TabsTrigger value="models">Models</TabsTrigger>
        <TabsTrigger value="brand-kit">Brand Kit</TabsTrigger>
        <TabsTrigger value="voice">Voice</TabsTrigger>
        <TabsTrigger value="music">Music library</TabsTrigger>
        <TabsTrigger value="publishing">Publishing</TabsTrigger>
        <TabsTrigger value="connections">Connections</TabsTrigger>
      </TabsList>

      <TabsContent value="models">
        <ModelsTab settings={settings} saving={saving} commit={commit} />
      </TabsContent>

      <TabsContent value="brand-kit">
        <BrandKitTab settings={settings} saving={saving} commit={commit} />
      </TabsContent>

      <TabsContent value="voice">
        <VoiceTab settings={settings} saving={saving} commit={commit} />
      </TabsContent>

      <TabsContent value="music">
        <MusicTab beds={musicBeds} />
      </TabsContent>

      <TabsContent value="publishing">
        <PublishingTab settings={settings} saving={saving} commit={commit} />
      </TabsContent>

      <TabsContent value="connections">
        <ConnectionsTab
          credentials={credentials}
          mockProviders={mockProviders}
          youtubeEnvReady={youtubeEnvReady}
        />
      </TabsContent>
    </Tabs>
  )
}

interface TabProps {
  settings: Settings
  saving: boolean
  commit: (patch: SettingsPatch, optimistic: Settings) => Promise<void>
}

function ModelsTab({ settings, saving, commit }: TabProps) {
  const setRoute = (task: LlmTask, provider: LlmProvider, model: string) => {
    const next = structuredClone(settings)
    next.modelRouting[task] = { provider, model }
    void commit({ modelRouting: { [task]: { provider, model } } }, next)
  }

  const setStillRoute = (provider: StillProvider, model: string) => {
    const next = structuredClone(settings)
    next.modelRouting.stills = { provider, model }
    void commit({ modelRouting: { stills: { provider, model } } }, next)
  }

  const stills = settings.modelRouting.stills
  const stillModels = LIVE_IMAGE_GEN_ADAPTERS[stills.provider].models

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model routing</CardTitle>
        <CardDescription>
          Which model runs each task. Changing one never redeploys anything — routing is resolved
          from these settings at call time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {LLM_TASKS.map((task) => {
          const route = settings.modelRouting[task]
          return (
            <div key={task} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
              <Label htmlFor={`route-${task}-provider`}>{TASK_LABELS[task]}</Label>

              <Select
                id={`route-${task}-provider`}
                aria-label={`${TASK_LABELS[task]} provider`}
                value={route.provider}
                disabled={saving}
                onChange={(event) => {
                  const provider = event.target.value as LlmProvider
                  // Switching provider keeps the tier, not the model id: the
                  // old id means nothing to the new provider.
                  setRoute(task, provider, topModel(provider).id)
                }}
                className="sm:w-40"
              >
                {LLM_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </Select>

              <Select
                aria-label={`${TASK_LABELS[task]} model`}
                value={route.model}
                disabled={saving}
                onChange={(event) => setRoute(task, route.provider, event.target.value)}
                className="sm:w-48"
              >
                {LLM_MODELS[route.provider].map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
                {/* A model the adapters do not list is shown rather than
                    silently swapped, because it is what the run will actually
                    be refused on at pre-flight. */}
                {knownModel(route.provider, route.model) ? null : (
                  <option value={route.model}>{route.model} (unlisted)</option>
                )}
              </Select>
            </div>
          )
        })}

        {/* The still-image generator (decision 208) — not an LLM task, but
            routed where the human looks for every other model decision. */}
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Label htmlFor="route-stills-provider">Still images (visuals)</Label>

          <Select
            id="route-stills-provider"
            aria-label="Still images provider"
            value={stills.provider}
            disabled={saving}
            onChange={(event) => {
              const provider = event.target.value as StillProvider
              // Switching provider starts at its default model: the old id
              // means nothing to the new provider.
              setStillRoute(provider, LIVE_IMAGE_GEN_ADAPTERS[provider].models[0]!.id)
            }}
            className="sm:w-40"
          >
            {STILL_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Still images model"
            value={stills.model}
            disabled={saving}
            onChange={(event) => setStillRoute(stills.provider, event.target.value)}
            className="sm:w-48"
          >
            {stillModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} (${model.pricePerImage.toFixed(2)}/image)
              </option>
            ))}
            {/* Same rule as the LLM rows: an unlisted id is shown, because it
                is what generation will actually be refused on. */}
            {stillModels.some((model) => model.id === stills.model) ? null : (
              <option value={stills.model}>{stills.model} (unlisted)</option>
            )}
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}

function BrandKitTab({ settings, saving, commit }: TabProps) {
  const { colors } = settings.brandKit

  const setColor = (key: 'primary' | 'accent' | 'captionHighlight', value: string) => {
    const next = structuredClone(settings)
    next.brandKit.colors[key] = value
    void commit({ brandKit: { ...next.brandKit } }, next)
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Colours</CardTitle>
          <CardDescription>
            Timelines snapshot these at compile time, so a rebrand never changes how an old project
            re-renders.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {(['primary', 'accent', 'captionHighlight'] as const).map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`colour-${key}`}>{key}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`colour-${key}`}
                  type="color"
                  className="h-10 w-14 p-1"
                  disabled={saving}
                  defaultValue={colors[key]}
                  onBlur={(event) => setColor(key, event.target.value)}
                />
                <span className="font-mono text-[13px] text-[var(--color-text-secondary)]">
                  {colors[key]}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chart series palette</CardTitle>
          <CardDescription>
            Ordered and colour-blind safe. Charts are the anti-slop differentiator, so this palette
            is used in order, never randomly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {colors.chartSeries.map((colour, index) => (
            <span
              key={`${colour}-${index}`}
              className="flex items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-2 py-1"
            >
              <span
                aria-hidden
                className="size-4 rounded-[4px]"
                style={{ backgroundColor: colour }}
              />
              <span className="font-mono text-[12px]">{colour}</span>
            </span>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live specimen</CardTitle>
          <CardDescription>
            The chapter card, lower third, chart and karaoke captions rendered through
            @remotion/player with these exact values — the same components every render uses, so
            this is what the pipeline will draw. Colour edits above show up here as they save.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandSpecimenPanel settings={settings} />
        </CardContent>
      </Card>
    </div>
  )
}

function PublishingTab({ settings, saving, commit }: TabProps) {
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>YouTube API audit</CardTitle>
          <CardDescription>
            Until the audit passes, the publish screen shows a manual &ldquo;flip to public in
            Studio&rdquo; checklist instead of pretending the API can do it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Switch
            id="api-audit"
            checked={settings.publish.apiAuditPassed}
            disabled={saving}
            onCheckedChange={(checked) => {
              const next = structuredClone(settings)
              next.publish.apiAuditPassed = checked
              void commit({ publish: { ...next.publish } }, next)
            }}
          />
          <Label htmlFor="api-audit">
            {settings.publish.apiAuditPassed ? 'Audit passed' : 'Audit not passed yet'}
          </Label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default schedule slots</CardTitle>
          <CardDescription>
            Stored as UTC; the calendar renders them in your timezone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {settings.publish.defaultScheduleSlots.map((slot, index) => (
            <div
              key={`${slot.kind}-${slot.weekday}-${slot.timeUtc}-${index}`}
              className="flex items-center gap-3 text-[14px]"
            >
              <span className="w-20 text-[var(--color-text-secondary)]">{slot.kind}</span>
              <span className="w-28">{WEEKDAYS[slot.weekday]}</span>
              <span className="font-mono tabular-nums">{slot.timeUtc} UTC</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ConnectionsTab({
  credentials,
  mockProviders,
  youtubeEnvReady,
}: {
  credentials: MaskedCredential[]
  mockProviders: boolean
  youtubeEnvReady: boolean
}) {
  const byProvider = new Map(credentials.map((credential) => [credential.provider, credential]))

  return (
    <div className="flex flex-col gap-3">
      {/* Which mode this deployment is in decides whether pressing anything
          here spends money. It was previously invisible, and "no provider was
          called" is not something to infer from an absent environment
          variable. */}
      <p
        className={`rounded-[8px] border p-3 text-[13px] ${
          mockProviders
            ? 'border-[var(--color-border)] text-[var(--color-text-secondary)]'
            : 'border-[var(--color-warning)]/50 text-[var(--color-warning)]'
        }`}
      >
        {mockProviders ? (
          <>
            <span className="font-medium">Mock providers are on.</span> Nothing here reaches a
            vendor and nothing costs money. Pipeline runs return deterministic placeholder text.
          </>
        ) : (
          <>
            <span className="font-medium">Live providers.</span> Every pipeline run and every Verify
            press calls the real API and is billed to you. The monthly ceiling on the Costs screen
            is what stands between a runaway run and your card.
          </>
        )}
      </p>

      {/* OAuth, not a key paste — its own card, above the key grid. */}
      <YoutubeCard credential={byProvider.get('youtube')} envReady={youtubeEnvReady} />

      <div className="grid gap-3 sm:grid-cols-2">
        {CREDENTIAL_PROVIDERS.map((provider) => (
          <ConnectionCard
            key={provider}
            provider={provider}
            credential={byProvider.get(provider)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * "unchecked" is not a warning and not a success — it means nobody has asked
 * the vendor yet. Saying so in words beats a green chip that implies the key
 * was tested when it was only stored.
 */
const STATUS_LABELS: Record<string, string> = {
  ok: 'verified',
  invalid: 'rejected',
  unchecked: 'stored, not verified',
}

function statusColour(status: string | undefined): string {
  if (status === 'ok') return 'text-[var(--color-success)]'
  if (status === 'invalid') return 'text-[var(--color-danger)]'
  return 'text-[var(--color-text-muted)]'
}

function ConnectionCard({
  provider,
  credential,
}: {
  provider: Provider
  credential: MaskedCredential | undefined
}) {
  const [value, setValue] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [verifying, setVerifying] = React.useState(false)
  const { toast } = useToast()

  /**
   * Which providers have an adapter to ping. The others show no button rather
   * than one that always fails.
   */
  const verifiable =
    provider === 'anthropic' ||
    provider === 'openai' ||
    provider === 'google' ||
    provider === 'elevenlabs' ||
    provider === 'pexels' ||
    provider === 'pixabay' ||
    provider === 'fal'

  const submit = async () => {
    setSaving(true)
    const result = await saveProviderKey(provider, value)
    setSaving(false)

    if (result.ok) {
      setValue('')
      toast({ title: `${provider} key saved` })
    } else {
      toast({ title: 'Could not save key', description: result.error, variant: 'error' })
    }
  }

  const verify = async () => {
    setVerifying(true)
    const result = await verifyProviderKey(provider)
    setVerifying(false)

    if (result.ok) {
      toast({
        title: result.mocked
          ? `${provider} answered — but mock providers are on, so nothing was checked`
          : `${provider} key works`,
      })
    } else {
      toast({ title: `${provider} key not verified`, description: result.error, variant: 'error' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          {provider}
          <span className={`text-[12px] font-normal ${statusColour(credential?.verifyStatus)}`}>
            {credential ? STATUS_LABELS[credential.verifyStatus] : 'not set'}
          </span>
        </CardTitle>
        <CardDescription>{PROVIDER_PURPOSE[provider]}</CardDescription>
        <CardDescription className="font-mono">
          {credential ? credential.masked : 'No key stored'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Input
          type="password"
          aria-label={`${provider} API key`}
          placeholder={credential ? 'Replace key' : 'Paste key'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={saving}
        />
        <Button variant="outline" busy={saving} disabled={value.trim() === ''} onClick={submit}>
          Save
        </Button>
        {verifiable && credential ? (
          <Button variant="ghost" busy={verifying} onClick={verify}>
            Verify
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
