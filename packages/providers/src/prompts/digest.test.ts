import { EXAMPLE_SLOT_IDS, FIRST_CHANNEL_IN_USE } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildDigestRequest } from './digest'
import { PSYCHOLOGY_TEST_BIBLE } from './lift/psychology-bible'

describe('buildDigestRequest', () => {
  it("names the channel's own subject", () => {
    const first = buildDigestRequest({
      bible: FIRST_CHANNEL_IN_USE,
      weekOf: '2026-10-26',
      lines: [],
    })
    expect(first.system).toContain('channel about corporate collapses.')
    const other = buildDigestRequest({
      bible: { bible: PSYCHOLOGY_TEST_BIBLE, slotIds: EXAMPLE_SLOT_IDS },
      weekOf: '2026-10-26',
      lines: [],
    })
    expect(other.system).toContain(
      `channel about ${PSYCHOLOGY_TEST_BIBLE.examples['digest-channel-subject']!}.`,
    )
    expect(other.system).not.toContain('corporate collapses')
  })
})
