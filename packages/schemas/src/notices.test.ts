import { describe, expect, it } from 'vitest'
import { AnswerDeclined, ValidationError } from './errors'
import { noticesFor } from './notices'
import type { Notice } from './notices'

const notice = (over: Partial<Notice>): Notice => ({
  id: '01J0000000000000000000000A',
  projectId: '01J0000000000000000000000P',
  subject: 'direction',
  subjectId: null,
  kind: 'trimmed',
  message: 'Trimmed to fit: era rule 1.',
  createdAt: new Date('2026-10-09T10:00:00Z'),
  ...over,
})

describe('notices (decision 293)', () => {
  it('picks the notices for one subject, and for one item of it', () => {
    const book = notice({ id: '01J0000000000000000000000B' })
    const slotA = notice({ id: '01J0000000000000000000000C', subject: 'slot', subjectId: 'A' })
    const slotB = notice({ id: '01J0000000000000000000000D', subject: 'slot', subjectId: 'B' })
    const all = [book, slotA, slotB]
    expect(noticesFor(all, 'direction')).toEqual([book])
    expect(noticesFor(all, 'slot', 'B')).toEqual([slotB])
    expect(noticesFor(all, 'slot')).toEqual([])
  })

  it('makes a deliberate decline a ValidationError, so existing catches still see a refusal', () => {
    const declined = new AnswerDeclined('there are no numbers to chart', { field: 'brief' })
    expect(declined).toBeInstanceOf(ValidationError)
    expect(declined.message).toBe('there are no numbers to chart')
    expect(declined.field).toBe('brief')
  })
})
