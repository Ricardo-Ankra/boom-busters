import { isMockKey } from '@boom-busters/db'
import { TimelineSchema } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'

/**
 * Browser-preview materialisation (build spec section 8.2: "The browser
 * preview does the same materialisation server-side with short-lived
 * URLs"). Canonical timeline in — keys only — and a copy the `@remotion/
 * player` can actually play comes out, every reference resolved to a URL.
 *
 * The compositions THROW on an unmaterialised reference, by design: a
 * render must never quietly skip media. A preview is different — it exists
 * to be looked at now, with whatever is resolvable now — so anything that
 * cannot be resolved is dropped from the copy and counted, and the screen
 * says "N items not previewable" instead of crashing the player.
 *
 * Resolution, in order:
 * - `mock://voice/<takeId>.wav` → the app's own voice-audio route, which
 *   regenerates mock bytes on play (same trick the voice review uses).
 * - a real storage key → `presign` (absent when R2 is not configured).
 * - a stable `externalUrl` → passes through as the URL.
 */

export interface MaterialiseDeps {
  /** Absolute origin for app-served URLs (the mock voice route). */
  origin: string
  /** Presigned GET for a real storage key, or null when R2 is absent. */
  presign: ((key: string) => Promise<string>) | null
}

export interface PreviewTimeline {
  timeline: Timeline
  /** What the preview could not resolve, for the screen to say so. */
  dropped: { narration: number; slots: number; music: boolean }
}

const MOCK_TAKE = /^mock:\/\/voice\/(.+)\.wav$/

async function resolveKey(key: string, deps: MaterialiseDeps): Promise<string | null> {
  const mockTake = MOCK_TAKE.exec(key)
  if (mockTake) return `${deps.origin}/api/voice-takes/${mockTake[1]}/audio`
  if (isMockKey(key)) return null
  return deps.presign ? deps.presign(key) : null
}

export async function materialiseForPreview(
  canonical: Timeline,
  deps: MaterialiseDeps,
): Promise<PreviewTimeline> {
  const timeline: Timeline = structuredClone(canonical)
  const dropped = { narration: 0, slots: 0, music: false }

  const narration: Timeline['narration'] = []
  for (const segment of timeline.narration) {
    const url = await resolveKey(segment.r2Key, deps)
    if (url === null) {
      dropped.narration += 1
      continue
    }
    narration.push({ ...segment, url })
  }
  timeline.narration = narration

  if (timeline.music) {
    const url = await resolveKey(timeline.music.r2Key, deps)
    if (url === null) {
      // The preview simply has no bed; the picker still offers one.
      timeline.music = null
      dropped.music = true
    } else {
      timeline.music = { ...timeline.music, url }
    }
  }

  const slots: Timeline['slots'] = []
  for (const slot of timeline.slots) {
    if (slot.payload.kind === 'chart' || slot.payload.kind === 'map') {
      slots.push(slot)
      continue
    }
    const src = slot.payload.src
    const url =
      src.r2Key !== undefined ? await resolveKey(src.r2Key, deps) : (src.externalUrl ?? null)
    if (url === null) {
      dropped.slots += 1
      continue
    }
    slots.push({ ...slot, payload: { ...slot.payload, src: { ...src, url } } })
  }
  timeline.slots = slots

  // The contract demands at least one slot and one narration segment — true
  // of anything compiled — but a preview that DROPPED things is allowed to
  // fall below those minimums and still mount the player over what is left,
  // so the re-parse (a well-formedness check on the URLs we just wrote) only
  // runs when nothing was dropped.
  const intact = dropped.narration === 0 && dropped.slots === 0 && !dropped.music
  return { timeline: intact ? TimelineSchema.parse(timeline) : timeline, dropped }
}
