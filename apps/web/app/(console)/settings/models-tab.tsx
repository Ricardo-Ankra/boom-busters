'use client'

import {
  LIVE_IMAGE_GEN_ADAPTERS,
  isStale,
  type ModelOption,
  type ModelOptions,
  type OptionPrice,
} from '@boom-busters/providers'
import {
  LLM_PROVIDERS,
  LLM_TASKS,
  STILL_PROVIDERS,
  modelPriceKey,
  type LlmProvider,
  type LlmTask,
  type ModelPrices,
  type Settings,
  type SettingsPatch,
  type StillProvider,
} from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { refreshModelListsAction } from './model-actions'

/**
 * Settings → Models (decision 287). The LLM rows offer each provider's live
 * list merged with the catalogue, every option labelled with how it is
 * priced, and an inline price form for the models the catalogue cannot
 * price. The image rows below still read the adapters; Task 12 moves them
 * onto the same options.
 */

const TASK_LABELS: Record<LlmTask, string> = {
  research: 'Research (dossiers)',
  scripting: 'Script drafting',
  editing: 'Editing and self-checks',
  shotlist: 'Shot lists',
  metadata: 'Titles and descriptions',
  digest: 'Weekly digest',
  direction: 'Visual direction',
}

const PROVIDER_NAMES = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  fal: 'fal.ai',
} as const

const STATUS_PROVIDERS = ['anthropic', 'openai', 'google', 'fal'] as const

/** The suffix each label puts on an option, so the select alone says what it is. */
const SUFFIX: Record<ModelOption['status'], string> = {
  catalogue: '',
  estimated: ' (estimated)',
  override: ' (your price)',
  retired: ' (no longer offered)',
  'needs-price': ' (needs a price)',
  incompatible: ' (not compatible)',
}

const PREVIEW_GROUP = 'Preview: Google can withdraw these without notice'

const money = (value: number) => `$${Number(value.toFixed(4))}`

function describePrice(price: OptionPrice): string {
  return price.kind === 'llm'
    ? `${money(price.inputPerMTok)} in, ${money(price.outputPerMTok)} out per million tokens`
    : `${money(price.pricePerImage)} per image`
}

/** A stored ISO time in the owner's local clock, or a plain word when absent. */
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-ZA') : 'an unknown time'

const PRICE_ERROR = 'Enter a price above zero, using a full stop for decimals.'

/** A typed price, or null when it is not a positive number written with a full stop. */
function parsePrice(raw: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(raw.trim())) return null
  const value = Number(raw)
  return value > 0 ? value : null
}

function statusLine(provider: (typeof STATUS_PROVIDERS)[number], options: ModelOptions): string {
  const name = PROVIDER_NAMES[provider]
  const status = options.status[provider]
  switch (status.kind) {
    case 'live':
      return `${name}: live list, refreshed ${when(status.lastSuccessAt)}.`
    case 'failed':
      return (
        `${name}: refresh failed at ${when(status.lastAttemptAt)}: ${status.error}. ` +
        (status.lastSuccessAt
          ? `Showing the list from ${when(status.lastSuccessAt)}.`
          : 'Showing the built-in list.')
      )
    case 'no-key':
      return `${name}: Add a key in Connections to load live models. Showing the built-in list.`
    case 'never':
      return `${name}: not refreshed yet. Showing the built-in list.`
  }
}

