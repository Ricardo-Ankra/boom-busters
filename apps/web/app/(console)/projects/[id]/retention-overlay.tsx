import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { MasterAnalytics } from '@/lib/publish-review'

/**
 * Retention vs chapters (build spec section 14.8): the master's audience
 * watch ratio drawn over the video's own chapter boundaries, so "where do
 * they leave" and "what was on screen there" are one picture. Server-rendered
 * SVG — the numbers change once a day, nothing here needs a client.
 */

const WIDTH = 800
const HEIGHT = 220
const PAD = { top: 12, right: 12, bottom: 24, left: 40 }

function x(pct: number): number {
  return PAD.left + (pct / 100) * (WIDTH - PAD.left - PAD.right)
}

function y(ratio: number): number {
  return PAD.top + (1 - Math.min(1, ratio)) * (HEIGHT - PAD.top - PAD.bottom)
}

export function RetentionOverlay({
  analytics,
  chapters,
  durationMs,
}: {
  analytics: MasterAnalytics
  chapters: { title: string; startMs: number }[]
  durationMs: number | null
}) {
  const curve = analytics.retentionCurve ?? []
  const marks =
    durationMs && durationMs > 0
      ? chapters.map((chapter, index) => ({
          number: index + 1,
          title: chapter.title,
          pct: Math.min(100, (chapter.startMs / durationMs) * 100),
        }))
      : []

  const path = curve
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.pct)},${y(point.ratio)}`)
    .join(' ')

  const snapshotDay = analytics.snapshotDateIso.slice(0, 10)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retention vs chapters</CardTitle>
        <CardDescription>
          {analytics.views !== null ? `${analytics.views.toLocaleString('en-GB')} views` : null}
          {analytics.avgViewDurationSec !== null
            ? ` · ${Math.round(analytics.avgViewDurationSec / 60)}m${String(
                analytics.avgViewDurationSec % 60,
              ).padStart(2, '0')}s average view`
            : null}
          {` · snapshot ${snapshotDay}, updated daily`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {curve.length < 2 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]" role="status">
            YouTube has no retention curve for this video yet — young videos report views first and
            the curve a day or two later.
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="w-full"
              role="img"
              aria-label={`Retention curve with ${marks.length} chapter boundaries`}
            >
              {/* The 100% and 50% gridlines — enough to read levels off. */}
              {[1, 0.5].map((ratio) => (
                <g key={ratio}>
                  <line
                    x1={x(0)}
                    x2={x(100)}
                    y1={y(ratio)}
                    y2={y(ratio)}
                    stroke="var(--color-border)"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={PAD.left - 6}
                    y={y(ratio) + 4}
                    textAnchor="end"
                    fontSize={11}
                    fill="var(--color-text-muted)"
                  >
                    {Math.round(ratio * 100)}%
                  </text>
                </g>
              ))}

              {/* Chapter boundaries under the curve, numbered. */}
              {marks.map((mark) => (
                <g key={mark.number}>
                  <line
                    x1={x(mark.pct)}
                    x2={x(mark.pct)}
                    y1={PAD.top}
                    y2={HEIGHT - PAD.bottom}
                    stroke="var(--color-border-strong)"
                  />
                  <text
                    x={x(mark.pct) + 4}
                    y={HEIGHT - PAD.bottom + 14}
                    fontSize={11}
                    fill="var(--color-text-secondary)"
                  >
                    {mark.number}
                  </text>
                </g>
              ))}

              <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
            </svg>

            {marks.length > 0 ? (
              <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--color-text-secondary)]">
                {marks.map((mark) => (
                  <li key={mark.number}>
                    <span className="font-mono">{mark.number}</span> {mark.title}
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
