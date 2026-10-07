import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'
import type { BrandKitTokens, GraphicElement, GraphicPayload } from '@boom-busters/schemas'
import {
  barLengthPx,
  barsGapPx,
  barsGeometry,
  countedValue,
  enterProgress,
  figureLabelBasePx,
  figureLabelGapPx,
  graphicDrift,
  graphicLayout,
  roleFontPx,
  ruleThicknessPx,
  staggeredEnterMs,
  tokenColor,
  underlineBar,
  type ElementBox,
} from '../lib/graphic'
import { mediaUrl } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from './brand'

/**
 * A composed graphic (decision 268, Plan B). Every box and font size comes
 * from `graphicLayout`, and the bars and rule shapes take their remaining
 * geometry (row height, bar length, line thickness) from the same module, so
 * what was approved is what renders. Each element enters at its own offset;
 * a figure may count up; an emphasis is a single pulse or a solid underline
 * bar that sweeps in beneath the text. Logos are drawn as they are: contained, never
 * stretched, never recoloured.
 */

const PULSE_AT_MS = 600
const PULSE_MS = 360
const BAR_GROW_MS = 700

/**
 * The solid bar an `underline` emphasis draws under its text. Its thickness and offset
 * come from `underlineBar`, the function the board's preview draws from too; its width
 * is the sweep's progress as a share of the text it sits in, so it is the text's real
 * width rather than an estimate of it. The parent span is `position: relative` and the
 * bar hangs from its vertical centre, so it does not depend on the line height.
 */
function UnderlineBar({
  fontPx,
  progress,
  color,
  frame,
}: {
  fontPx: number
  progress: number
  color: string
  frame: { width: number; height: number }
}) {
  const bar = underlineBar(fontPx, 1, progress, frame)
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        top: `calc(50% + ${bar.topFromCentrePx}px)`,
        height: bar.thicknessPx,
        width: `${bar.widthPx * 100}%`,
        backgroundColor: color,
      }}
    />
  )
}

function pulseScale(frame: number, fps: number, atMs: number): number {
  const t = (frame / fps) * 1000 - (atMs + PULSE_AT_MS)
  if (t <= 0 || t >= PULSE_MS) return 1
  const phase = Math.sin((t / PULSE_MS) * Math.PI)
  return 1 + 0.04 * phase
}

function enterStyle(
  kind: GraphicElement['enter']['kind'],
  progress: number,
  scale: number,
): CSSProperties {
  switch (kind) {
    case 'rise':
      return { opacity: progress, transform: `translateY(${(1 - progress) * 24 * scale}px)` }
    case 'wipe':
      return { clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }
    case 'fade':
    case 'count':
      return { opacity: progress }
  }
}

