import { describe, expect, it } from 'vitest'
import { MAX_UNMATCHED_GAP_MS, normalizeWord, offsetCaptions, snapToScript } from './snap'
import type { AlignedWord } from './snap'

/** Evenly spaced heard words, 300 ms each, for fixture brevity. */
function heard(words: string[], stepMs = 300): AlignedWord[] {
  return words.map((text, index) => ({
    text,
    startMs: index * stepMs,
    endMs: index * stepMs + stepMs - 50,
  }))
}

describe('normalizeWord', () => {
  it('is case- and punctuation-insensitive but keeps letters and digits', () => {
    expect(normalizeWord('June,')).toBe('june')
    expect(normalizeWord('€1.9bn')).toBe('19bn')
    expect(normalizeWord('DAX-30')).toBe('dax30')
  })
})

describe('snapToScript', () => {
  it('takes text from the script and timings from the transcription', () => {
    const script = 'By June, the auditors could not find the money.'
    const result = snapToScript(
      script,
      heard(['by', 'june', 'the', 'auditors', 'could', 'not', 'find', 'the', 'money']),
    )

    expect(result.captions.map((caption) => caption.text)).toEqual([
      'By',
      'June,',
      'the',
      'auditors',
      'could',
      'not',
      'find',
      'the',
      'money.',
    ])
    expect(result.captions[1]).toMatchObject({ startMs: 300, endMs: 550 })
    expect(result.gaps).toEqual([])
  })

  it('survives a mistranscription: right moment, letters from the script', () => {
    // Whisper hears "nineteen billion euros"; the script wrote "€1.9bn".
    const script = 'EY could not locate €1.9bn in trustee accounts.'
    const result = snapToScript(
      script,
      heard(['ey', 'could', 'not', 'locate', 'nineteen', 'in', 'trustee', 'accounts']),
    )

    const disputed = result.captions[4]!
    expect(disputed.text).toBe('€1.9bn')
    // Aligned diagonally onto "nineteen" — its timing, our spelling.
    expect(disputed.startMs).toBe(4 * 300)
  })

  it('never lets a bracketed performance tag become a caption', () => {
    const script = 'The money was gone. [pause] All of it.'
    const result = snapToScript(script, heard(['the', 'money', 'was', 'gone', 'all', 'of', 'it']))
    expect(result.captions.map((caption) => caption.text)).not.toContain('[pause]')
    expect(result.captions).toHaveLength(7)
  })

  it('strips multi-word tags too — [long pause] reached the screen split in half', () => {
    // Whitespace-split tokens "[long" and "pause]" pass a whole-token tag
    // test; the markup must go before tokenising (first assembled preview).
    const script = '[long pause] The money was gone. [breathes deeply] All of it.'
    const result = snapToScript(script, heard(['the', 'money', 'was', 'gone', 'all', 'of', 'it']))
    const texts = result.captions.map((caption) => caption.text)
    expect(texts).toEqual(['The', 'money', 'was', 'gone.', 'All', 'of', 'it.'])
  })

  it('interpolates unheard words between their matched neighbours', () => {
    // "not find" unheard: two words share the span between "could" and "the".
    const script = 'By June the auditors could not find the money'
    const result = snapToScript(
      script,
      heard(['by', 'june', 'the', 'auditors', 'could', 'the', 'money']),
    )

    const not = result.captions[5]!
    const find = result.captions[6]!
    expect(not.startMs).toBeGreaterThanOrEqual(result.captions[4]!.endMs)
    expect(find.endMs).toBeLessThanOrEqual(result.captions[7]!.startMs)
    expect(not.endMs).toBe(find.startMs)
  })

  it('flags an unheard stretch longer than 1.5 s for the QC report', () => {
    // A big silent hole between the second and third heard words.
    const script = 'One two three four five six'
    const result = snapToScript(script, [
      { text: 'one', startMs: 0, endMs: 250 },
      { text: 'two', startMs: 300, endMs: 550 },
      { text: 'six', startMs: 4000, endMs: 4300 },
    ])

    expect(result.gaps).toHaveLength(1)
    expect(result.gaps[0]).toMatchObject({ startMs: 550, endMs: 4000, scriptWords: 3 })
    expect(result.gaps[0]!.endMs - result.gaps[0]!.startMs).toBeGreaterThan(MAX_UNMATCHED_GAP_MS)
  })
})

describe('offsetCaptions', () => {
  it('shifts a paragraph onto the project clock', () => {
    const result = snapToScript('Hello there', heard(['hello', 'there']))
    const shifted = offsetCaptions(result.captions, 8000)
    expect(shifted[0]).toMatchObject({ startMs: 8000, endMs: 8250, timestampMs: 8125 })
  })
})
