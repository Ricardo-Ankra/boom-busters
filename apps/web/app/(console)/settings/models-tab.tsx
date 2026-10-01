'use client'

import {
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
 * Settings → Models (decision 287). Every row, LLM and image alike, offers
 * its provider's live list merged with the catalogue, every option labelled
 * with how it is priced, and an inline price form for the models the
 * catalogue cannot price.
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

/** The image routes, which are priced per image rather than per token. */
const IMAGE_ROUTES = ['stills', 'stillsLikeness', 'setSheet'] as const
type ImageRoute = (typeof IMAGE_ROUTES)[number]
type RouteKey = LlmTask | ImageRoute
type PriceKind = 'llm' | 'image'
type AnyProvider = LlmProvider | StillProvider

const ROUTE_LABELS: Record<RouteKey, string> = {
  ...TASK_LABELS,
  stills: 'Still images (visuals)',
  stillsLikeness: 'Stills showing the cast',
  setSheet: 'Set sheets (Build the set)',
}

const kindOf = (key: RouteKey): PriceKind =>
  (IMAGE_ROUTES as readonly RouteKey[]).includes(key) ? 'image' : 'llm'

type LlmPrice = ModelPrices['llm'][string]
type ImagePrice = ModelPrices['image'][string]
/** A price to store, tagged with the table it belongs in. */
type PriceEntry = { kind: 'llm'; price: LlmPrice } | { kind: 'image'; price: ImagePrice }

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

/** The statuses whose price the owner can set from the row. */
const PRICEABLE: ReadonlySet<ModelOption['status']> = new Set([
  'estimated',
  'override',
  'needs-price',
])

const PREVIEW_GROUP = 'Preview: Google can withdraw these without notice'

const IMAGE_SIZES = ['1K', '2K', '4K'] as const

const money = (value: number) => `$${Number(value.toFixed(4))}`

/** "$0.07/image", "$0.10/image", "$0.035/image": cents always shown, no more than four places. */
const perImage = (value: number) => {
  const exact = String(Number(value.toFixed(4)))
  const places = exact.split('.')[1]?.length ?? 0
  return `$${places > 2 ? exact : value.toFixed(2)}/image`
}

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

/** A copy of one price table with `key` set to `value`, or removed when it is null. */
function withEntry<T>(table: Record<string, T>, key: string, value: T | null): Record<string, T> {
  const copy = { ...table }
  if (value) copy[key] = value
  else delete copy[key]
  return copy
}

/** The routing patch that points `key` at a model; set sheets are Google's alone. */
function routePatch(
  key: RouteKey,
  provider: AnyProvider,
  model: string,
): NonNullable<SettingsPatch['modelRouting']> {
  switch (key) {
    case 'setSheet':
      return { setSheet: { provider: 'google', model } }
    case 'stills':
      return { stills: { provider: provider as StillProvider, model } }
    case 'stillsLikeness':
      return { stillsLikeness: { provider: provider as StillProvider, model } }
    default:
      return { [key]: { provider: provider as LlmProvider, model } }
  }
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

function FormButtons({ saveLabel, onCancel }: { saveLabel: string; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <Button type="submit" variant="primary">
        {saveLabel}
      </Button>
      <Button type="button" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
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
  onSave: (price: LlmPrice) => void
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
      <FormButtons saveLabel={saveLabel} onCancel={onCancel} />
    </form>
  )
}

/**
 * A price per image, and for a Google model its optional price at each
 * output size: Gemini bills a 4K image more than a 1K one. Set sheets are
 * always made at 4K, and a missing size is charged at the price per image,
 * so the set-sheet row requires the 4K price: without it every sheet would
 * reserve about half what it costs.
 */
function ImagePriceForm({
  title,
  initial,
  sizes,
  require4K,
  saveLabel,
  onSave,
  onCancel,
}: {
  title: string
  initial: OptionPrice | null
  sizes: boolean
  require4K: boolean
  saveLabel: string
  onSave: (price: ImagePrice) => void
  onCancel: () => void
}) {
  const seed = initial?.kind === 'image' ? initial : null
  const [perImage, setPerImage] = React.useState(seed ? String(seed.pricePerImage) : '')
  const [bySize, setBySize] = React.useState<Record<(typeof IMAGE_SIZES)[number], string>>(() => ({
    '1K': seed?.pricesBySize?.['1K'] ? String(seed.pricesBySize['1K']) : '',
    '2K': seed?.pricesBySize?.['2K'] ? String(seed.pricesBySize['2K']) : '',
    '4K': seed?.pricesBySize?.['4K'] ? String(seed.pricesBySize['4K']) : '',
  }))
  const [error, setError] = React.useState<string | null>(null)
  const id = React.useId()

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const pricePerImage = parsePrice(perImage)
        const pricesBySize: NonNullable<ImagePrice['pricesBySize']> = {}
        let valid = pricePerImage !== null
        if (sizes) {
          for (const size of IMAGE_SIZES) {
            const required = require4K && size === '4K'
            if (bySize[size].trim() === '') {
              if (required) valid = false
              continue
            }
            const value = parsePrice(bySize[size])
            if (value === null) valid = false
            else pricesBySize[size] = value
          }
        }
        if (!valid || pricePerImage === null) {
          setError(PRICE_ERROR)
          return
        }
        onSave({
          pricePerImage,
          ...(Object.keys(pricesBySize).length > 0 ? { pricesBySize } : {}),
        })
      }}
    >
      <p className="text-[13px]">{title}</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-each`}>Price per image ($)</Label>
          <Input
            id={`${id}-each`}
            inputMode="decimal"
            value={perImage}
            onChange={(event) => setPerImage(event.target.value)}
          />
        </div>
        {sizes
          ? IMAGE_SIZES.map((size) => (
              <div key={size} className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-${size}`}>
                  {require4K && size === '4K'
                    ? `${size} price per image ($)`
                    : `${size} price per image ($, optional)`}
                </Label>
                <Input
                  id={`${id}-${size}`}
                  inputMode="decimal"
                  value={bySize[size]}
                  onChange={(event) =>
                    setBySize((current) => ({ ...current, [size]: event.target.value }))
                  }
                />
              </div>
            ))
          : null}
      </div>
      {error ? <p className="text-[12px] text-[var(--color-danger)]">{error}</p> : null}
      <FormButtons saveLabel={saveLabel} onCancel={onCancel} />
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
    key: RouteKey
    provider: AnyProvider
    model: string
  } | null>(null)
  /** Which route's price form is open, for Set price and Edit price. */
  const [editing, setEditing] = React.useState<RouteKey | null>(null)
  const [refusal, setRefusal] = React.useState<{ key: RouteKey; message: string } | null>(null)

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

  const optionsFor = (kind: PriceKind, provider: AnyProvider): ModelOption[] =>
    (kind === 'llm'
      ? options.llm[provider as LlmProvider]
      : options.image[provider as StillProvider]) ?? []

  const withPrice = (key: string, entry: PriceEntry | { kind: PriceKind; price: null }) => {
    const prices = settings.modelPrices
    return entry.kind === 'llm'
      ? { ...prices, llm: withEntry(prices.llm, key, entry.price) }
      : { ...prices, image: withEntry(prices.image, key, entry.price) }
  }

  const setRoute = (key: RouteKey, provider: AnyProvider, model: string) => {
    const modelRouting = routePatch(key, provider, model)
    const next = structuredClone(settings)
    Object.assign(next.modelRouting, modelRouting)
    void commit({ modelRouting }, next)
  }

  const choose = (key: RouteKey, provider: AnyProvider, model: string) => {
    setRefusal(null)
    setEditing(null)
    const option = optionsFor(kindOf(key), provider).find((o) => o.id === model)
    // An unpriced model is never routed on its own: a run on it would be
    // refused at pre-flight, so the route and its price are saved together.
    if (option?.status === 'needs-price') {
      setPending({ key, provider, model })
      return
    }
    setPending(null)
    setRoute(key, provider, model)
  }

  const savePrice = (
    key: RouteKey,
    provider: AnyProvider,
    model: string,
    entry: PriceEntry,
    alsoRoute: boolean,
  ) => {
    const modelPrices = withPrice(modelPriceKey(provider, model), entry)
    const modelRouting = alsoRoute ? routePatch(key, provider, model) : null
    const next = structuredClone(settings)
    next.modelPrices = modelPrices
    if (modelRouting) Object.assign(next.modelRouting, modelRouting)
    void commit(modelRouting ? { modelRouting, modelPrices } : { modelPrices }, next)
    setPending(null)
    setEditing(null)
  }

  const clearPrice = (key: RouteKey, provider: AnyProvider, model: string) => {
    const kind = kindOf(key)
    const option = optionsFor(kind, provider).find((o) => o.id === model)
    // A model with nothing to fall back to (no catalogue row, no family, no
    // published fal price) is unpriced without the override, so clearing it
    // under a route would leave a route every run refuses.
    const users = (kind === 'llm' ? LLM_TASKS : IMAGE_ROUTES).filter((k) => {
      const route = settings.modelRouting[k]
      return route?.provider === provider && route.model === model
    })
    if (option?.fallsBackTo === null && users.length > 0) {
      setRefusal({
        key,
        message: `${ROUTE_LABELS[users[0]!]} uses this model. Pick another model first.`,
      })
      return
    }
    setRefusal(null)
    setEditing(null)
    const next = structuredClone(settings)
    next.modelPrices = withPrice(modelPriceKey(provider, model), { kind, price: null })
    void commit({ modelPrices: next.modelPrices }, next)
  }

  /** Turns the likeness split off: one route generates every still again. */
  const sameAsAbove = () => {
    setPending(null)
    setEditing(null)
    setRefusal(null)
    const next = structuredClone(settings)
    next.modelRouting.stillsLikeness = null
    void commit({ modelRouting: { stillsLikeness: null } }, next)
  }

  /**
   * The route a row shows: while a price is pending, the model waiting on
   * it, not the route still saved. A pending route only ever holds a
   * provider of its own row's kind, which is what the casts below rely on.
   */
  const waitingFor = (key: RouteKey) => (pending?.key === key ? pending : null)

  // An image option carries its price per image, as the still rows always
  // have; an LLM's two token prices are too long for an option.
  const optionLabel = (option: ModelOption) =>
    `${option.label}${option.price?.kind === 'image' ? ` (${perImage(option.price.pricePerImage)})` : ''}${SUFFIX[option.status]}`
  const renderOption = (option: ModelOption) => (
    <option key={option.id} value={option.id} disabled={!option.selectable}>
      {optionLabel(option)}
    </option>
  )

  /** A model select's options: regular, then previews grouped, then the model if no list holds it. */
  const renderChoices = (list: ModelOption[], model: string) => {
    const previews = list.filter((o) => o.preview)
    return (
      <>
        {list.filter((o) => !o.preview).map(renderOption)}
        {previews.length > 0 ? (
          <optgroup label={PREVIEW_GROUP}>{previews.map(renderOption)}</optgroup>
        ) : null}
        {/* A model no list holds is shown rather than silently swapped,
            because it is what the run will actually be refused on at
            pre-flight. */}
        {list.some((o) => o.id === model) ? null : (
          <option value={model}>{model} (unlisted)</option>
        )}
      </>
    )
  }

  /**
   * The lines under a row: why any listed option cannot be picked, how its
   * model is priced, and the price forms. A disabled option can never be
   * selected, so its reason has to sit here rather than follow a choice.
   */
  const renderNotes = (
    key: RouteKey,
    list: ModelOption[],
    provider: AnyProvider,
    model: string,
    selected: ModelOption | undefined,
    waiting: boolean,
  ) => {
    const priceForm = (
      title: string,
      initial: OptionPrice | null,
      saveLabel: string,
      alsoRoute: boolean,
      onCancel: () => void,
    ) =>
      kindOf(key) === 'llm' ? (
        <LlmPriceForm
          key={`${provider}:${model}`}
          title={title}
          initial={initial}
          saveLabel={saveLabel}
          onSave={(price) => savePrice(key, provider, model, { kind: 'llm', price }, alsoRoute)}
          onCancel={onCancel}
        />
      ) : (
        <ImagePriceForm
          key={`${provider}:${model}`}
          title={title}
          initial={initial}
          sizes={provider === 'google'}
          require4K={key === 'setSheet'}
          saveLabel={saveLabel}
          onSave={(price) => savePrice(key, provider, model, { kind: 'image', price }, alsoRoute)}
          onCancel={onCancel}
        />
      )

    return (
      <>
        {list
          .filter((o) => o.status === 'incompatible' && o.reason)
          .map((o) => (
            <p key={o.id} className="text-[12px] text-[var(--color-text-muted)]">
              {o.label} is not offered: {o.reason}
            </p>
          ))}

        {!waiting && selected?.status === 'estimated' && selected.price ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Estimated at {selected.pricedAs}&apos;s price: {describePrice(selected.price)}.
            </p>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setEditing(key)}>
              Set price
            </Button>
          </div>
        ) : null}

        {!waiting && selected?.status === 'override' && selected.price ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Your price: {describePrice(selected.price)}.
            </p>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setEditing(key)}>
              Edit price
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => clearPrice(key, provider, model)}
            >
              Clear price
            </Button>
          </div>
        ) : null}

        {/* A route saved on an unpriced model (saved before its price was
            cleared, or stored by hand) is refused by every run, and
            re-picking the same option fires no change: so the fix sits here,
            beside the row. The route is already saved, so this saves the
            price alone. */}
        {!waiting && selected?.status === 'needs-price' ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12px] text-[var(--color-danger)]">
              {selected.label} needs a price before it can run.
            </p>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setEditing(key)}>
              Set price
            </Button>
          </div>
        ) : null}

        {!waiting && selected?.status === 'retired' ? (
          <p className="text-[12px] text-[var(--color-warning)]">
            {PROVIDER_NAMES[provider]} no longer lists this model. Runs still try it, and fall back
            if it is refused.
          </p>
        ) : null}

        {!waiting && editing === key && selected && PRICEABLE.has(selected.status)
          ? priceForm(
              `Your price for ${selected.label}.`,
              selected.price,
              'Save price',
              false,
              () => setEditing(null),
            )
          : null}

        {waiting
          ? priceForm(
              `${selected?.label ?? model} needs a price before it can run.`,
              selected?.price ?? null,
              'Save price and use',
              true,
              () => setPending(null),
            )
          : null}

        {refusal?.key === key ? (
          <p className="text-[12px] text-[var(--color-danger)]">{refusal.message}</p>
        ) : null}
      </>
    )
  }

  /** Switching provider starts at its first model that can run as it stands. */
  const firstRunnable = (list: ModelOption[]) =>
    list.find((o) => o.selectable && o.status !== 'needs-price')

  const stillsWaiting = waitingFor('stills')
  const stills = {
    provider:
      (stillsWaiting?.provider as StillProvider | undefined) ??
      settings.modelRouting.stills.provider,
    model: stillsWaiting?.model ?? settings.modelRouting.stills.model,
  }
  const stillOptions = options.image[stills.provider]
  const stillSelected = stillOptions.find((o) => o.id === stills.model)

  // Off (null) until a provider is picked, and its model select stays empty:
  // the row above generates everything until then.
  const likenessWaiting = waitingFor('stillsLikeness')
  const likeness = likenessWaiting
    ? { provider: likenessWaiting.provider as StillProvider, model: likenessWaiting.model }
    : settings.modelRouting.stillsLikeness
  const likenessOptions = likeness ? options.image[likeness.provider] : []
  const likenessSelected = likenessOptions.find((o) => o.id === likeness?.model)

  const sheetWaiting = waitingFor('setSheet')
  const sheetModel = sheetWaiting?.model ?? settings.modelRouting.setSheet.model
  // Only models that make a 4K image: a sheet is cut into four plates. The
  // stored choice stays listed so the select never shows a model it is not
  // using.
  const sheetOptions = options.image.google.filter(
    (o) =>
      (o.price?.kind === 'image' && o.price.pricesBySize?.['4K'] !== undefined) ||
      o.id === sheetModel,
  )
  const sheetSelected = sheetOptions.find((o) => o.id === sheetModel)

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
        {/* The times below are local: the server renders them in UTC and the
            browser in the owner's zone, so their text is expected to differ
            on hydration (the calendar-week.tsx convention). */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-[var(--color-text-muted)]" suppressHydrationWarning>
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
            <li key={provider} suppressHydrationWarning>
              {statusLine(provider, options)}
            </li>
          ))}
        </ul>

        {LLM_TASKS.map((task) => {
          const route = settings.modelRouting[task]
          const label = TASK_LABELS[task]
          const waiting = waitingFor(task)
          const row = {
            provider: (waiting?.provider as LlmProvider | undefined) ?? route.provider,
            model: waiting?.model ?? route.model,
          }
          const providerOptions = options.llm[row.provider]
          const selected = providerOptions.find((o) => o.id === row.model)

          return (
            <div key={task} className="flex flex-col gap-2">
              <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
                <Label htmlFor={`route-${task}-provider`}>{label}</Label>

                <Select
                  id={`route-${task}-provider`}
                  aria-label={`${label} provider`}
                  value={row.provider}
                  disabled={saving}
                  onChange={(event) => {
                    const next = event.target.value as LlmProvider
                    // The old id means nothing to the new provider, and an
                    // unpriced one would only open a form.
                    const first = firstRunnable(options.llm[next])
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
                  value={row.model}
                  disabled={saving}
                  onChange={(event) => choose(task, row.provider, event.target.value)}
                  className="sm:w-56"
                >
                  {renderChoices(providerOptions, row.model)}
                </Select>
              </div>

              {renderNotes(
                task,
                providerOptions,
                row.provider,
                row.model,
                selected,
                waiting !== null,
              )}
            </div>
          )
        })}

        {/* The still-image generator (decision 208): not an LLM task, but
            routed where the human looks for every other model decision. */}
        <div className="flex flex-col gap-2">
          <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Label htmlFor="route-stills-provider">{ROUTE_LABELS.stills}</Label>

            <Select
              id="route-stills-provider"
              aria-label="Still images provider"
              value={stills.provider}
              disabled={saving}
              onChange={(event) => {
                const provider = event.target.value as StillProvider
                const first = firstRunnable(options.image[provider])
                if (first) choose('stills', provider, first.id)
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
              onChange={(event) => choose('stills', stills.provider, event.target.value)}
              className="sm:w-56"
            >
              {renderChoices(stillOptions, stills.model)}
            </Select>
          </div>

          {renderNotes(
            'stills',
            stillOptions,
            stills.provider,
            stills.model,
            stillSelected,
            stillsWaiting !== null,
          )}
        </div>

        {/* Stills that show a photographed cast member may go somewhere else
            (decision 253, amended): holding a real face and inventing an
            empty boardroom are different jobs at different prices. Off by
            default, and the row above generates everything until it is on. */}
        <div className="flex flex-col gap-2">
          <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Label htmlFor="route-likeness-provider">{ROUTE_LABELS.stillsLikeness}</Label>

            <Select
              id="route-likeness-provider"
              aria-label="Stills showing the cast provider"
              value={likeness?.provider ?? 'same'}
              disabled={saving}
              onChange={(event) => {
                const value = event.target.value
                if (value === 'same') {
                  sameAsAbove()
                  return
                }
                const provider = value as StillProvider
                const first = firstRunnable(options.image[provider])
                if (first) choose('stillsLikeness', provider, first.id)
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
                likeness && choose('stillsLikeness', likeness.provider, event.target.value)
              }
              className="sm:w-56"
            >
              {likeness ? (
                renderChoices(likenessOptions, likeness.model)
              ) : (
                <option value="">—</option>
              )}
            </Select>
          </div>

          {likeness
            ? renderNotes(
                'stillsLikeness',
                likenessOptions,
                likeness.provider,
                likeness.model,
                likenessSelected,
                likenessWaiting !== null,
              )
            : null}
        </div>
        <p className="text-[12px] text-[var(--color-text-muted)]">
          A still counts as showing the cast when it depicts someone the Cast card holds a
          photograph of. Their photos go to this generator; every other still goes to the row above.
          Leave it on &quot;same as above&quot; to generate everything one way.
        </p>

        {/* The set-sheet generator (decision 275): Google models only,
            because the four-view contact sheet and its 4K output are Gemini
            features. */}
        <div className="flex flex-col gap-2">
          <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto]">
            <Label htmlFor="route-set-sheet-model">{ROUTE_LABELS.setSheet}</Label>
            <Select
              id="route-set-sheet-model"
              aria-label="Set sheets model"
              value={sheetModel}
              disabled={saving}
              onChange={(event) => choose('setSheet', 'google', event.target.value)}
              className="sm:w-56"
            >
              {renderChoices(sheetOptions, sheetModel)}
            </Select>
          </div>

          {renderNotes(
            'setSheet',
            sheetOptions,
            'google',
            sheetModel,
            sheetSelected,
            sheetWaiting !== null,
          )}
        </div>
      </CardContent>
    </Card>
  )
}
