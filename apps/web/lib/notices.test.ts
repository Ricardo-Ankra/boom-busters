import { beforeEach, describe, expect, it, vi } from 'vitest'

const replaceNotices = vi.fn()
const addNotice = vi.fn()
vi.mock('@boom-busters/db', () => ({ replaceNotices, addNotice }))
vi.mock('@/lib/db', () => ({ db: { marker: 'db' } }))

const { recordRepairs, recordStop } = await import('./notices')

const target = { projectId: 'P', subject: 'direction' as const, subjectId: null }

describe('recording notices (decision 293)', () => {
  beforeEach(() => {
    replaceNotices.mockReset()
    addNotice.mockReset()
  })

  it('replaces the subject with one trimmed line when an answer was trimmed', async () => {
    await recordRepairs(target, [{ action: 'trimmed', field: 'era rule 1' }])
    expect(replaceNotices).toHaveBeenCalledWith({ marker: 'db' }, target, [
      { kind: 'trimmed', message: 'Trimmed to fit: era rule 1.' },
    ])
  })

  it('marks the line dropped when any item was dropped', async () => {
    await recordRepairs(target, [
      { action: 'trimmed', field: 'the summary' },
      { action: 'dropped', field: 'claim 3', reason: 'its text ran over 1,000 characters' },
    ])
    expect(replaceNotices.mock.calls[0]![2]).toEqual([
      {
        kind: 'dropped',
        message:
          'Trimmed to fit: the summary. Dropped claim 3: its text ran over 1,000 characters.',
      },
    ])
  })

  it('retires the old notes when a clean answer lands', async () => {
    await recordRepairs(target)
    expect(replaceNotices).toHaveBeenCalledWith({ marker: 'db' }, target, [])
  })

  it('adds a stop without retiring the notes already there', async () => {
    await recordStop(target, 'stopped', 'The redraft stopped: the answer was cut off.')
    expect(addNotice).toHaveBeenCalledWith({ marker: 'db' }, target, {
      kind: 'stopped',
      message: 'The redraft stopped: the answer was cut off.',
    })
    expect(replaceNotices).not.toHaveBeenCalled()
  })

  it('does not fail the work when the repairs cannot be recorded', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      replaceNotices.mockRejectedValue(new Error('connection lost'))
      await expect(
        recordRepairs(target, [{ action: 'trimmed', field: 'the summary' }]),
      ).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(
        '[notices] could not record a notice',
        target,
        expect.anything(),
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('does not fail the work when a stop cannot be recorded', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      addNotice.mockRejectedValue(new Error('connection lost'))
      await expect(recordStop(target, 'stopped', 'The redraft stopped.')).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
