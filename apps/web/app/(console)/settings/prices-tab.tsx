'use client'

import {
  isStale,
  type ModelOption,
  type ModelOptions,
  type OptionPrice,
} from '@boom-busters/providers'
import {
  LLM_PROVIDERS,
  STILL_PROVIDERS,
  modelPriceKey,
  type LlmProvider,
  type ModelPrices,
  type StillProvider,
} from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { refreshModelListsAction } from '@/app/(console)/c/[slug]/settings/model-actions'
import { ImagePriceForm, LlmPriceForm, type ImagePrice, type LlmPrice } from './price-forms'

/**
 * Settings → Prices (decision 288, moved to the workspace). One price table
 * for every channel: a price entered once applies wherever a channel routes
 * to that model. The Models tab on each channel only reads it.
 *
 * Each row is a model the catalogue cannot price exactly: one that needs a
 * price before it can run, one running on its family's estimate, or one
 * carrying the owner's own price.
 */

type Kind = 'llm' | 'image'

interface Row {
  kind: Kind
  provider: LlmProvider | StillProvider
  option: ModelOption
}

const PROVIDER_NAMES = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  fal: 'fal.ai',
} as const

const money = (value: number) => `$${Number(value.toFixed(4))}`

function describePrice(price: OptionPrice): string {
  return price.kind === 'llm'
    ? `${money(price.inputPerMTok)} in, ${money(price.outputPerMTok)} out per million tokens`
    : `${money(price.pricePerImage)} per image`
}

