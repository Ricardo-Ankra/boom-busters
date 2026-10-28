'use client'

import {
  PROVIDERS,
  type ModelPrices,
  type Provider,
  type WorkspaceSettings,
} from '@boom-busters/schemas'
import type { ModelOptions } from '@boom-busters/providers'
import type { MaskedCredential } from '@boom-busters/db'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { MusicTab, type MusicBedView } from './music-tab'
import { PricesTab } from './prices-tab'
import { saveProviderKey, saveWorkspaceSettings, verifyProviderKey } from './workspace-actions'

/**
 * The workspace settings: what belongs to the owner and not to one channel.
 * Provider keys, the model price table and the shared music library. Channel
 * settings (routing, brand, voice, logos, exemplars, publishing, the YouTube
 * connection) live under each channel.
 */

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
  anthropic: 'Research, scripting and the self-check, the default for every task',
  openai: 'Alternative for any task, and the cross-provider fallback',
  google:
    'Gemini text models, and still-image generation for the visual board ' +
    '(~$0.04 per image). A key from AI Studio, not the Cloud console',
  elevenlabs: 'The narration voice (Eleven v3), with free word timings for alignment',
  pexels: 'Stock footage and stills for the visual board. Free API, searches cost nothing',
  pixabay: 'Stock footage and stills for the visual board. Free API, searches cost nothing',
  fal:
    'Alternative still generator (FLUX, ~$0.03 per image), used only when ' +
    'no Google key is stored',
  // The "nothing reads this" note matters: a card that silently swallows a
  // key reads as wired; saying so is the difference between a store and a
  // trap. ElevenLabs ships word timings with the narration, so this fallback
  // never got a consumer.
  'hosted-alignment':
    'Fallback caption alignment, when Whisper is not used. Nothing reads this key yet',
}

export function WorkspaceForm({
  initialSettings,
  credentials,
  mockProviders,
  musicBeds = [],
  modelOptions,
  routedKeys = [],
  initialTab = 'connections',
}: {
  initialSettings: WorkspaceSettings
  credentials: MaskedCredential[]
  /** Resolved on the server: `process.env` is not readable from the client. */
  mockProviders: boolean
  musicBeds?: MusicBedView[]
  /** Live lists merged with the catalogue, built on the server (decision 288). */
  modelOptions: ModelOptions
  /** `provider:model` for every model some channel routes to. */
  routedKeys?: string[]
  /** From `?tab=`, validated by the page. */
  initialTab?: string
}) {
  const [settings, setSettings] = React.useState(initialSettings)
  const [saving, setSaving] = React.useState(false)
  const { toast } = useToast()

  /**
   * Optimistic update with a rollback toast on failure (spec section 11.1):
   * the previous value is captured before the write so a rejected patch
   * restores exactly what was on screen.
   */
  const commitPrices = React.useCallback(
    async (patch: { modelPrices: ModelPrices }, optimistic: ModelPrices) => {
      const previous = settings
      setSettings({ ...settings, modelPrices: optimistic })
      setSaving(true)

      const result = await saveWorkspaceSettings(patch)

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
        <TabsTrigger value="connections">Connections</TabsTrigger>
        <TabsTrigger value="prices">Prices</TabsTrigger>
        <TabsTrigger value="music">Music library</TabsTrigger>
      </TabsList>

      <TabsContent value="connections">
        <ConnectionsTab credentials={credentials} mockProviders={mockProviders} />
      </TabsContent>

      <TabsContent value="prices">
        <PricesTab
          prices={settings.modelPrices}
          options={modelOptions}
          routedKeys={routedKeys}
          saving={saving}
          commit={commitPrices}
        />
      </TabsContent>

      <TabsContent value="music">
        <MusicTab beds={musicBeds} />
      </TabsContent>
    </Tabs>
  )
}

function ConnectionsTab({
  credentials,
  mockProviders,
}: {
  credentials: MaskedCredential[]
  mockProviders: boolean
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

      <p className="text-[13px] text-[var(--color-text-secondary)]">
        These keys serve every channel. Each channel connects its own YouTube account under its
        Connections tab.
      </p>

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
 * "unchecked" is not a warning and not a success: it means nobody has asked
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
          ? `${provider} answered, but mock providers are on, so nothing was checked`
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
