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
  type LlmProvider,
  type LlmTask,
  type Settings,
  type SettingsPatch,
  type StillProvider,
} from '@boom-busters/schemas'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { refreshModelListsAction } from './model-actions'

/**
 * Settings → Models (decision 288). Every row, LLM and image alike, offers
 * its provider's live list merged with the catalogue, every option labelled
 * with how it is priced. Prices are the workspace's, one table for every
 * channel, so they are read here and set on the workspace Prices tab; a model
 * with no price cannot be routed until it has one.
 */

const TASK_LABELS: Record<LlmTask, string> = {
  research: 'Research (dossiers)',
  scripting: 'Script drafting',
  editing: 'Editing and self-checks',
  shotlist: 'Shot lists',
  metadata: 'Titles and descriptions',
  digest: 'Weekly digest',
  direction: 'Visual direction',
  graphics: 'Motion graphics',
}

/** The image routes, which are priced per image rather than per token. */
type ImageRoute = 'stills' | 'stillsLikeness' | 'setSheet'
type RouteKey = LlmTask | ImageRoute
type AnyProvider = LlmProvider | StillProvider

const ROUTE_LABELS: Record<RouteKey, string> = {
  ...TASK_LABELS,
  stills: 'Still images (visuals)',
  stillsLikeness: 'Stills showing the cast',
  setSheet: 'Set sheets (Build the set)',
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

/** The routing patch that points `key` at a model. */
function routePatch(
  key: RouteKey,
  provider: AnyProvider,
  model: string,
): NonNullable<SettingsPatch['modelRouting']> {
  switch (key) {
    case 'setSheet':
      return { setSheet: { provider: provider as StillProvider, model } }
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

/** Prices are the workspace's: a link to the tab that sets them. */
function PricesLink({ children }: { children: React.ReactNode }) {
  return (
    <Button asChild variant="ghost">
      <Link href="/settings?tab=prices">{children}</Link>
    </Button>
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

  const choose = (key: RouteKey, provider: AnyProvider, model: string) => {
    const modelRouting = routePatch(key, provider, model)
    const next = structuredClone(settings)
    Object.assign(next.modelRouting, modelRouting)
    void commit({ modelRouting }, next)
  }

  /** Turns the likeness split off: one route generates every still again. */
  const sameAsAbove = () => {
    const next = structuredClone(settings)
    next.modelRouting.stillsLikeness = null
    void commit({ modelRouting: { stillsLikeness: null } }, next)
  }

  // An image option carries its price per image, as the still rows always
  // have; an LLM's two token prices are too long for an option.
  const optionLabel = (option: ModelOption) =>
    `${option.label}${option.price?.kind === 'image' ? ` (${perImage(option.price.pricePerImage)})` : ''}${SUFFIX[option.status]}`
  const renderOption = (option: ModelOption) => (
    <option
      key={option.id}
      value={option.id}
      disabled={!option.selectable || option.status === 'needs-price'}
    >
      {optionLabel(option)}
    </option>
  )

  /** A model select's options: regular, then previews grouped, then the model if no list holds it. */
  const renderChoices = (all: ModelOption[], model: string) => {
    // A model kept only because some route still holds it shows in that
    // route's row alone.
    const list = all.filter((o) => !o.routedOnly || o.id === model)
    const previews = list.filter((o) => o.preview)
    return (
      <>
        {list.filter((o) => !o.preview).map(renderOption)}
        {previews.length > 0 ? (
          <optgroup label={PREVIEW_GROUP}>{previews.map(renderOption)}</optgroup>
        ) : null}
        {/* The options already carry every saved route, labelled (decision
            288 follow-up); this stays as a last guard so the select can never
            silently show a different model from the one the route holds. */}
        {list.some((o) => o.id === model) ? null : (
          <option value={model}>{model} (unlisted)</option>
        )}
      </>
    )
  }

  /**
   * The lines under a row: why any listed option cannot be picked, how its
   * model is priced, and where to set a price. A disabled option can never be
   * selected, so its reason has to sit here rather than follow a choice.
   */
  const renderNotes = (list: ModelOption[], model: string, selected: ModelOption | undefined) => {
    // fal's active text-to-image list is long, so many incompatible
    // endpoints are summed up in one line with their names folded away,
    // rather than one line each under every fal row. A model kept only
    // because a route holds it counts in that route's row alone, and the
    // row's own model, when it is the incompatible one, gets its own line:
    // its reason may not be the one the summary gives.
    const ownIncompatible = selected?.status === 'incompatible' && selected.reason ? selected : null
    const incompatible = list.filter(
      (o) =>
        o.status === 'incompatible' &&
        o.reason &&
        o !== ownIncompatible &&
        (!o.routedOnly || o.id === model),
    )
    const ownNote = ownIncompatible ? (
      <p className="text-[12px] text-[var(--color-warning)]">
        {ownIncompatible.label} is not offered: {ownIncompatible.reason}
      </p>
    ) : null
    const incompatibleNote =
      incompatible.length === 1 ? (
        <p className="text-[12px] text-[var(--color-text-muted)]">
          {incompatible[0]!.label} is not offered: {incompatible[0]!.reason}
        </p>
      ) : incompatible.length > 1 ? (
        <div className="text-[12px] text-[var(--color-text-muted)]">
          <p>
            {incompatible.length} fal.ai endpoints are listed but not compatible: they make one
            image per request, or take an input this app cannot send.
          </p>
          <details>
            <summary className="cursor-pointer">Show them</summary>
            <ul className="mt-1 list-disc pl-5">
              {incompatible.map((o) => (
                <li key={o.id}>{o.label}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : null

    return (
      <>
        {ownNote}
        {incompatibleNote}

        {selected?.status === 'estimated' && selected.price ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Estimated at {selected.pricedAs}&apos;s price: {describePrice(selected.price)}.{' '}
            <PricesLink>Set a price</PricesLink>
          </p>
        ) : null}

        {selected?.status === 'override' && selected.price ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Your price: {describePrice(selected.price)}. <PricesLink>Change prices</PricesLink>
          </p>
        ) : null}

        {/* A route saved on an unpriced model (saved before its price was
            cleared, or stored by hand) is refused by every run. Prices are
            the workspace's, so the fix is there. */}
        {selected?.status === 'needs-price' ? (
          <p className="text-[12px] text-[var(--color-danger)]">
            {selected.label} needs a price before it can run. <PricesLink>Set its price</PricesLink>
          </p>
        ) : null}

        {selected?.status === 'retired' ? (
          <p className="text-[12px] text-[var(--color-warning)]">
            {selected.label} is no longer listed by its provider. Runs still try it, and fall back
            if it is refused.
          </p>
        ) : null}
      </>
    )
  }

  /** Switching provider starts at its first model that can run as it stands. */
  const firstRunnable = (list: ModelOption[]) =>
    list.find((o) => o.selectable && o.status !== 'needs-price')

  const stills = settings.modelRouting.stills
  const stillOptions = options.image[stills.provider]
  const stillSelected = stillOptions.find((o) => o.id === stills.model)

  // Off (null) until a provider is picked, and its model select stays empty:
  // the row above generates everything until then.
  const likeness = settings.modelRouting.stillsLikeness
  const likenessOptions = likeness ? options.image[likeness.provider] : []
  const likenessSelected = likenessOptions.find((o) => o.id === likeness?.model)

  const sheet = settings.modelRouting.setSheet
  // Google: only models that make a 4K image, since a sheet is cut into four
  // plates; the stored choice stays listed so the select never shows a model
  // it is not using. fal (decision 297): every model, because the plate rides
  // as a reference and the adapter hands it to that model's reference
  // endpoint, which prices per image and draws as large as fal allows.
  const sheetOptions =
    sheet.provider === 'google'
      ? options.image.google.filter(
          (o) =>
            (o.price?.kind === 'image' && o.price.pricesBySize?.['4K'] !== undefined) ||
            o.id === sheet.model,
        )
      : options.image[sheet.provider]
  const sheetSelected = sheetOptions.find((o) => o.id === sheet.model)

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
          const row = route
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

              {renderNotes(providerOptions, row.model, selected)}
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

          {renderNotes(stillOptions, stills.model, stillSelected)}
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

          {likeness ? renderNotes(likenessOptions, likeness.model, likenessSelected) : null}
        </div>
        <p className="text-[12px] text-[var(--color-text-muted)]">
          A still counts as showing the cast when it depicts someone the Cast card holds a
          photograph of. Their photos go to this generator; every other still goes to the row above.
          Leave it on &quot;same as above&quot; to generate everything one way.
        </p>

        {/* The set-sheet generator (decision 275), on either still provider
            (decision 297): Gemini draws the four-view sheet at 4K; fal draws it
            on the routed model's reference endpoint at the largest frame it
            allows. */}
        <div className="flex flex-col gap-2">
          <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Label htmlFor="route-set-sheet-provider">{ROUTE_LABELS.setSheet}</Label>

            <Select
              id="route-set-sheet-provider"
              aria-label="Set sheets provider"
              value={sheet.provider}
              disabled={saving}
              onChange={(event) => {
                const provider = event.target.value as StillProvider
                const first = firstRunnable(options.image[provider])
                if (first) choose('setSheet', provider, first.id)
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
              aria-label="Set sheets model"
              value={sheet.model}
              disabled={saving}
              onChange={(event) => choose('setSheet', sheet.provider, event.target.value)}
              className="sm:w-56"
            >
              {renderChoices(sheetOptions, sheet.model)}
            </Select>
          </div>

          {renderNotes(sheetOptions, sheet.model, sheetSelected)}

          {sheet.provider === 'fal' ? (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              On fal the plate goes to the model&apos;s reference endpoint (FLUX.2 edit for FLUX.2,
              Kontext for the rest) and the sheet comes back 2,048 pixels wide, so each plate comes
              out about 1,000 pixels wide, about 700 on Kontext. Gemini&apos;s 4K sheet gives plates
              near 1,600.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
