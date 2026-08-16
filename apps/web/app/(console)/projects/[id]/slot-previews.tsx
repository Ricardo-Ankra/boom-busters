'use client'

import * as React from 'react'
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
const PAD = { top: 16, right: 16, bottom: 28, left: 52 }

function niceNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return Math.abs(value) >= 100 ? value.toFixed(0) : `${Number(value.toFixed(2))}`
}

export function ChartPreview({ brief, colors }: { brief: ChartBrief; colors: BrandChartColors }) {
  const plotW = WIDTH - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom

  // The x domain is the union of every series' labels, in first-seen order.
  const labels: string[] = []
  for (const series of brief.series) {
    for (const point of series.points) {
      if (!labels.includes(point.x)) labels.push(point.x)
    }
  }

  const stacked = brief.chartKind === 'stacked'
  const values = stacked
    ? labels.map((label) =>
        brief.series.reduce(
          (sum, series) => sum + (series.points.find((p) => p.x === label)?.y ?? 0),
          0,
        ),
      )
    : brief.series.flatMap((series) => series.points.map((point) => point.y))

  const rawMin = Math.min(...values, 0)
  const rawMax = Math.max(...values)
  const span = rawMax - rawMin || 1
  const yMin = rawMin
  const yMax = rawMax + span * 0.06

  const x = (index: number) =>
    PAD.left + (labels.length <= 1 ? plotW / 2 : (index / (labels.length - 1)) * plotW)
  const bandX = (index: number) => PAD.left + (index / labels.length) * plotW
  const bandW = plotW / Math.max(1, labels.length)
  const y = (value: number) => PAD.top + plotH - ((value - yMin) / (yMax - yMin)) * plotH

  const unit = brief.series[0]?.unit ?? ''
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
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={PAD.top + plotH * t}
          y2={PAD.top + plotH * t}
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
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke={colors.accent}
              strokeDasharray="3 3"
            />
            <text
              x={Math.min(x(index) + 4, WIDTH - PAD.right - 60)}
              y={PAD.top + 12}
              fontSize={10}
              fill={colors.accent}
              fontFamily="var(--font-mono, monospace)"
            >
              {annotation.text.slice(0, 24)}
            </text>
          </g>
        )
      })}

      {/* Axis facts: unit, extremes, first and last x. */}
      <text
        x={8}
        y={PAD.top + 8}
        fontSize={10}
        fill={colors.textSecondary}
        fontFamily="var(--font-mono, monospace)"
      >
        {unit}
      </text>
      <text
        x={PAD.left - 6}
        y={y(yMax) + 10}
        fontSize={10}
        fill={colors.textSecondary}
        textAnchor="end"
        fontFamily="var(--font-mono, monospace)"
      >
        {niceNumber(rawMax)}
      </text>
      <text
        x={PAD.left - 6}
        y={y(yMin)}
        fontSize={10}
        fill={colors.textSecondary}
        textAnchor="end"
        fontFamily="var(--font-mono, monospace)"
      >
        {niceNumber(rawMin)}
      </text>
      {first ? (
        <text
          x={PAD.left}
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
          x={WIDTH - PAD.right}
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
 * A schematic map: locations and routes projected onto a plain graticule,
 * zoomed to fit. Deliberately not a tile basemap — the point of a map slot is
 * "the money moved from HERE to THERE", and labels, points and a route say
 * that; street detail is M6's problem if it ever is one.
 */
export function MapPreview({ brief, colors }: { brief: MapBrief; colors: BrandChartColors }) {
  const lats = brief.locations.map((location) => location.lat)
  const lons = brief.locations.map((location) => location.lon)

  // The viewing window: the locations' bounding box, padded, and never so
  // tight that a single city becomes a featureless void.
  const padLon = Math.max(8, (Math.max(...lons) - Math.min(...lons)) * 0.25)
  const padLat = Math.max(5, (Math.max(...lats) - Math.min(...lats)) * 0.25)
  const west = Math.max(-180, Math.min(...lons) - padLon)
  const east = Math.min(180, Math.max(...lons) + padLon)
  const south = Math.max(-90, Math.min(...lats) - padLat)
  const north = Math.min(90, Math.max(...lats) + padLat)

  const x = (lon: number) => ((lon - west) / (east - west)) * WIDTH
  const y = (lat: number) => ((north - lat) / (north - south)) * HEIGHT

  // Graticule lines at a spacing that yields a handful of lines, not a grid.
  const lonStep = Math.ceil((east - west) / 6 / 5) * 5 || 5
  const latStep = Math.ceil((north - south) / 4 / 5) * 5 || 5
  const lonLines: number[] = []
  for (let lon = Math.ceil(west / lonStep) * lonStep; lon <= east; lon += lonStep)
    lonLines.push(lon)
  const latLines: number[] = []
  for (let lat = Math.ceil(south / latStep) * latStep; lat <= north; lat += latStep)
    latLines.push(lat)

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Map: ${brief.locations.map((location) => location.label).join(', ')}`}
      className="w-full rounded-[8px]"
      style={{ background: colors.surface }}
    >
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
