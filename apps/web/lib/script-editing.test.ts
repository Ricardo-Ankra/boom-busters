import { describe, expect, it } from 'vitest'
import {
  applyHunks,
  diffChapters,
  formatDuration,
  hedgeSentence,
  placeWarnings,
  replaceSentence,
  runtimeDelta,
} from './script-editing'

describe('diffChapters', () => {
  it('finds nothing to do when the text is unchanged', () => {
    const diff = diffChapters('One. Two.', 'One. Two.')
    expect(diff.hunks).toHaveLength(0)
  })

  it('pairs a rewritten sentence into a single hunk', () => {
    // Two hunks would let a reviewer accept the addition and reject the
    // removal, ending up with both versions in the script.
    const diff = diffChapters('One. Two. Three.', 'One. Two rewritten. Three.')

    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0]?.removed).toEqual(['Two.'])
    expect(diff.hunks[0]?.added).toEqual(['Two rewritten.'])
  })

  it('reports a pure insertion', () => {
    const diff = diffChapters('One. Three.', 'One. Two. Three.')

    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0]?.removed).toEqual([])
    expect(diff.hunks[0]?.added).toEqual(['Two.'])
  })

  it('reports a pure deletion', () => {
    const diff = diffChapters('One. Two. Three.', 'One. Three.')

    expect(diff.hunks[0]?.removed).toEqual(['Two.'])
    expect(diff.hunks[0]?.added).toEqual([])
  })

  it('separates changes that are not adjacent', () => {
    const diff = diffChapters('A. B. C. D.', 'A changed. B. C. D changed.')
    expect(diff.hunks).toHaveLength(2)
  })
})

describe('applyHunks', () => {
  const before = 'One. Two. Three.'
  const after = 'One. Two rewritten. Three.'
  const diff = diffChapters(before, after)

  it('returns the original exactly when nothing is accepted', () => {
    // The property that makes "Reject all" safe to click.
    expect(applyHunks(diff, new Set())).toBe(before)
  })

  it('returns the new version when everything is accepted', () => {
    expect(applyHunks(diff, new Set([0]))).toBe(after)
  })

  it('applies only the accepted hunk of several', () => {
    const two = diffChapters('A. B. C. D.', 'A changed. B. C. D changed.')

    const firstOnly = applyHunks(two, new Set([0]))
    expect(firstOnly).toContain('A changed.')
    expect(firstOnly).toContain('D.')
    expect(firstOnly).not.toContain('D changed.')
  })

  it('drops a sentence when a deletion hunk is accepted', () => {
    const deletion = diffChapters('One. Two. Three.', 'One. Three.')
    expect(applyHunks(deletion, new Set([0]))).toBe('One. Three.')
  })

  it('keeps a sentence when a deletion hunk is rejected', () => {
    const deletion = diffChapters('One. Two. Three.', 'One. Three.')
    expect(applyHunks(deletion, new Set())).toBe('One. Two. Three.')
  })
})

describe('placeWarnings', () => {
  const content = 'Enron filed for bankruptcy. The auditors signed it anyway.'

  it('locates a warning by its sentence', () => {
    const [placed] = placeWarnings(content, [
      { kind: 'unsourced-claim', sentence: 'The auditors signed it anyway.', message: 'No claim.' },
    ])

    expect(placed?.sentenceIndex).toBe(1)
    expect(content.slice(placed!.start, placed!.end)).toBe('The auditors signed it anyway.')
  })

  it('still matches after a punctuation fix in the sentence', () => {
    // Matching by hash rather than string equality is what makes a warning
    // survive the human tidying the text it points at.
    const edited = 'Enron filed for bankruptcy. The auditors signed it anyway!'
    const [placed] = placeWarnings(edited, [
      { kind: 'unsourced-claim', sentence: 'The auditors signed it anyway.', message: 'No claim.' },
    ])

    expect(placed?.sentenceIndex).toBe(1)
  })

  it('reports a genuinely rewritten sentence as missing rather than dropping it', () => {
    // A warning that vanishes when you edit near it teaches you to edit near it.
    const [placed] = placeWarnings('Something else entirely.', [
      { kind: 'unsourced-claim', sentence: 'The auditors signed it anyway.', message: 'No claim.' },
    ])

    expect(placed?.start).toBe(-1)
    expect(placed?.sentenceIndex).toBe(-1)
  })

  it('places every warning in a chapter with repeated sentences', () => {
    const repeated = 'Same. Different. Same.'
    const placed = placeWarnings(repeated, [
      { kind: 'unsourced-claim', sentence: 'Different.', message: 'x' },
    ])

    expect(placed[0]?.sentenceIndex).toBe(1)
  })

  it('returns nothing for no warnings', () => {
    expect(placeWarnings(content, [])).toEqual([])
  })
})

describe('hedgeSentence', () => {
  it('hedges a bare assertion', () => {
    expect(hedgeSentence('The CEO knew about the losses.')).toBe(
      'Reportedly, the CEO knew about the losses.',
    )
  })

  it('leaves a sentence that already hedges alone', () => {
    // Double-hedging reads as evasive and is not an improvement.
    const already = 'The CEO allegedly knew about the losses.'
    expect(hedgeSentence(already)).toBe(already)
    expect(hedgeSentence('According to filings, he knew.')).toBe('According to filings, he knew.')
  })

  it('always returns something hedged, even for an awkward sentence', () => {
    // A fix that silently does nothing leaves the sentence as dangerous as it
    // was, which is worse than an awkward one.
    expect(hedgeSentence('Fraud.')).toMatch(/^Reportedly, /)
  })
})

describe('replaceSentence', () => {
  it('replaces only the target, leaving the rest byte-identical', () => {
    expect(replaceSentence('One. Two. Three.', 'Two.', 'Rewritten.')).toBe('One. Rewritten. Three.')
  })

  it('returns the text unchanged when the sentence is gone', () => {
    expect(replaceSentence('One. Two.', 'Missing.', 'x')).toBe('One. Two.')
  })
})

describe('runtimeDelta', () => {
  it('reports how far over or under the target the script runs', () => {
    const over = runtimeDelta([{ estRuntimeSec: 600 }, { estRuntimeSec: 700 }], 18)
    expect(over.totalSec).toBe(1300)
    expect(over.deltaSec).toBe(220)

    const under = runtimeDelta([{ estRuntimeSec: 60 }], 18)
    expect(under.deltaSec).toBeLessThan(0)
  })

  it('handles a script with no chapters yet', () => {
    expect(runtimeDelta([], 18).totalSec).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formats as minutes and padded seconds', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(600)).toBe('10:00')
  })

  it('formats a negative delta by magnitude — the sign is the caller word', () => {
    expect(formatDuration(-65)).toBe('1:05')
  })
})
