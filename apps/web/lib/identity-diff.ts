import type { MotionIdentity } from '@boom-busters/schemas'

/**
 * A proposed identity against the current one (spec 2026-11-04, section
 * 8.4): one row per field that changes, each value in words the Motion tab
 * already uses, so the owner reads the draft as a diff before Apply.
 */

export interface IdentityChange {
  field: keyof MotionIdentity
  label: string
  current: string
  proposed: string
}

const LABELS: { field: keyof MotionIdentity; label: string }[] = [
  { field: 'signatureEase', label: 'Signature easing' },
  { field: 'ms', label: 'Lengths' },
  { field: 'overshoot', label: 'Overshoot' },
  { field: 'entrance', label: 'Entrance' },
  { field: 'changeEveryMs', label: 'Change cadence (ms)' },
  { field: 'stillMaxMs', label: 'Still limit (ms)' },
  { field: 'cameraRule', label: 'The camera' },
  { field: 'blurFollowsSpeed', label: 'Blur follows speed' },
  { field: 'threeD', label: '3D' },
  { field: 'never', label: 'Never' },
  { field: 'allow', label: 'Allow' },
  { field: 'styleGuideMd', label: 'Style guide' },
  { field: 'techniques', label: 'Techniques in use' },
  { field: 'chartsConventional', label: 'Charts stay conventional' },
]

function words(value: MotionIdentity[keyof MotionIdentity]): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value === '' ? 'none' : value
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.join(', ')
  const lengths = Object.entries(value).filter(([, ms]) => ms !== undefined)
  return lengths.length === 0 ? 'house' : lengths.map(([key, ms]) => `${key} ${ms}`).join(', ')
}

export function identityDiff(current: MotionIdentity, proposed: MotionIdentity): IdentityChange[] {
  const changes: IdentityChange[] = []
  for (const { field, label } of LABELS) {
    const before = words(current[field])
    const after = words(proposed[field])
    if (before !== after) changes.push({ field, label, current: before, proposed: after })
  }
  return changes
}
