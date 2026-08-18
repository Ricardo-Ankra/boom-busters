import { canonicalTimelineIssues, timelineDurationMs, TimelineSchema } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { FIXTURE_AUDIO_SILENCE, FIXTURE_IMAGE_SKYLINE } from './media'
import { FIXTURE_TIMELINE } from './timeline'

describe('the fixture timeline', () => {
  it('is a valid Timeline under the contract schema', () => {
    const parsed = TimelineSchema.parse(JSON.parse(JSON.stringify(FIXTURE_TIMELINE)))
    expect(timelineDurationMs(parsed)).toBe(14000)
  })

  it('is a MATERIALISED copy — the canonical guard must flag it', () => {
    // The fixture carries data-URI media so Studio needs no network. That
    // makes it exactly what the canonical guard exists to catch: a timeline
    // with resolved URLs must never be stored as canonical.
    const issues = canonicalTimelineIssues(FIXTURE_TIMELINE)
    expect(issues).toContain('narration.0.url')
    expect(issues).toContain('music.url')
    expect(issues).toContain('slots.0.payload.src.url')
  })
})

describe('fixture media', () => {
  it('images and audio are self-contained data URIs', () => {
    expect(FIXTURE_IMAGE_SKYLINE.startsWith('data:image/svg+xml')).toBe(true)
    expect(FIXTURE_AUDIO_SILENCE.startsWith('data:audio/wav;base64,')).toBe(true)
    // A whole second of silence, so Studio playback has something to play.
    expect(FIXTURE_AUDIO_SILENCE.length).toBeGreaterThan(10_000)
  })
})
