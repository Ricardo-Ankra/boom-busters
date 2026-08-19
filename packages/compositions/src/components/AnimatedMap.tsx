import { useMemo } from 'react'
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens, SlotPayload } from '@boom-busters/schemas'
import { fitBounds, graticule, interpolateBounds, landPaths, projector, scaleBounds } from '../geo'
import { easeInOut, msToFrames, polylineProgressPoints } from '../lib/motion'
import { frameScale, typeStyle } from './brand'

export type MapPayload = Extract<SlotPayload, { kind: 'map' }>

/**
 * The map component (spec section 8.3): real land outlines from the bundled
 * Natural Earth geometry — the same module the visual board's MapPreview
 * draws — with a camera that settles from a wider window onto the locations,
 * a route that draws on afterwards, and markers that pop in sequence. It
 * animates itself, which is why the compiler gives map slots `static` motion
 * (decision 120). No tiles, no network, no API key.
 */
export function AnimatedMap({
  payload,
  brand,
  durationInFrames,
}: {
  payload: MapPayload
  brand: BrandKitTokens
  durationInFrames: number
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const { colors, typography } = brand

  const tMs = (frame / fps) * 1000
  const slotMs = (durationInFrames / fps) * 1000

  // Camera: settle from 1.35× wider onto the fitted window in the first
  // 2.5 s (or 40% of a short slot), eased both ways.
  const fitted = useMemo(() => fitBounds(payload.locations), [payload.locations])
  const widest = useMemo(() => scaleBounds(fitted, 1.35), [fitted])
  const settleMs = Math.min(2500, slotMs * 0.4)
  const camera = interpolateBounds(widest, fitted, easeInOut(Math.min(1, tMs / settleMs)))
  const { x, y } = projector(camera, width, height)
  const grid = graticule(camera)

  /**
   * The land is projected ONCE, for the widest camera, and the settle is an
   * affine transform on the group — the projection is linear in lon/lat, so
   * the two are pixel-identical. Rebuilding every world path string per
   * frame was fine in the offline render and dropped the @remotion/player
   * below real time in a browser (found on the first production preview,
   * 2026-08-19). Strokes keep screen width via vector-effect.
   */
  const landD = useMemo(() => landPaths(widest, width, height), [widest, width, height])
  const spanLon = camera.east - camera.west
  const spanLat = camera.north - camera.south
  const landTransform =
    `translate(${(((widest.west - camera.west) / spanLon) * width).toFixed(4)} ` +
    `${(((camera.north - widest.north) / spanLat) * height).toFixed(4)}) ` +
    `scale(${((widest.east - widest.west) / spanLon).toFixed(6)} ` +
    `${((widest.north - widest.south) / spanLat).toFixed(6)})`

  // The route draws on once the camera has mostly settled.
  const routeStartMs = settleMs * 0.8
  const routeMs = Math.max(400, slotMs * 0.35)
  const routeProgress = easeInOut(Math.min(1, Math.max(0, (tMs - routeStartMs) / routeMs)))
  const routePoints = payload.locations.map((location) => ({
    x: x(location.lon),
    y: y(location.lat),
  }))
  const drawnRoute = polylineProgressPoints(routePoints, routeProgress)

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <g transform={landTransform}>
          {landD.map((d, index) => (
            <path
              key={index}
              d={d}
              fill={colors.surface}
              fillRule="evenodd"
              stroke={colors.textSecondary}
              strokeOpacity={0.35}
              strokeWidth={1.5 * scale}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>

        {grid.lons.map((lon) => (
          <line
            key={`lon${lon}`}
            x1={x(lon)}
            x2={x(lon)}
            y1={0}
            y2={height}
            stroke={colors.textSecondary}
            strokeOpacity={0.1}
          />
        ))}
        {grid.lats.map((lat) => (
          <line
            key={`lat${lat}`}
            x1={0}
            x2={width}
            y1={y(lat)}
            y2={y(lat)}
            stroke={colors.textSecondary}
            strokeOpacity={0.1}
          />
        ))}

        {payload.route && drawnRoute.length > 1 ? (
          <>
            <polyline
              points={drawnRoute.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={colors.accent}
              strokeOpacity={0.25}
              strokeWidth={10 * scale}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={drawnRoute.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={colors.accent}
              strokeWidth={4 * scale}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : null}

        {payload.locations.map((location, index) => {
          // Markers pop in sequence once the camera has begun settling.
          const appearFrame = msToFrames(settleMs * 0.6 + index * 280, fps)
          const pop = spring({
            frame: frame - appearFrame,
            fps,
            config: { damping: 14, mass: 0.6 },
          })
          if (pop <= 0) return null
          const cx = x(location.lon)
          const cy = y(location.lat)
          return (
            <g key={location.label} transform={`translate(${cx} ${cy}) scale(${pop})`}>
              <circle r={16 * scale} fill={colors.accent} fillOpacity={0.25} />
              <circle r={8 * scale} fill={colors.accent} />
              <text
                x={14 * scale}
                y={-12 * scale}
                style={{
                  ...typeStyle(typography.captions, 26, scale),
                  fill: colors.textPrimary,
                  stroke: colors.background,
                  strokeWidth: 6 * scale,
                  paintOrder: 'stroke',
                }}
              >
                {location.label}
              </text>
            </g>
          )
        })}
      </svg>
    </AbsoluteFill>
  )
}