export function GraphicCard({
  payload,
  brand,
  durationInFrames,
}: {
  payload: GraphicPayload
  brand: BrandKitTokens
  /**
   * The slot's own length, so the card's motion can span it. Optional only so
   * that a caller with no slot around it (a story, a test) still renders; the
   * master always passes it, exactly as it does for `ChartReveal`.
   */
  durationInFrames?: number
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const boxes = graphicLayout(payload.scene, { width, height }, brand)
  const byId = new Map(boxes.map((box) => [box.id, box]))
  const enterAt = staggeredEnterMs(payload.scene)
  const drift = durationInFrames === undefined ? 1 : graphicDrift(frame, durationInFrames)
  const { colors, typography } = brand

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(90% 75% at 50% 44%, ${colors.surface} 0%, ${colors.background} 72%)`,
        }}
      />
      {/*
        One wrapper carries the drift, so the whole composition lifts together and no
        element's own transform has to compose with it. Scaling about the centre keeps
        the safe area's margins proportional, which is why nothing drifts off frame.
      */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${drift})`,
          transformOrigin: 'center',
        }}
      >
        {payload.scene.elements.map((element) => {
          const box = byId.get(element.id) as ElementBox
          const atMs = enterAt.get(element.id) ?? element.enter.atMs
          const progress = enterProgress(frame, fps, atMs)
          const pulse = element.emphasis === 'pulse' ? pulseScale(frame, fps, atMs) : 1
          const base: CSSProperties = {
            position: 'absolute',
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            ...enterStyle(element.enter.kind, progress, scale),
            ...(pulse !== 1 ? { transform: `scale(${pulse})` } : {}),
            transformOrigin: 'center',
          }
          const underlineProgress =
            element.emphasis === 'underline' ? enterProgress(frame, fps, atMs + 500) : undefined

          switch (element.kind) {
            case 'text':
              return (
                <div
                  key={element.id}
                  style={{
                    ...base,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent:
                      element.align === 'center'
                        ? 'center'
                        : element.align === 'end'
                          ? 'flex-end'
                          : 'flex-start',
                    ...typeStyle(typography[element.role], box.fontPx ?? 32, 1),
                    color: tokenColor(element.color, brand),
                    textAlign: element.align,
                    // One line, clipped — never wrapped. `fitFontPx` sizes text to the
                    // box WIDTH and stops at a legibility floor, so a long string used to
                    // wrap to two or three lines, overflow its box downwards and draw
                    // straight over its neighbour. The board's preview never showed it,
                    // because SVG <text> does not wrap: the producer approved one line and
                    // the render shipped three. Clipping is what the preview already does,
                    // so this is the render agreeing with the approved picture.
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ position: 'relative', display: 'inline-block' }}>
                    {element.content}
                    {underlineProgress !== undefined ? (
                      <UnderlineBar
                        fontPx={roleFontPx(element.role, box.fontPx ?? 32, brand)}
                        progress={underlineProgress}
                        color={colors.accent}
                        frame={{ width, height }}
                      />
                    ) : null}
                  </span>
                </div>
              )
            case 'figure': {
              const shown =
                element.enter.kind === 'count'
                  ? countedValue(element.value, progress)
                  : element.value
              return (
                <div
                  key={element.id}
                  style={{
                    ...base,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'flex-start',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span
                    style={{
                      ...typeStyle(typography.numbers, box.fontPx ?? 96, 1),
                      color: tokenColor(element.color, brand),
                      position: 'relative',
                    }}
                  >
                    {shown}
                    {underlineProgress !== undefined ? (
                      <UnderlineBar
                        fontPx={roleFontPx('numbers', box.fontPx ?? 96, brand)}
                        progress={underlineProgress}
                        color={colors.accent}
                        frame={{ width, height }}
                      />
                    ) : null}
                  </span>
                  {element.label ? (
                    <span
                      style={{
                        ...typeStyle(typography.captions, figureLabelBasePx({ width, height }), 1),
                        color: colors.textSecondary,
                        marginTop: figureLabelGapPx({ width, height }),
                      }}
                    >
                      {element.label}
                    </span>
                  ) : null}
                </div>
              )
            }
            case 'logo': {
              const logo = payload.logos[element.id]
              if (!logo) return null
              return (
                <div
                  key={element.id}
                  style={{
                    ...base,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Img
                    src={mediaUrl(logo)}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                </div>
              )
            }
            case 'shape': {
              const colour = withAlpha(tokenColor(element.color, brand), element.opacity)
              if (element.form === 'rule') {
                return (
                  <div
                    key={element.id}
                    style={{
                      ...base,
                      height: ruleThicknessPx({ width, height }),
                      top: box.y + box.h / 2,
                      backgroundColor: colour,
                    }}
                  />
                )
              }
              return (
                <div
                  key={element.id}
                  style={{
                    ...base,
                    backgroundColor: colour,
                    borderRadius: element.form === 'disc' ? '50%' : 0,
                  }}
                />
              )
            }
            case 'bars': {
              const max = Math.max(...element.items.map((item) => Math.abs(item.value)), 1)
              const grow = enterProgress(frame, fps, atMs, BAR_GROW_MS)
              const { rowH, labelPx } = barsGeometry(box, element.items.length, { width, height })
              return (
                <div key={element.id} style={base}>
                  {element.items.map((item, index) => {
                    const lit =
                      element.highlightIndex === undefined || element.highlightIndex === index
                    const colour = lit
                      ? tokenColor(element.color, brand)
                      : withAlpha(colors.textSecondary, 0.5)
                    const barW = barLengthPx(box.w, Math.abs(item.value) / max, grow)
                    return (
                      <div
                        key={item.label}
                        style={{
                          position: 'absolute',
                          top: rowH * index,
                          height: rowH,
                          width: box.w,
                          display: 'flex',
                          alignItems: 'center',
                          gap: barsGapPx({ width, height }),
                        }}
                      >
                        <span
                          style={{
                            ...typeStyle(typography.captions, labelPx, 1),
                            color: colors.textSecondary,
                            width: box.w * 0.2,
                            textAlign: 'end',
                          }}
                        >
                          {item.label}
                        </span>
                        <div style={{ height: rowH * 0.5, width: barW, backgroundColor: colour }} />
                        <span
                          style={{
                            ...typeStyle(typography.numbers, labelPx * 1.2, 1),
                            color: colors.textPrimary,
                          }}
                        >
                          {item.display}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            }
          }
        })}
      </div>
    </AbsoluteFill>
  )
}
