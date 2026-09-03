import { useMemo } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens, SlotPayload } from '@boom-busters/schemas'
import {
  barGeometry,
  categoryReveal,
  chartLayout,
  lineGeometry,
  niceNumber,
  stackedGeometry,
  waterfallGeometry,
} from '../lib/chart'
import { easeInOut } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from './brand'

export type ChartPayload = Extract<SlotPayload, { kind: 'chart' }>

/**
 * The chart component (spec section 8.3): line/area/bar/stacked/waterfall,
 * draw-on reveal cascading left to right, accent-colour emphasis, waterfall
 * falls in the semantic collapse colour. All styling from brand tokens; all
 * geometry from the pure lib, which mirrors the board preview the human
 * approved. The takeaway — the one thing the chart must make the viewer see
 * — is the headline, not a caption.
 */
export function ChartReveal({
  payload,
  brand,
  durationInFrames,
}: {
  payload: ChartPayload
  brand: BrandKitTokens
  durationInFrames: number
}) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const { colors, typography } = brand

  // The reveal occupies the first 70% of the slot; the finished chart holds.
  const revealFrames = Math.max(1, Math.round(durationInFrames * 0.7))
  const progress = payload.reveal === 'none' ? 1 : easeInOut(Math.min(1, frame / revealFrames))

  const titleZone = Math.round(200 * scale)
  const margin = Math.round(96 * scale)
  // Memoised: the layout depends on the payload and the frame size, never
  // the current frame — recomputing it 30 times a second was free offline
  // and jank in the @remotion/player.
  const { frameBox, layout } = useMemo(() => {
    const box = {
      width: width - margin * 2,
      height: height - titleZone - margin * 2,
      pad: {
        top: Math.round(30 * scale),
        right: Math.round(40 * scale),
        bottom: Math.round(64 * scale),
        left: Math.round(150 * scale),
      },
    }
    return { frameBox: box, layout: chartLayout(payload.series, payload.chartKind, box) }
  }, [payload.series, payload.chartKind, width, height, scale, margin, titleZone])
  const seriesColour = (index: number) =>
    colors.chartSeries[index % colors.chartSeries.length] ?? colors.accent

  // 30px at 1080p (was 20): the bars read from across the room, the words
  // must too. The stroke-behind (paint-order) keeps a label legible where
  // it crosses a gridline or a bar.
  const axisText: React.CSSProperties = {
    ...typeStyle(typography.numbers, 30, scale),
    fill: colors.textSecondary,
    stroke: colors.background,
    strokeWidth: 5 * scale,
    paintOrder: 'stroke',
  }

  const first = layout.labels[0]
  const last = layout.labels[layout.labels.length - 1]

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background, padding: margin }}>
      <div
        style={{
          ...typeStyle(typography.title, 52, scale),
          color: colors.textPrimary,
          maxWidth: '85%',
          lineHeight: 1.25,
          height: titleZone - margin / 2,
        }}
      >
        {payload.takeaway}
      </div>

      <svg
        width={frameBox.width}
        height={frameBox.height}
        viewBox={`0 0 ${frameBox.width} ${frameBox.height}`}
      >
        {/* Faint quarter gridlines — a documentary chart, not graph paper. */}
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={frameBox.pad.left}
            x2={frameBox.width - frameBox.pad.right}
            y1={frameBox.pad.top + layout.plotHeight * t}
            y2={frameBox.pad.top + layout.plotHeight * t}
            stroke={colors.textSecondary}
            strokeOpacity={0.15}
          />
        ))}
        <line
          x1={frameBox.pad.left}
          x2={frameBox.width - frameBox.pad.right}
          y1={layout.y(0)}
          y2={layout.y(0)}
          stroke={colors.textSecondary}
          strokeOpacity={0.4}
        />

        {(payload.chartKind === 'line' || payload.chartKind === 'area') &&
          lineGeometry(payload.series, layout).map((series) => {
            const colour = seriesColour(series.colourIndex)
            const pointsAttr = series.points.map((point) => `${point.x},${point.y}`).join(' ')
            const firstX = series.points[0]?.x ?? 0
            const lastX = series.points[series.points.length - 1]?.x ?? 0
            return (
              <g key={series.colourIndex}>
                {payload.chartKind === 'area' ? (
                  <polygon
                    points={`${firstX},${layout.y(layout.yMin)} ${pointsAttr} ${lastX},${layout.y(layout.yMin)}`}
                    fill={colour}
                    fillOpacity={0.18 * progress}
                  />
                ) : null}
                <polyline
                  points={pointsAttr}
                  fill="none"
                  stroke={colour}
                  strokeWidth={4 * scale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={series.length}
                  strokeDashoffset={series.length * (1 - progress)}
                />
              </g>
            )
          })}

        {payload.chartKind === 'bar' &&
          barGeometry(payload.series, layout).map((rect) => {
            const grow = categoryReveal(progress, rect.categoryIndex, layout.labels.length)
            const shown = rect.height * grow
            const top = rect.y + rect.height - shown
            return (
              <rect
                key={rect.key}
                x={rect.x}
                y={rect.y >= layout.y(0) ? rect.y : top}
                width={rect.width}
                height={shown}
                fill={seriesColour(rect.colourIndex)}
              />
            )
          })}

        {payload.chartKind === 'stacked' &&
          stackedGeometry(payload.series, layout).map((rect) => {
            const grow = categoryReveal(progress, rect.categoryIndex, layout.labels.length)
            // The whole stack compresses toward the baseline while growing.
            const baseline = layout.y(0)
            const y = baseline - (baseline - rect.y) * grow
            return (
              <rect
                key={rect.key}
                x={rect.x}
                y={y}
                width={rect.width}
                height={rect.height * grow}
                fill={seriesColour(rect.colourIndex)}
              />
            )
          })}

        {payload.chartKind === 'waterfall' &&
          payload.series[0] !== undefined &&
          waterfallGeometry(payload.series[0], layout).map((bar) => {
            const grow = categoryReveal(progress, bar.categoryIndex, layout.labels.length)
            const shown = bar.height * grow
            // Bars grow away from the level they start at.
            const y = bar.fromY <= bar.y ? bar.fromY : bar.fromY - shown
            return (
              <rect
                key={bar.key}
                x={bar.x}
                y={y}
                width={bar.width}
                height={shown}
                fill={bar.falling ? colors.semantic.collapse : seriesColour(0)}
              />
            )
          })}

        {(payload.annotations ?? []).map((annotation, annotationIndex) => {
          const index = layout.labels.indexOf(annotation.atX)
          if (index === -1) return null
          const visible = categoryReveal(progress, index, layout.labels.length)
          if (visible < 1) return null
          const x = layout.x(index)
          // Every annotation used to sit on one row and collide; they now
          // stagger down three rows in payload order. The width estimate
          // (0.58em per character) clamps a long label inside the plot.
          const estimatedWidth = annotation.text.length * 0.58 * 30 * scale
          const textX = Math.min(
            x + 12 * scale,
            Math.max(frameBox.pad.left, frameBox.width - frameBox.pad.right - estimatedWidth),
          )
          const textY = frameBox.pad.top + (38 + (annotationIndex % 3) * 42) * scale
          return (
            <g key={annotation.atX}>
              <line
                x1={x}
                x2={x}
                y1={frameBox.pad.top}
                y2={frameBox.pad.top + layout.plotHeight}
                stroke={colors.accent}
                strokeDasharray={`${6 * scale} ${6 * scale}`}
              />
              <text style={{ ...axisText, fill: colors.accent }} x={textX} y={textY}>
                {annotation.text}
              </text>
            </g>
          )
        })}

        {/* Axis facts: unit, extremes, first and last x — the preview's set. */}
        <text style={axisText} x={8 * scale} y={frameBox.pad.top + 8 * scale}>
          {layout.unit}
        </text>
        <text
          style={axisText}
          x={frameBox.pad.left - 12 * scale}
          y={layout.y(layout.rawMax) + 8}
          textAnchor="end"
        >
          {niceNumber(layout.rawMax)}
        </text>
        <text
          style={axisText}
          x={frameBox.pad.left - 12 * scale}
          y={layout.y(layout.rawMin)}
          textAnchor="end"
        >
          {niceNumber(layout.rawMin)}
        </text>
        {first !== undefined ? (
          <text style={axisText} x={frameBox.pad.left} y={frameBox.height - 12 * scale}>
            {first}
          </text>
        ) : null}
        {last !== undefined && last !== first ? (
          <text
            style={axisText}
            x={frameBox.width - frameBox.pad.right}
            y={frameBox.height - 12 * scale}
            textAnchor="end"
          >
            {last}
          </text>
        ) : null}
      </svg>

      {/* A hairline seat under the chart, in the surface tone. */}
      <div
        style={{
          position: 'absolute',
          left: margin,
          right: margin,
          bottom: margin - 2,
          height: 2,
          backgroundColor: withAlpha(colors.surface, 0.9),
        }}
      />
    </AbsoluteFill>
  )
}