const STATUS_TEXT: Partial<Record<ModelOption['status'], string>> = {
  'needs-price': 'Needs a price before it can run',
  estimated: 'Estimated',
  override: 'Your price',
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-ZA') : 'an unknown time'

/** A copy of one price table with `key` set to `value`, or removed when it is null. */
function withEntry<T>(table: Record<string, T>, key: string, value: T | null): Record<string, T> {
  const copy = { ...table }
  if (value) copy[key] = value
  else delete copy[key]
  return copy
}

export function PricesTab({
  prices,
  options,
  routedKeys,
  saving,
  commit,
}: {
  prices: ModelPrices
  options: ModelOptions
  /** `provider:model` for every model some channel routes to. */
  routedKeys: string[]
  saving: boolean
  commit: (patch: { modelPrices: ModelPrices }, optimistic: ModelPrices) => Promise<void>
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [refreshing, setRefreshing] = React.useState(false)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [refusal, setRefusal] = React.useState<{ key: string; message: string } | null>(null)

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshModelListsAction()
      router.refresh()
    } catch (error) {
      toast({
        title: 'Could not refresh the model lists',
        description: error instanceof Error ? error.message : String(error),
        variant: 'error',
      })
    } finally {
      setRefreshing(false)
    }
  }, [router, toast])

  const autoRefreshed = React.useRef(false)
  React.useEffect(() => {
    if (autoRefreshed.current) return
    autoRefreshed.current = true
    if (options.canRefresh && isStale(options.lastAttemptAt, Date.now())) void refresh()
  }, [options.canRefresh, options.lastAttemptAt, refresh])

  const rows: Row[] = [
    ...LLM_PROVIDERS.flatMap((provider) =>
      (options.llm[provider] ?? []).map((option) => ({ kind: 'llm' as const, provider, option })),
    ),
    ...STILL_PROVIDERS.flatMap((provider) =>
      (options.image[provider] ?? []).map((option) => ({
        kind: 'image' as const,
        provider,
        option,
      })),
    ),
  ].filter((row) => STATUS_TEXT[row.option.status] !== undefined && !row.option.routedOnly)

  // Saved prices no list shows any more: still the owner's, so still clearable.
  const listed = new Set(
    [
      ...LLM_PROVIDERS.flatMap((p) => (options.llm[p] ?? []).map((o) => modelPriceKey(p, o.id))),
      ...STILL_PROVIDERS.flatMap((p) =>
        (options.image[p] ?? []).map((o) => modelPriceKey(p, o.id)),
      ),
    ].map((key) => key),
  )
  const orphans = [
    ...Object.keys(prices.llm).map((key) => ({ kind: 'llm' as const, key })),
    ...Object.keys(prices.image).map((key) => ({ kind: 'image' as const, key })),
  ].filter((entry) => !listed.has(entry.key))

  const save = (kind: Kind, key: string, price: LlmPrice | ImagePrice | null) => {
    const next: ModelPrices =
      kind === 'llm'
        ? { ...prices, llm: withEntry(prices.llm, key, price as LlmPrice | null) }
        : { ...prices, image: withEntry(prices.image, key, price as ImagePrice | null) }
    setEditing(null)
    setRefusal(null)
    void commit({ modelPrices: next }, next)
  }

  const clear = (row: Row) => {
    const key = modelPriceKey(row.provider, row.option.id)
    // A model with nothing to fall back to is unpriced without the override,
    // so clearing it under a route would leave a route every run refuses.
    if (row.option.fallsBackTo === null && routedKeys.includes(key)) {
      setRefusal({
        key,
        message: 'A channel routes to this model. Pick another model on that channel first.',
      })
      return
    }
    save(row.kind, key, null)
  }

  const form = (row: Row, key: string) =>
    row.kind === 'llm' ? (
      <LlmPriceForm
        key={key}
        title={`Your price for ${row.option.label}.`}
        initial={row.option.price}
        saveLabel="Save price"
        onSave={(price) => save('llm', key, price)}
        onCancel={() => setEditing(null)}
      />
    ) : (
      <ImagePriceForm
        key={key}
        title={`Your price for ${row.option.label}.`}
        initial={row.option.price}
        sizes={row.provider === 'google'}
        require4K={false}
        saveLabel="Save price"
        onSave={(price) => save('image', key, price)}
        onCancel={() => setEditing(null)}
      />
    )

  const renderRow = (row: Row) => {
    const key = modelPriceKey(row.provider, row.option.id)
    const status = row.option.status
    return (
      <li key={`${row.kind}:${key}`} className="flex flex-col gap-2 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-medium">
              {row.option.label}{' '}
              <span className="text-[12px] font-normal text-[var(--color-text-muted)]">
                {PROVIDER_NAMES[row.provider]}
              </span>
            </span>
            <span
              className={`text-[12px] ${
                status === 'needs-price'
                  ? 'text-[var(--color-danger)]'
                  : 'text-[var(--color-text-muted)]'
              }`}
            >
              {STATUS_TEXT[status]}
              {row.option.price ? `: ${describePrice(row.option.price)}` : ''}
              {status === 'estimated' && row.option.pricedAs
                ? ` (at ${row.option.pricedAs}'s price)`
                : ''}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setEditing(key)}
              aria-label={`${status === 'override' ? 'Edit price' : 'Set price'} for ${row.option.label}`}
            >
              {status === 'override' ? 'Edit price' : 'Set price'}
            </Button>
            {status === 'override' ? (
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => clear(row)}
                aria-label={`Clear price for ${row.option.label}`}
              >
                Clear price
              </Button>
            ) : null}
          </div>
        </div>
        {refusal?.key === key ? (
          <p role="alert" className="text-[12px] text-[var(--color-danger)]">
            {refusal.message}
          </p>
        ) : null}
        {editing === key ? form(row, key) : null}
      </li>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model prices</CardTitle>
        <CardDescription>
          One price table for every channel. A model the catalogue cannot price needs your price
          before any channel can route to it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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

        {rows.length === 0 && orphans.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-[var(--color-text-muted)]">
            Every listed model is priced by the catalogue. Nothing needs a price.
          </p>
        ) : (
          <ul
            aria-label="Model prices"
            className="flex flex-col divide-y divide-[var(--color-border)]"
          >
            {rows.map(renderRow)}
          </ul>
        )}

        {orphans.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-[13px] font-medium">Saved prices for models no list shows</h3>
            <ul className="flex flex-col gap-1">
              {orphans.map((entry) => (
                <li key={`${entry.kind}:${entry.key}`} className="flex items-center gap-3">
                  <span className="font-mono text-[12px]">{entry.key}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => save(entry.kind, entry.key, null)}
                    aria-label={`Clear price for ${entry.key}`}
                  >
                    Clear price
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
