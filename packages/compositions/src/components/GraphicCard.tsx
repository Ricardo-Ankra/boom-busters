import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'
import type { BrandKitTokens, GraphicElement, GraphicPayload } from '@boom-busters/schemas'
import {
  barLengthPx,
  barsGeometry,
  countedValue,
  enterProgress,
  graphicLayout,
  ruleThicknessPx,
  tokenColor,
  type ElementBox,
} from '../lib/graphic'
import { markerSweep, mediaUrl } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from './brand'

/**
 * A composed graphic (decision 268, Plan B). Every box and font size comes
 * from `graphicLayout`, and the bars and rule shapes take their remaining
 * geometry (row height, bar length, line thickness) from the same module, so
 * what was approved is what renders. Each element enters at its own offset;
 * a figure may count up; an emphasis is a single pulse or the headline
 * card's highlighter sweep. Logos are drawn as they are: contained, never
 * stretched, never recoloured.
 */

const PULSE_AT_MS = 600
const PULSE_MS = 360
const BAR_GROW_MS = 700

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
}: {
  payload: GraphicPayload
  brand: BrandKitTokens
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const boxes = graphicLayout(payload.scene, { width, height }, brand)
  const byId = new Map(boxes.map((box) => [box.id, box]))
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
      {payload.scene.elements.map((element) => {
        const box = byId.get(element.id) as ElementBox
        const progress = enterProgress(frame, fps, element.enter.atMs)
        const pulse = element.emphasis === 'pulse' ? pulseScale(frame, fps, element.enter.atMs) : 1
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
        const underline =
          element.emphasis === 'underline'
            ? markerSweep(colors.accent, enterProgress(frame, fps, element.enter.atMs + 500))
            : {}

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
                }}
              >
                <span style={underline}>{element.content}</span>
              </div>
            )
          case 'figure': {
            const shown =
              element.enter.kind === 'count' ? countedValue(element.value, progress) : element.value
            return (
              <div
                key={element.id}
                style={{
                  ...base,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                }}
              >
                <span
                  style={{
                    ...typeStyle(typography.numbers, box.fontPx ?? 96, 1),
                    color: tokenColor(element.color, brand),
                    ...underline,
                  }}
                >
                  {shown}
                </span>
                {element.label ? (
                  <span
                    style={{
                      ...typeStyle(typography.captions, 24 * scale, 1),
                      color: colors.textSecondary,
                      marginTop: 6 * scale,
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
                style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
            const grow = enterProgress(frame, fps, element.enter.atMs, BAR_GROW_MS)
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
                        gap: 12 * scale,
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
    </AbsoluteFill>
  )
}
