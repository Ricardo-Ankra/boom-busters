'use client'

import * as React from 'react'
import { SET_PLATE_DIRECTIONS } from '@boom-busters/schemas'
import type { SetCamera, SetPlateDirection } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { editBriefAction } from './visuals-actions'
import type { ActionResult } from './visuals-actions'

/**
 * Where the camera stands in a set shot (decision 275). The planner writes
 * it; this row lets the owner move it before regenerating. Saving goes
 * through `editBriefAction`, which changes the brief — so the slot owes work
 * again and Regenerate uses the new camera and the plates nearest it.
 */

const LABELS: Record<SetPlateDirection, string> = {
  north: 'North',
  east: 'East',
  south: 'South',
  west: 'West',
}

export function CameraRow({
  slotId,
  projectId,
  camera,
  busy,
  act,
}: {
  slotId: string
  projectId: string
  camera: SetCamera | undefined
  busy: boolean
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
}) {
  const [facing, setFacing] = React.useState<SetPlateDirection>(camera?.facing ?? 'north')
  const [position, setPosition] = React.useState(camera?.position ?? '')
  const [lens, setLens] = React.useState(camera?.lens ?? '')
  const ready = position.trim().length >= 3

  // SlotCard is keyed by slot.id, which does not change when the server
  // writes a fresh camera onto the same slot (a re-plan, or another tab's
  // save) — so state cannot init-from-prop-on-mount alone, or the row keeps
  // showing stale (or "no camera yet") after the brief has moved on.
  // Watching the camera's own fields, not its object identity, which is a
  // new reference on every render regardless of whether the stored camera
  // actually changed.
  React.useEffect(() => {
    setFacing(camera?.facing ?? 'north')
    setPosition(camera?.position ?? '')
    setLens(camera?.lens ?? '')
  }, [camera?.facing, camera?.position, camera?.lens])

  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[var(--color-text-secondary)]">Camera</span>
        {camera ? null : (
          <span className="text-[12px] text-[var(--color-text-muted)]">
            No camera yet; set one, or re-plan.
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Facing">
        {SET_PLATE_DIRECTIONS.map((direction) => (
          <Button
            key={direction}
            variant={facing === direction ? 'selected' : 'ghost'}
            aria-pressed={facing === direction}
            onClick={() => setFacing(direction)}
          >
            {LABELS[direction]}
          </Button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <div className="space-y-1">
          <Label htmlFor={`camera-${slotId}-position`}>Position</Label>
          <Input
            id={`camera-${slotId}-position`}
            value={position}
            maxLength={120}
            placeholder="the south doorway, seated eye height"
            onChange={(event) => setPosition(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`camera-${slotId}-lens`}>Lens</Label>
          <Input
            id={`camera-${slotId}-lens`}
            value={lens}
            maxLength={40}
            placeholder="35mm"
            onChange={(event) => setLens(event.target.value)}
          />
        </div>
      </div>
      <div>
        <Button
          variant="outline"
          disabled={!ready}
          busy={busy}
          onClick={() =>
            void act(
              slotId,
              () =>
                editBriefAction(projectId, slotId, {
                  camera: {
                    facing,
                    position: position.trim(),
                    ...(lens.trim() ? { lens: lens.trim() } : {}),
                  },
                }),
              'Camera saved',
            )
          }
        >
          Save camera
        </Button>
      </div>
    </div>
  )
}
