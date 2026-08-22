import type { Timeline } from '@boom-busters/schemas'
import { DocumentaryMaster } from './DocumentaryMaster'

/**
 * The vertical composition (spec section 8.3). One renderer serves both
 * formats, deliberately: everything format-specific — the 9:16 canvas, the
 * re-clocked windows, the caption safe zones, the endCta ending — arrives
 * inside the timeline the Short compiler produced, and the slot components
 * cover-crop into whatever canvas the composition gives them. A second
 * renderer would be a second place for the two formats to drift apart.
 *
 * Registered under its own id so the broker addresses `ShortVertical`
 * explicitly and Studio shows the vertical fixture beside the master.
 */
export function ShortVertical({ timeline }: { timeline: Timeline }) {
  return <DocumentaryMaster timeline={timeline} />
}
