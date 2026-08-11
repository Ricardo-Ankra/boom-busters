import { describe, expect, it } from 'vitest'
import { approvalBlockedReason, blockingCount, blocksApproval, sourceDomain } from './claim-review'

const claim = (confidence: string, quarantined = false) =>
  ({ confidence, quarantined }) as never

describe('blocksApproval', () => {
  it('blocks on an unsourced claim nobody excluded', () => {
    expect(blocksApproval(claim('unverified'))).toBe(true)
  })

  it('stops blocking once the claim is quarantined', () => {
    // Quarantining is the human saying "keep it out of the script", which is
    // a decision, not an omission.
    expect(blocksApproval(claim('unverified', true))).toBe(false)
  })

  it('stops blocking once the claim has a source', () => {
    expect(blocksApproval(claim('single_source'))).toBe(false)
    expect(blocksApproval(claim('sourced'))).toBe(false)
  })

  it('does not block on a quarantined but sourced claim', () => {
    expect(blocksApproval(claim('sourced', true))).toBe(false)
  })
})

describe('blockingCount', () => {
  it('counts only what blocks', () => {
    expect(
      blockingCount([
        claim('unverified'),
        claim('unverified'),
        claim('unverified', true),
        claim('sourced'),
      ]),
    ).toBe(2)
  })

  it('is zero for an empty dossier', () => {
    expect(blockingCount([])).toBe(0)
  })
})

describe('approvalBlockedReason', () => {
  it('is undefined when nothing blocks, so no empty warning renders', () => {
    expect(approvalBlockedReason([claim('sourced')])).toBeUndefined()
  })

  it('says how many and what to do about it', () => {
    const reason = approvalBlockedReason([claim('unverified')])

    expect(reason).toContain('1 unsourced')
    // A disabled button that will not say why is worse than no button.
    expect(reason).toMatch(/verify or quarantine/)
  })
})

describe('sourceDomain', () => {
  it('shows the domain, not the query string', () => {
    expect(sourceDomain('https://www.sec.gov/litigation/complaints/2001/comp17.htm?x=1')).toBe(
      'sec.gov',
    )
  })

  it('strips only a leading www', () => {
    expect(sourceDomain('https://wwwx.example.com/a')).toBe('wwwx.example.com')
  })

  it('returns a malformed URL as-is rather than hiding it', () => {
    // A source that is not a URL is itself worth seeing on the row.
    expect(sourceDomain('see the filing')).toBe('see the filing')
  })
})
