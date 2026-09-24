'use client'

import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import * as React from 'react'
import type { SlotCandidate } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'

/**
 * How a candidate is shown, wherever candidates are offered: the visual
 * board's slots and the Set card's generated plates. One module so the two
 * cannot drift. They did once: the Set card read `thumbUrl` alone, which only
 * mock generations carry, so every live plate candidate rendered blank.
 */

/**
 * The best URL for a thumbnail. A live generation has no `thumbUrl`: its
 * bytes sit in R2 behind an asset row, reached through the asset route.
 */
export function candidateThumb(candidate: SlotCandidate): string | undefined {
  if (candidate.thumbUrl) return candidate.thumbUrl
  if (candidate.assetId) return `/api/assets/${candidate.assetId}/file`
  if (candidate.sourceUrl.startsWith('data:') || candidate.sourceUrl.startsWith('http')) {
    return candidate.sourceUrl
  }
  return undefined
}

/**
 * The best URL for the ENLARGED view, which is not the thumbnail's order:
 * bytes we hold (stills, uploads) beat the provider's full-size URL, and the
 * small thumb is the last resort rather than the first. Mock candidates'
 * `mock://` sources fall through to their data: thumbs.
 */
export function candidateFull(candidate: SlotCandidate): string | undefined {
  if (candidate.assetId) return `/api/assets/${candidate.assetId}/file`
  if (candidate.sourceUrl.startsWith('data:') || candidate.sourceUrl.startsWith('http')) {
    return candidate.sourceUrl
  }
  return candidate.thumbUrl
}

/**
 * The enlarged view of a list of candidates: one at a time at real size, with
 * the same choose action the strip has. Judging a picture at thumbnail size
 * and committing to it full-screen are different acts, and the second is the
 * one that matters. Videos play here (muted, looped), which a strip cannot do.
 */
export function CandidateLightbox({
  label,
  caption,
  candidates,
  index,
  onIndexChange,
  onClose,
  isChosen,
  chooseLabel,
  chosenLabel,
  onChoose,
  chooseDisabled = false,
  busy,
}: {
  /** The dialog's accessible name. */
  label: string
  /** The line above the picture: what the candidate is for. */
  caption: string
  candidates: readonly SlotCandidate[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  isChosen: (candidate: SlotCandidate) => boolean
  chooseLabel: string
  chosenLabel: string
  onChoose: (candidate: SlotCandidate) => void
  /** Choosing is refused for a reason the caller owns, such as a full set. */
  chooseDisabled?: boolean
  busy: boolean
}) {
  const closeRef = React.useRef<HTMLButtonElement | null>(null)
  const candidate = candidates[index]

  // Escape closes, on top of the visible Close button, never instead of it.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  React.useEffect(() => {
    closeRef.current?.focus()
  }, [])

  if (!candidate) return null
  const full = candidateFull(candidate)
  const chosen = isChosen(candidate)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(event) => {
        // The backdrop, not anything inside the panel.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-[960px] flex-col gap-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--color-text-secondary)]">{caption}</p>
            <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
              {candidate.kind}
              {candidate.score !== undefined ? ` · score ${Math.round(candidate.score)}` : ''}
              {` · candidate ${index + 1} of ${candidates.length}`}
            </p>
          </div>
          <Button ref={closeRef} variant="ghost" onClick={onClose}>
            <X aria-hidden />
            Close
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center rounded-[8px] bg-[var(--color-background)]">
          {full && candidate.kind === 'video' ? (
            // Muted + looped: this is a framing check, and the narration is
            // the scrubber's job. Provider CDN URLs are fine here: the
            // board's preview is exactly what they are for.
            <video
              src={full}
              controls
              autoPlay
              muted
              loop
              playsInline
              className="max-h-[60vh] max-w-full rounded-[8px]"
              aria-label={candidate.summary ?? candidate.id}
            />
          ) : full ? (
            // Plain <img> on purpose: provider-CDN and data: sources, which
            // next/image can neither optimise nor allowlist.
            <img
              src={full}
              alt={candidate.summary ?? candidate.id}
              className="max-h-[60vh] max-w-full rounded-[8px] object-contain"
            />
          ) : (
            <p className="p-8 text-[13px] text-[var(--color-text-muted)]">
              This candidate has no previewable media URL.
            </p>
          )}
        </div>

        <p className="text-[11px] text-[var(--color-text-muted)]">
          {candidate.licence}
          {candidate.attributionText ? ` · ${candidate.attributionText}` : ''}
          {candidate.references && candidate.references.length > 0
            ? ` · reference: ${candidate.references.join(', ')}`
            : ''}
          {candidate.summary ? ` · ${candidate.summary}` : ''}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={index === 0}
              onClick={() => onIndexChange(index - 1)}
            >
              <ChevronLeft aria-hidden />
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={index >= candidates.length - 1}
              onClick={() => onIndexChange(index + 1)}
            >
              Next
              <ChevronRight aria-hidden />
            </Button>
          </div>
          <Button
            variant="primary"
            disabled={chosen || chooseDisabled}
            busy={busy}
            onClick={() => onChoose(candidate)}
          >
            {chosen ? chosenLabel : chooseLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
