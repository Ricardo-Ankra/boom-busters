import { useMemo } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens, SlotPayload } from '@boom-busters/schemas'
import {
  FIGURE_CHAR_EM,
  barFigures,
  barGeometry,
  categoryReveal,
  chartLayout,
  figureBaseline,
  fitFigureSize,
  fitLabel,
  formatFigure,
  hasSecondScale,
  lineGeometry,
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
 * geometry from the pure lib, which the board preview shares, so the human
 * approves the chart that renders. The takeaway, the one thing the chart must
 * make the viewer see, is the headline, not a caption.
 *
 * Bars say their own numbers (decision 254): the figure sits at the end of
 * each bar, written out ("$4 Billion"), and those charts carry no y-axis
 * numbers and no unit in the corner. A line keeps its axis, because a line has
 * no bar to sit a figure on.
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
  const kind = payload.chartKind
  const bars = kind === 'bar' || kind === 'stacked' || kind === 'waterfall'
  // Known before the layout, because the right-hand axis needs gutter in the
  // frame box the layout is then measured against (decision 259).
  const twoScales = hasSecondScale(payload.series, kind)

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
        // Bars need headroom for the figure above the tallest one, and no
        // left gutter at all: there are no axis numbers to put in it.
        top: Math.round((bars ? 72 : 30) * scale),
        right: Math.round((twoScales && !bars ? 150 : 40) * scale),
        bottom: Math.round(64 * scale),
        left: Math.round((bars ? 40 : 150) * scale),
      },
    }
    return { frameBox: box, layout: chartLayout(payload.series, payload.chartKind, box) }
  }, [payload.series, payload.chartKind, width, height, scale, margin, titleZone, bars, twoScales])
  const seriesColour = (index: number) =>
    colors.chartSeries[index % colors.chartSeries.length] ?? colors.accent
  // The right axis takes its colour from the line it measures, which is how
  // the viewer knows which of the two it belongs to.
  const rightIndex = payload.series.findIndex(
    (_, index) => layout.right !== null && layout.scaleOf(index) === layout.right,
  )
  const leftIndex = payload.series.findIndex((_, index) => layout.scaleOf(index) === layout.left)

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

  // The axis NAME is a label, not a figure, so it is set smaller than the
  // numbers: at figure size a gutter sized for "$18 Billion" clips
  // "Valuation" down to seven characters (decision 259).
  const axisNameSize = 22 * scale
  const axisName: React.CSSProperties = { ...axisText, fontSize: axisNameSize }

  // One size for every figure on the chart, fitted to the tightest slot. The
  // figures are the point of a bar chart, so they start well above axis type
  // (40px at 1080p against 30) and only come down to fit.
  const figures = useMemo(
    () => barFigures(payload.series, payload.chartKind, layout),
    [payload.series, payload.chartKind, layout],
  )
  const figureSize = fitFigureSize(
    figures,
    Number(typeStyle(typography.numbers, 40, scale).fontSize) || 40 * scale,
    20 * scale,
  )

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
          // clamps a long label inside the plot.
          const estimatedWidth = annotation.text.length * FIGURE_CHAR_EM * 30 * scale
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

        {/* The figures, arriving as each bar finishes growing. */}
        {figures.map((figure) => {
          const grow = categoryReveal(progress, figure.categoryIndex, layout.labels.length)
          const opacity = Math.min(1, Math.max(0, (grow - 0.55) / 0.45))
          if (opacity === 0) return null
          return (
            <text
              key={figure.key}
              style={{ ...axisText, fill: colors.textPrimary, fontSize: figureSize }}
              x={figure.x}
              y={figureBaseline(figure, figureSize)}
              textAnchor="middle"
              opacity={opacity}
            >
              {figure.text}
            </text>
          )
        })}

        {/* A line needs its extremes to be read; a bar has said its number. */}
        {bars ? null : (
          <>
            {/* With two scales the extremes land beside the WRONG line: the
                valuation's top sits where the margin starts. So each axis
                takes its series' colour and says its name (decision 259). */}
            {layout.right ? (
              <text
                style={{ ...axisName, fill: seriesColour(leftIndex) }}
                x={frameBox.pad.left - 12 * scale}
                y={layout.y(layout.rawMax) - 26 * scale}
                textAnchor="end"
              >
                {fitLabel(
                  payload.series[leftIndex]?.label ?? '',
                  frameBox.pad.left - 12 * scale,
                  axisNameSize,
                )}
              </text>
            ) : null}
            <text
              style={layout.right ? { ...axisText, fill: seriesColour(leftIndex) } : axisText}
              x={frameBox.pad.left - 12 * scale}
              y={layout.y(layout.rawMax) + 8}
              textAnchor="end"
            >
              {formatFigure(layout.rawMax, layout.unit)}
            </text>
            <text
              style={layout.right ? { ...axisText, fill: seriesColour(leftIndex) } : axisText}
              x={frameBox.pad.left - 12 * scale}
              y={layout.y(layout.rawMin)}
              textAnchor="end"
            >
              {formatFigure(layout.rawMin, layout.unit)}
            </text>
            {/* The second measure's extremes, on its own side (decision 259).
                Without these the right-hand line is drawn against a scale the
                viewer cannot see, which is worse than not drawing it. */}
            {layout.right ? (
              <>
                <text
                  style={{ ...axisName, fill: seriesColour(rightIndex) }}
                  x={frameBox.width - frameBox.pad.right + 12 * scale}
                  y={layout.right.y(layout.right.rawMax) - 26 * scale}
                  textAnchor="start"
                >
                  {fitLabel(
                    payload.series[rightIndex]?.label ?? '',
                    frameBox.pad.right - 12 * scale,
                    axisNameSize,
                  )}
                </text>
                <text
                  style={{ ...axisText, fill: seriesColour(rightIndex) }}
                  x={frameBox.width - frameBox.pad.right + 12 * scale}
                  y={layout.right.y(layout.right.rawMax) + 8}
                  textAnchor="start"
                >
                  {formatFigure(layout.right.rawMax, layout.right.unit)}
                </text>
                <text
                  style={{ ...axisText, fill: seriesColour(rightIndex) }}
                  x={frameBox.width - frameBox.pad.right + 12 * scale}
                  y={layout.right.y(layout.right.rawMin)}
                  textAnchor="start"
                >
                  {formatFigure(layout.right.rawMin, layout.right.unit)}
                </text>
              </>
            ) : null}
          </>
        )}
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
