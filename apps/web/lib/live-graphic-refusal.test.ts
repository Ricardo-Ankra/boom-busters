import { describe, expect, it } from 'vitest'
import { refusalReasonOf } from './live-graphic-refusal'

describe('refusalReasonOf', () => {
  it('reads the reason out of the retry message, wherever it sits among the last messages', () => {
    const messages = [
      { content: 'The claims.' },
      {
        content:
          'Your previous answer for this slot was refused: element "f1" cites a claim not listed. Answer again with that fixed.',
      },
      { content: "The producer's steer: bigger." },
    ]
    expect(refusalReasonOf(messages)).toBe('element "f1" cites a claim not listed')
  })

  it('keeps a reason that has full stops of its own', () => {
    const messages = [
      {
        content:
          'Your previous answer for this slot was refused: two elements overlap. Move one. Answer again with that fixed.',
      },
    ]
    expect(refusalReasonOf(messages)).toBe('two elements overlap. Move one')
  })

  it('returns nothing for a first attempt', () => {
    expect(refusalReasonOf([{ content: 'The claims.' }])).toBeUndefined()
  })
})
