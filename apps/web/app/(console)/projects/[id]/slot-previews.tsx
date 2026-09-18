'use client'

import * as React from 'react'
import {
  barFigures,
  chartLayout,
  figureBaseline,
  fitFigureSize,
  fitLabel,
  formatFigure,
  hasSecondScale,
} from '@boom-busters/compositions/chart'
import { fitBounds, graticule, landPaths, projector } from '@boom-busters/compositions/geo'
import type { ChartBrief, MapBrief } from '@boom-busters/schemas'

/**
 * Live chart and map previews (build spec section 11.3): rendered with the
 * REAL Brand Kit tokens, so what the board shows is the palette the render
 * will use. Pure SVG — these are previews of composition data, driven by the
 * same brief the M6 compositions will consume, not `@remotion/player`
 * instances: the compositions package does not exist until M6, and a preview
 * that faked it with a different renderer would drift from the eventual
 * frames anyway. (Recorded as an M5 decision.)
 *
 * Charts are the anti-slop differentiator, and the rule has teeth here too:
 * `ChartErrorCard` is what renders when a chart brief is broken — an error
 * card, never a chart (spec: "a chart with no claim ref renders an error
 * card").
 */

export interface BrandChartColors {
  accent: string
  surface: string
  textPrimary: string
  textSecondary: string
  chartSeries: readonly string[]
  collapse: string
}

const WIDTH = 480
const HEIGHT = 220