function LlmPriceForm({
  title,
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  title: string
  initial: OptionPrice | null
  saveLabel: string
  onSave: (price: {
    inputPerMTok: number
    outputPerMTok: number
    cachedInputPerMTok?: number
  }) => void
  onCancel: () => void
}) {
  const seed = initial?.kind === 'llm' ? initial : null
  const [input, setInput] = React.useState(seed ? String(seed.inputPerMTok) : '')
  const [output, setOutput] = React.useState(seed ? String(seed.outputPerMTok) : '')
  const [cached, setCached] = React.useState(
    seed?.cachedInputPerMTok ? String(seed.cachedInputPerMTok) : '',
  )
  const [error, setError] = React.useState<string | null>(null)
  const id = React.useId()

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const inputPerMTok = parsePrice(input)
        const outputPerMTok = parsePrice(output)
        const cachedInputPerMTok = cached.trim() === '' ? undefined : parsePrice(cached)
        if (inputPerMTok === null || outputPerMTok === null || cachedInputPerMTok === null) {
          setError(PRICE_ERROR)
          return
        }
        onSave({
          inputPerMTok,
          outputPerMTok,
          ...(cachedInputPerMTok !== undefined ? { cachedInputPerMTok } : {}),
        })
      }}
    >
      <p className="text-[13px]">{title}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-in`}>Input, $ per million tokens</Label>
          <Input
            id={`${id}-in`}
            inputMode="decimal"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-out`}>Output, $ per million tokens</Label>
          <Input
            id={`${id}-out`}
            inputMode="decimal"
            value={output}
            onChange={(event) => setOutput(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-cached`}>Cached input, $ per million tokens (optional)</Label>
          <Input
            id={`${id}-cached`}
            inputMode="decimal"
            value={cached}
            onChange={(event) => setCached(event.target.value)}
          />
        </div>
      </div>
      {error ? <p className="text-[12px] text-[var(--color-danger)]">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          {saveLabel}
        </Button>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function ModelsTab({
  settings,
  saving,
  commit,
  options,
}: {
  settings: Settings
  saving: boolean
  commit: (patch: SettingsPatch, optimistic: Settings) => Promise<void>
  options: ModelOptions
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [refreshing, setRefreshing] = React.useState(false)
  /** A route waiting on a price before it can be saved. */
  const [pending, setPending] = React.useState<{
    task: LlmTask
    provider: LlmProvider
    model: string
  } | null>(null)
  /** Which route's price form is open, for Set price and Edit price. */
  const [editing, setEditing] = React.useState<LlmTask | null>(null)
  const [refusal, setRefusal] = React.useState<{ task: LlmTask; message: string } | null>(null)

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshModelListsAction()
      router.refresh()
    } catch (error) {
      // A provider failing is reported in the results, not thrown; reaching
      // here means the action itself failed (signed out, server down).
      toast({
        title: 'Could not refresh the model lists',
        description: error instanceof Error ? error.message : String(error),
        variant: 'error',
      })
    } finally {
      setRefreshing(false)
    }
  }, [router, toast])

  // Once per mount, and only when a refresh could change anything: with no
  // key anywhere it would ask nobody and redraw the page on every visit.
  const autoRefreshed = React.useRef(false)
  React.useEffect(() => {
    if (autoRefreshed.current) return
    autoRefreshed.current = true
    if (options.canRefresh && isStale(options.lastAttemptAt, Date.now())) void refresh()
  }, [options.canRefresh, options.lastAttemptAt, refresh])

  const withPrice = (key: string, price: ModelPrices['llm'][string] | null): ModelPrices => {
    const llm = { ...settings.modelPrices.llm }
    if (price) llm[key] = price
    else delete llm[key]
    return { ...settings.modelPrices, llm }
  }

  const setRoute = (task: LlmTask, provider: LlmProvider, model: string) => {
    const next = structuredClone(settings)
    next.modelRouting[task] = { provider, model }
    void commit({ modelRouting: { [task]: { provider, model } } }, next)
  }

  const choose = (task: LlmTask, provider: LlmProvider, model: string) => {
    setRefusal(null)
    setEditing(null)
    const option = options.llm[provider].find((o) => o.id === model)
    // An unpriced model is never routed on its own: a run on it would be
    // refused at pre-flight, so the route and its price are saved together.
    if (option?.status === 'needs-price') {
      setPending({ task, provider, model })
      return
    }
    setPending(null)
    setRoute(task, provider, model)
  }

  const savePrice = (
    task: LlmTask,
    provider: LlmProvider,
    model: string,
    price: ModelPrices['llm'][string],
    alsoRoute: boolean,
  ) => {
    const modelPrices = withPrice(modelPriceKey(provider, model), price)
    const next = structuredClone(settings)
    next.modelPrices = modelPrices
    if (alsoRoute) next.modelRouting[task] = { provider, model }
    void commit(
      alsoRoute ? { modelRouting: { [task]: { provider, model } }, modelPrices } : { modelPrices },
      next,
    )
    setPending(null)
    setEditing(null)
  }

  const clearPrice = (task: LlmTask, provider: LlmProvider, model: string) => {
    const option = options.llm[provider].find((o) => o.id === model)
    // A model with nothing to fall back to (no catalogue row, no family) is
    // unpriced without the override, so clearing it under a route would
    // leave a route every run refuses.
    const users = LLM_TASKS.filter(
      (t) =>
        settings.modelRouting[t].provider === provider && settings.modelRouting[t].model === model,
    )
    if (option?.fallsBackTo === null && users.length > 0) {
      setRefusal({
        task,
        message: `${TASK_LABELS[users[0]!]} uses this model. Pick another model first.`,
      })
      return
    }
    setRefusal(null)
    setEditing(null)
    const next = structuredClone(settings)
    next.modelPrices = withPrice(modelPriceKey(provider, model), null)
    void commit({ modelPrices: next.modelPrices }, next)
  }

  const setStillRoute = (provider: StillProvider, model: string) => {
    const next = structuredClone(settings)
    next.modelRouting.stills = { provider, model }
    void commit({ modelRouting: { stills: { provider, model } } }, next)
  }

  /** Null turns the split off: one route generates every still again. */
  const setLikenessRoute = (route: { provider: StillProvider; model: string } | null) => {
    const next = structuredClone(settings)
    next.modelRouting.stillsLikeness = route
    void commit({ modelRouting: { stillsLikeness: route } }, next)
  }

  const stills = settings.modelRouting.stills
  const stillModels = LIVE_IMAGE_GEN_ADAPTERS[stills.provider].models
  const likeness = settings.modelRouting.stillsLikeness
  const likenessModels = LIVE_IMAGE_GEN_ADAPTERS[likeness?.provider ?? stills.provider].models

  const optionLabel = (option: ModelOption) => `${option.label}${SUFFIX[option.status]}`
  const renderOption = (option: ModelOption) => (
    <option key={option.id} value={option.id} disabled={!option.selectable}>
      {optionLabel(option)}
    </option>
  )

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {options.lastAttemptAt
              ? `Model lists last checked ${when(options.lastAttemptAt)}.`
              : 'Model lists not checked yet.'}
          </p>
          <Button
            type="button"
            onClick={() => void refresh()}
            busy={refreshing}
            disabled={refreshing || !options.canRefresh}
          >
            Refresh model lists
          </Button>
        </div>

        <ul
          aria-label="Model list status"
          className="flex flex-col gap-0.5 text-[12px] text-[var(--color-text-muted)]"
        >
          {STATUS_PROVIDERS.map((provider) => (
            <li key={provider}>{statusLine(provider, options)}</li>
          ))}
        </ul>

        {LLM_TASKS.map((task) => {
          const route = settings.modelRouting[task]
          const label = TASK_LABELS[task]
          // While a price is pending, the select shows the model waiting on
          // it, not the route still saved.
          const waiting = pending?.task === task ? pending : null
          const provider = waiting?.provider ?? route.provider
          const model = waiting?.model ?? route.model
          const providerOptions = options.llm[provider]
          const selected = providerOptions.find((o) => o.id === model)
          const regular = providerOptions.filter((o) => !o.preview)
          const previews = providerOptions.filter((o) => o.preview)

          return (
            <div key={task} className="flex flex-col gap-2">
              <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
                <Label htmlFor={`route-${task}-provider`}>{label}</Label>

                <Select
                  id={`route-${task}-provider`}
                  aria-label={`${label} provider`}
                  value={provider}
                  disabled={saving}
                  onChange={(event) => {
                    const next = event.target.value as LlmProvider
                    // Switching provider starts at its first model that can
                    // run as it stands: the old id means nothing to the new
                    // provider, and an unpriced one would only open a form.
                    const first = options.llm[next].find(
                      (o) => o.selectable && o.status !== 'needs-price',
                    )
                    if (first) choose(task, next, first.id)
                  }}
                  className="sm:w-40"
                >
                  {LLM_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>

                <Select
                  aria-label={`${label} model`}
                  value={model}
                  disabled={saving}
                  onChange={(event) => choose(task, provider, event.target.value)}
                  className="sm:w-56"
                >
                  {regular.map(renderOption)}
                  {previews.length > 0 ? (
                    <optgroup label={PREVIEW_GROUP}>{previews.map(renderOption)}</optgroup>
                  ) : null}
                  {/* A model no list holds is shown rather than silently
                      swapped, because it is what the run will actually be
                      refused on at pre-flight. */}
                  {selected ? null : <option value={model}>{model} (unlisted)</option>}
                </Select>
              </div>

              {!waiting && selected?.status === 'estimated' && selected.price ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12px] text-[var(--color-text-muted)]">
                    Estimated at {selected.pricedAs}&apos;s price: {describePrice(selected.price)}.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => setEditing(task)}
                  >
                    Set price
                  </Button>
                </div>
              ) : null}

              {!waiting && selected?.status === 'override' && selected.price ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12px] text-[var(--color-text-muted)]">
                    Your price: {describePrice(selected.price)}.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => setEditing(task)}
                  >
                    Edit price
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => clearPrice(task, provider, model)}
                  >
                    Clear price
                  </Button>
                </div>
              ) : null}

              {!waiting && selected?.status === 'retired' ? (
                <p className="text-[12px] text-[var(--color-warning)]">
                  {PROVIDER_NAMES[provider]} no longer lists this model. Runs still try it, and fall
                  back if it is refused.
                </p>
              ) : null}

              {!waiting &&
              editing === task &&
              selected &&
              (selected.status === 'estimated' || selected.status === 'override') ? (
                <LlmPriceForm
                  key={`${provider}:${model}`}
                  title={`Your price for ${selected.label}.`}
                  initial={selected.price}
                  saveLabel="Save price"
                  onSave={(price) => savePrice(task, provider, model, price, false)}
                  onCancel={() => setEditing(null)}
                />
              ) : null}

              {waiting ? (
                <LlmPriceForm
                  key={`${provider}:${model}`}
                  title={`${selected?.label ?? model} needs a price before it can run.`}
                  initial={selected?.price ?? null}
                  saveLabel="Save price and use"
                  onSave={(price) => savePrice(task, provider, model, price, true)}
                  onCancel={() => setPending(null)}
                />
              ) : null}

              {refusal?.task === task ? (
                <p className="text-[12px] text-[var(--color-danger)]">{refusal.message}</p>
              ) : null}
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

        {/* Stills that show a photographed cast member may go somewhere else
            (decision 253, amended): holding a real face and inventing an
            empty boardroom are different jobs at different prices. Off by
            default, and the row above generates everything until it is on. */}
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Label htmlFor="route-likeness-provider">Stills showing the cast</Label>

          <Select
            id="route-likeness-provider"
            aria-label="Stills showing the cast provider"
            value={likeness?.provider ?? 'same'}
            disabled={saving}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'same') {
                setLikenessRoute(null)
                return
              }
              const provider = value as StillProvider
              setLikenessRoute({
                provider,
                model: LIVE_IMAGE_GEN_ADAPTERS[provider].models[0]!.id,
              })
            }}
            className="sm:w-40"
          >
            <option value="same">same as above</option>
            {STILL_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Stills showing the cast model"
            value={likeness?.model ?? ''}
            disabled={saving || !likeness}
            onChange={(event) =>
              likeness &&
              setLikenessRoute({ provider: likeness.provider, model: event.target.value })
            }
            className="sm:w-48"
          >
            {likeness ? null : <option value="">—</option>}
            {likenessModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} (${model.pricePerImage.toFixed(2)}/image)
              </option>
            ))}
            {!likeness || likenessModels.some((model) => model.id === likeness.model) ? null : (
              <option value={likeness.model}>{likeness.model} (unlisted)</option>
            )}
          </Select>
        </div>
        <p className="text-[12px] text-[var(--color-text-muted)]">
          A still counts as showing the cast when it depicts someone the Cast card holds a
          photograph of. Their photos go to this generator; every other still goes to the row above.
          Leave it on &quot;same as above&quot; to generate everything one way.
        </p>

        {/* The set-sheet generator (decision 275): Google models only, because
            the four-view contact sheet and its 4K output are Gemini features,
            and only those that make a 4K image (the Gemini 3 models): a sheet
            is cut into four plates. A stored choice outside that stays listed
            so the select never shows a model it is not using. */}
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto]">
          <Label htmlFor="route-set-sheet-model">Set sheets (Build the set)</Label>
          <Select
            id="route-set-sheet-model"
            aria-label="Set sheets model"
            value={settings.modelRouting.setSheet.model}
            disabled={saving}
            onChange={(event) => {
              const route = { provider: 'google' as const, model: event.target.value }
              const next = structuredClone(settings)
              next.modelRouting.setSheet = route
              void commit({ modelRouting: { setSheet: route } }, next)
            }}
            className="sm:w-48"
          >
            {LIVE_IMAGE_GEN_ADAPTERS.google.models
              .filter(
                (model) =>
                  model.pricesBySize?.['4K'] !== undefined ||
                  model.id === settings.modelRouting.setSheet.model,
              )
              .map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
