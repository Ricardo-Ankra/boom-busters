'use client'

import type { OptionPrice } from '@boom-busters/providers'
import type { ModelPrices } from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'

/**
 * The owner's price forms on Settings → Models (decision 288): per million
 * tokens for an LLM, per image (and per size, for Gemini) for an image model.
 * Each form is named by its title for a screen reader, and a refused price is
 * announced and tied to the fields it refers to, not only coloured red.
 */

export type LlmPrice = ModelPrices['llm'][string]
export type ImagePrice = ModelPrices['image'][string]

export const IMAGE_SIZES = ['1K', '2K', '4K'] as const

export const PRICE_ERROR = 'Enter a price above zero, using a full stop for decimals.'

/** A typed price, or null when it is not a positive number written with a full stop. */
export function parsePrice(raw: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(raw.trim())) return null
  const value = Number(raw)
  return value > 0 ? value : null
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

/** The error line, announced when it appears and named by the fields it covers. */
function PriceError({ id, error }: { id: string; error: string | null }) {
  return error ? (
    <p id={id} role="alert" className="text-[12px] text-[var(--color-danger)]">
      {error}
    </p>
  ) : null
}

/** What every price field carries once a price has been refused. */
const invalidity = (errorId: string, error: string | null) =>
  error ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {}

export function LlmPriceForm({
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
  const errorId = `${id}-error`

  return (
    <form
      aria-labelledby={`${id}-title`}
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
      <p id={`${id}-title`} className="text-[13px]">
        {title}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-in`}>Input, $ per million tokens</Label>
          <Input
            id={`${id}-in`}
            inputMode="decimal"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            {...invalidity(errorId, error)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-out`}>Output, $ per million tokens</Label>
          <Input
            id={`${id}-out`}
            inputMode="decimal"
            value={output}
            onChange={(event) => setOutput(event.target.value)}
            {...invalidity(errorId, error)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-cached`}>Cached input, $ per million tokens (optional)</Label>
          <Input
            id={`${id}-cached`}
            inputMode="decimal"
            value={cached}
            onChange={(event) => setCached(event.target.value)}
            {...invalidity(errorId, error)}
          />
        </div>
      </div>
      <PriceError id={errorId} error={error} />
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
export function ImagePriceForm({
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
  const [each, setEach] = React.useState(seed ? String(seed.pricePerImage) : '')
  const [bySize, setBySize] = React.useState<Record<(typeof IMAGE_SIZES)[number], string>>(() => ({
    '1K': seed?.pricesBySize?.['1K'] ? String(seed.pricesBySize['1K']) : '',
    '2K': seed?.pricesBySize?.['2K'] ? String(seed.pricesBySize['2K']) : '',
    '4K': seed?.pricesBySize?.['4K'] ? String(seed.pricesBySize['4K']) : '',
  }))
  const [error, setError] = React.useState<string | null>(null)
  const id = React.useId()
  const errorId = `${id}-error`

  return (
    <form
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const pricePerImage = parsePrice(each)
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
      <p id={`${id}-title`} className="text-[13px]">
        {title}
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-each`}>Price per image ($)</Label>
          <Input
            id={`${id}-each`}
            inputMode="decimal"
            value={each}
            onChange={(event) => setEach(event.target.value)}
            {...invalidity(errorId, error)}
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
                  {...invalidity(errorId, error)}
                />
              </div>
            ))
          : null}
      </div>
      <PriceError id={errorId} error={error} />
      <FormButtons saveLabel={saveLabel} onCancel={onCancel} />
    </form>
  )
}
