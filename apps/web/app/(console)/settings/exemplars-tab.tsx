'use client'

import type { BrandKitStored } from '@boom-busters/schemas'
import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ExemplarView } from '@/lib/exemplar-views'
import { GraphicPlayback, GraphicPlaybackProvider } from '../projects/[id]/graphic-playback'

/**
 * The exemplar corpus (decision 305), read-only: what the graphics designer
 * is shown before it designs a slot of each technique. Each written example
 * plays in the board's own player, with the owner's Brand Kit, its sample
 * narration and, for a chart, its sample data, so this is exactly what the
 * designer sees. One plays at a time.
 */

/** "kpi-counter" reads "Kpi counter"; the two acronyms read as they are said. */
function techniqueName(technique: string): string {
  const words = technique.split('-').map((word) => (word === 'kpi' ? 'KPI' : word))
  const sentence = words.join(' ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

export function ExemplarsTab({
  exemplars,
  brand,
}: {
  exemplars: readonly ExemplarView[]
  brand: BrandKitStored
}) {
  const written = exemplars.filter((exemplar) => exemplar.title !== undefined).length
  return (
    <GraphicPlaybackProvider>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Exemplars</CardTitle>
            <CardDescription>
              Before the designer makes a graphic, it is shown one finished example of the same kind
              and patterns on it. Each example plays here with your Brand Kit, its own sample
              narration and, for a chart, its sample data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-[14px]">
              {written} of {exemplars.length} examples written
            </p>
          </CardContent>
        </Card>
        {exemplars.map((exemplar) => (
          <ExemplarCard key={exemplar.technique} exemplar={exemplar} brand={brand} />
        ))}
      </div>
    </GraphicPlaybackProvider>
  )
}

function ExemplarCard({ exemplar, brand }: { exemplar: ExemplarView; brand: BrandKitStored }) {
  const headingId = React.useId()
  const name = techniqueName(exemplar.technique)
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId}>{name}</CardTitle>
        <CardDescription>{exemplar.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {exemplar.title !== undefined ? (
          <p className="text-[14px] font-medium">{exemplar.title}</p>
        ) : (
          <p className="text-[14px] text-[var(--color-text-muted)]">Not written yet</p>
        )}
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Adapted from{' '}
          <a
            href={exemplar.template.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center underline underline-offset-2"
          >
            {exemplar.template.name}
          </a>{' '}
          in {exemplar.template.repository}, {exemplar.template.licence} licence
        </p>
        {exemplar.issue !== undefined ? (
          <p role="alert" className="text-[13px] text-[var(--color-danger)]">
            This example cannot play: {exemplar.issue}
          </p>
        ) : null}
        {exemplar.code ? (
          <GraphicPlayback
            slotId={`exemplar-${exemplar.technique}`}
            code={exemplar.code}
            {...(exemplar.data ? { data: exemplar.data } : {})}
            noun="example"
            brand={brand}
            logoUrls={{}}
            durationMs={exemplar.code.durationMs}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}
