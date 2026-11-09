import { EXAMPLE_SLOT_IDS, FIRST_CHANNEL_IN_USE } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildDigestRequest, mockDigest } from './digest'
import type { DigestLine } from './digest'
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

  it('the digest request names a report frozen this week', () => {
    const line: DigestLine = {
      label: 'The audit',
      targetType: 'master',
      views: 1200,
      viewsDelta: 300,
      avgViewDurationSec: 210,
      topSource: 'BROWSE',
      worstDropPct: null,
      searchReport: { checkpoint: 28, outcome: 'hit-then-left', label: 'Hit, then left' },
    }
    const plain: DigestLine = { ...line, label: 'Other' }
    delete plain.searchReport
    const request = buildDigestRequest({
      bible: FIRST_CHANNEL_IN_USE,
      weekOf: '2026-10-26',
      lines: [line, plain],
    })
    const content = request.messages[0]!.content as string
    expect(content).toContain('Day 28 search report: Hit, then left')
    expect(content.match(/search report/g)).toHaveLength(1)
    expect(mockDigest({ weekOf: '2026-10-26', lines: [line] })).toContain(
      'Day 28 search report: Hit, then left',
    )
  })
})