export function ChartPreview({ brief, colors }: { brief: ChartBrief; colors: BrandChartColors }) {
  const stacked = brief.chartKind === 'stacked'
  const bars = brief.chartKind === 'bar' || stacked || brief.chartKind === 'waterfall'

  // Bars carry their own figures, so they need headroom above and no left
  // gutter; a line still needs the gutter for its extremes.
  // A second measure needs a gutter of its own on the right (decision 259).
  const twoScales = hasSecondScale(brief.series, brief.chartKind)
  const pad = {
    top: bars ? 26 : 16,
    right: twoScales && !bars ? 52 : 16,
    bottom: 28,
    left: bars ? 12 : 52,
  }
  // The geometry is the render's own module, not a second copy of it: the
  // board is where the human approves the chart, so it must be the chart.
  const layout = chartLayout(brief.series, brief.chartKind, { width: WIDTH, height: HEIGHT, pad })
  const { labels, plotHeight: plotH, bandWidth: bandW, x, y, bandX, unit, yMin } = layout

  const figures = barFigures(brief.series, brief.chartKind, layout)
  const figureSize = fitFigureSize(figures, 11, 7)
  const first = labels[0]
  const last = labels[labels.length - 1]

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${brief.chartKind} chart: ${brief.takeaway}`}
      className="w-full rounded-[8px]"
      style={{ background: colors.surface }}
    >
      {/* Faint grid: quarter lines only — a preview, not graph paper. */}
      {[0.25, 0.5, 0.75].map((t) => (
        <line
          key={t}
          x1={pad.left}
          x2={WIDTH - pad.right}
          y1={pad.top + plotH * t}
          y2={pad.top + plotH * t}
          stroke={colors.textSecondary}
          strokeOpacity={0.15}
        />
      ))}

      {brief.chartKind === 'line' || brief.chartKind === 'area'
        ? brief.series.map((series, s) => {
            const colour = colors.chartSeries[s % colors.chartSeries.length] ?? colors.accent
            const points = series.points
              .map((point) => `${x(labels.indexOf(point.x))},${y(point.y)}`)
              .join(' ')
            const firstX = x(labels.indexOf(series.points[0]!.x))
            const lastX = x(labels.indexOf(series.points[series.points.length - 1]!.x))
            return (
              <g key={series.label}>
                {brief.chartKind === 'area' ? (
                  <polygon
                    points={`${firstX},${y(yMin)} ${points} ${lastX},${y(yMin)}`}
                    fill={colour}
                    fillOpacity={0.18}
                  />
                ) : null}
                <polyline points={points} fill="none" stroke={colour} strokeWidth={2} />
              </g>
            )
          })
        : null}

      {brief.chartKind === 'bar'
        ? labels.map((label, i) =>
            brief.series.map((series, s) => {
              const value = series.points.find((point) => point.x === label)?.y
              if (value === undefined) return null
              const colour = colors.chartSeries[s % colors.chartSeries.length] ?? colors.accent
              const w = (bandW * 0.7) / brief.series.length
              return (
                <rect
                  key={`${label}:${series.label}`}
                  x={bandX(i) + bandW * 0.15 + w * s}
                  y={y(Math.max(0, value))}
                  width={w}
                  height={Math.abs(y(value) - y(0))}
                  fill={colour}
                />
              )
            }),
          )
        : null}

      {stacked
        ? labels.map((label, i) => {
            let running = 0
            return brief.series.map((series, s) => {
              const value = series.points.find((point) => point.x === label)?.y ?? 0
              const base = running
              running += value
              const colour = colors.chartSeries[s % colors.chartSeries.length] ?? colors.accent
              return (
                <rect
                  key={`${label}:${series.label}`}
                  x={bandX(i) + bandW * 0.15}
                  y={y(base + value)}
                  width={bandW * 0.7}
                  height={Math.abs(y(base + value) - y(base))}
                  fill={colour}
                />
              )
            })
          })
        : null}

      {brief.chartKind === 'waterfall'
        ? (() => {
            const series = brief.series[0]!
            let previous = series.points[0]!.y
            return series.points.map((point, i) => {
              const from = i === 0 ? 0 : previous
              const to = point.y
              if (i > 0) previous = point.y
              const falling = to < from
              return (
                <g key={point.x}>
                  <rect
                    x={bandX(i) + bandW * 0.2}
                    y={y(Math.max(from, to))}
                    width={bandW * 0.6}
                    height={Math.max(1, Math.abs(y(to) - y(from)))}
                    fill={falling ? colors.collapse : (colors.chartSeries[0] ?? colors.accent)}
                  />
                </g>
              )
            })
          })()
        : null}

      {(brief.annotations ?? []).map((annotation) => {
        const index = labels.indexOf(annotation.atX)
        if (index === -1) return null
        return (
          <g key={annotation.atX}>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke={colors.accent}
              strokeDasharray="3 3"
            />
            <text
              x={Math.min(x(index) + 4, WIDTH - pad.right - 60)}
              y={pad.top + 12}
              fontSize={10}
              fill={colors.accent}
              fontFamily="var(--font-mono, monospace)"
            >
              {annotation.text.slice(0, 24)}
            </text>
          </g>
        )
      })}

      {/* Every bar says its own number (decision 254): the same rule, and the
          same figures, that the render draws. */}
      {figures.map((figure) => (
        <text
          key={figure.key}
          x={figure.x}
          y={figureBaseline(figure, figureSize)}
          fontSize={figureSize}
          fill={colors.textPrimary}
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
        >
          {figure.text}
        </text>
      ))}

      {/* A line needs its extremes to be read; a bar has said its number. */}
      {bars ? null : (
        <>
          {/* Two scales means each axis must say WHICH line it measures: its
              extreme otherwise lands beside the other one (decision 259). */}
          {layout.right ? (
            <text
              x={pad.left - 6}
              y={y(layout.rawMax) - 4}
              fontSize={8}
              fill={colors.chartSeries[0] ?? colors.accent}
              textAnchor="end"
              fontFamily="var(--font-mono, monospace)"
            >
              {fitLabel(brief.series[0]?.label ?? '', pad.left - 6, 8)}
            </text>
          ) : null}
          <text
            x={pad.left - 6}
            y={y(layout.rawMax) + 10}
            fontSize={10}
            fill={layout.right ? (colors.chartSeries[0] ?? colors.accent) : colors.textSecondary}
            textAnchor="end"
            fontFamily="var(--font-mono, monospace)"
          >
            {formatFigure(layout.rawMax, unit)}
          </text>
          <text
            x={pad.left - 6}
            y={y(layout.rawMin)}
            fontSize={10}
            fill={layout.right ? (colors.chartSeries[0] ?? colors.accent) : colors.textSecondary}
            textAnchor="end"
            fontFamily="var(--font-mono, monospace)"
          >
            {formatFigure(layout.rawMin, unit)}
          </text>
          {/* The second measure reads against its own side, in the colour of
              the line it belongs to. Without it that line is drawn against a
              scale nobody can see. */}
          {layout.right ? (
            <>
              <text
                x={WIDTH - pad.right + 6}
                y={layout.right.y(layout.right.rawMax) - 4}
                fontSize={8}
                fill={colors.chartSeries[1] ?? colors.accent}
                textAnchor="start"
                fontFamily="var(--font-mono, monospace)"
              >
                {fitLabel(
                  brief.series.find((one, index) => layout.scaleOf(index) === layout.right)
                    ?.label ?? '',
                  pad.right - 6,
                  8,
                )}
              </text>
              <text
                x={WIDTH - pad.right + 6}
                y={layout.right.y(layout.right.rawMax) + 10}
                fontSize={10}
                fill={colors.chartSeries[1] ?? colors.accent}
                textAnchor="start"
                fontFamily="var(--font-mono, monospace)"
              >
                {formatFigure(layout.right.rawMax, layout.right.unit)}
              </text>
              <text
                x={WIDTH - pad.right + 6}
                y={layout.right.y(layout.right.rawMin)}
                fontSize={10}
                fill={colors.chartSeries[1] ?? colors.accent}
                textAnchor="start"
                fontFamily="var(--font-mono, monospace)"
              >
                {formatFigure(layout.right.rawMin, layout.right.unit)}
              </text>
            </>
          ) : null}
        </>
      )}
      {first ? (
        <text
          x={pad.left}
          y={HEIGHT - 8}
          fontSize={10}
          fill={colors.textSecondary}
          fontFamily="var(--font-mono, monospace)"
        >
          {first}
        </text>
      ) : null}
      {last && last !== first ? (
        <text
          x={WIDTH - pad.right}
          y={HEIGHT - 8}
          fontSize={10}
          fill={colors.textSecondary}
          textAnchor="end"
          fontFamily="var(--font-mono, monospace)"
        >
          {last}
        </text>
      ) : null}
    </svg>
  )
}

/**
 * The error card the chart rule demands. Rendered whenever a chart brief is
 * missing or broken — the one thing it must never do is look like data.
 */
export function ChartErrorCard({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex min-h-[120px] flex-col items-start justify-center gap-1 rounded-[8px] border border-[var(--color-danger)] bg-[var(--color-surface)] p-4"
    >
      <p className="text-[13px] font-semibold text-[var(--color-danger)]">
        This chart cannot be rendered
      </p>
      <p className="text-[13px] text-[var(--color-text-secondary)]">{message}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

/**
 * The map preview, on the same bundled world geometry the M6 `AnimatedMap`
 * composition renders — real Natural Earth coastlines, projected by the
 * shared `@boom-busters/compositions/geo` module, so the board can never
 * show a different world than the render (M6.5; supersedes the M5 schematic
 * of decision 116). Still no tiles and no network: the land is data in the
 * repo.
 */
export function MapPreview({ brief, colors }: { brief: MapBrief; colors: BrandChartColors }) {
  const bounds = fitBounds(brief.locations)
  const { x, y } = projector(bounds, WIDTH, HEIGHT)
  const { lons: lonLines, lats: latLines } = graticule(bounds)

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Map: ${brief.locations.map((location) => location.label).join(', ')}`}
      className="w-full rounded-[8px]"
      style={{ background: colors.surface }}
    >
      {landPaths(bounds, WIDTH, HEIGHT).map((d, index) => (
        <path
          key={index}
          d={d}
          fill={colors.textSecondary}
          fillOpacity={0.12}
          fillRule="evenodd"
          stroke={colors.textSecondary}
          strokeOpacity={0.3}
        />
      ))}
      {lonLines.map((lon) => (
        <line
          key={`lon${lon}`}
          x1={x(lon)}
          x2={x(lon)}
          y1={0}
          y2={HEIGHT}
          stroke={colors.textSecondary}
          strokeOpacity={0.12}
        />
      ))}
      {latLines.map((lat) => (
        <line
          key={`lat${lat}`}
          x1={0}
          x2={WIDTH}
          y1={y(lat)}
          y2={y(lat)}
          stroke={colors.textSecondary}
          strokeOpacity={0.12}
        />
      ))}

      {brief.route && brief.locations.length > 1 ? (
        <polyline
          points={brief.locations
            .map((location) => `${x(location.lon)},${y(location.lat)}`)
            .join(' ')}
          fill="none"
          stroke={colors.accent}
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      ) : null}

      {brief.locations.map((location) => (
        <g key={location.label}>
          <circle cx={x(location.lon)} cy={y(location.lat)} r={5} fill={colors.accent} />
          <circle
            cx={x(location.lon)}
            cy={y(location.lat)}
            r={9}
            fill="none"
            stroke={colors.accent}
            strokeOpacity={0.4}
          />
          <text
            x={Math.min(x(location.lon) + 12, WIDTH - 70)}
            y={y(location.lat) + 4}
            fontSize={11}
            fill={colors.textPrimary}
            fontFamily="var(--font-mono, monospace)"
          >
            {location.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

/**
 * The headline card as the board shows it (decision 257).
 *
 * The same clipping the render draws, in DOM rather than SVG: paper, a double
 * rule under the masthead, the marker under the emphasised phrase. What the
 * board approves has to be what the frame shows.
 *
 * A record with no headline yet renders as the empty card it is, so the
 * missing fields are obvious at a glance rather than described in a sentence.
 */
export function HeadlinePreview({
  article,
  emphasis,
  showDeck,
  colors,
}: {
  article: {
    outlet: string | null
    headline: string | null
    author: string | null
    publishedAt: string | null
    description: string | null
    url: string
  }
  emphasis: string | undefined
  showDeck: boolean
  colors: BrandChartColors
}) {
  const headline = article.headline ?? ''
  const at = emphasis === undefined || emphasis === '' ? -1 : headline.indexOf(emphasis)
  const before = at === -1 ? headline : headline.slice(0, at)
  const hit = at === -1 ? '' : headline.slice(at, at + (emphasis?.length ?? 0))
  const after = at === -1 ? '' : headline.slice(at + (emphasis?.length ?? 0))

  return (
    <div
      className="rounded-[2px] p-4"
      style={{ backgroundColor: '#f4f1ea', color: '#14161a' }}
      aria-label="Headline card preview"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase">
          {article.outlet ?? '—'}
        </span>
        <span className="text-[10px] tracking-[0.08em] whitespace-nowrap text-[#5f646d] uppercase">
          {article.publishedAt ?? '—'}
        </span>
      </div>
      <div className="mt-2 h-[2px]" style={{ backgroundColor: '#14161a' }} />
      <div className="mt-[2px] h-px" style={{ backgroundColor: '#14161a' }} />

      <p className="mt-3 font-serif text-[19px] leading-[1.15] font-bold">
        {headline === '' ? (
          <span className="text-[#9aa0a8] italic">No headline yet</span>
        ) : (
          <>
            {before}
            {hit === '' ? null : (
              <span
                style={{
                  backgroundImage: `linear-gradient(transparent 58%, ${colors.accent}8c 58%)`,
                }}
              >
                {hit}
              </span>
            )}
            {after}
          </>
        )}
      </p>

      {showDeck && article.description ? (
        <p className="mt-2 font-serif text-[12px] leading-snug text-[#3c414a]">
          {article.description}
        </p>
      ) : null}

      <div className="mt-3 h-px" style={{ backgroundColor: '#c9c3b5' }} />
      <div className="mt-2 flex items-baseline justify-between gap-3 text-[#5f646d]">
        <span className="font-serif text-[11px] font-semibold">
          {article.author === null ? (article.outlet ?? '') : `By ${article.author}`}
        </span>
        <span className="truncate font-mono text-[10px]">
          {article.url.replace(/^https?:\/\//, '')}
        </span>
      </div>
    </div>
  )
}
