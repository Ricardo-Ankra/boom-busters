import { describe, expect, it } from 'vitest'
import { reopenOffered, reopenRefusal } from './visuals-reopen'

describe('reopenOffered', () => {
  it('offers Back to visuals on an approved board at every later stage, published included', () => {
    for (const stage of ['assembly', 'shorts', 'publish', 'done']) {
      expect(reopenOffered({ stage, stageStatus: 'approved', visualsPhase: 'board' })).toBe(true)
    }
  })

  it('never offers it while the board is still the current stage, or before it', () => {
    for (const stage of ['dossier', 'script', 'voice', 'visuals']) {
      expect(reopenOffered({ stage, stageStatus: 'awaiting_review', visualsPhase: 'board' })).toBe(
        false,
      )
    }
  })

  it('offers it on a visuals board that was stopped or failed (decision 323)', () => {
    // Restart stage would plan the board again and buy every shot; this is
    // the way back to the board as it stands.
    for (const stageStatus of ['cancelled', 'failed']) {
      expect(reopenOffered({ stage: 'visuals', stageStatus, visualsPhase: 'board' })).toBe(true)
      expect(
        reopenRefusal({ stage: 'visuals', stageStatus, visualsPhase: 'board' }, false),
      ).toBeNull()
    }
    expect(
      reopenOffered({ stage: 'visuals', stageStatus: 'cancelled', visualsPhase: 'plan' }),
    ).toBe(false)
  })

  it('never offers it without a board to reopen', () => {
    expect(reopenOffered({ stage: 'assembly', stageStatus: 'running', visualsPhase: 'plan' })).toBe(
      false,
    )
    expect(reopenOffered({ stage: 'assembly', stageStatus: 'running', visualsPhase: null })).toBe(
      false,
    )
  })
})

describe('reopenRefusal', () => {
  it('lets an approved board with nothing running reopen', () => {
    expect(
      reopenRefusal({ stage: 'done', stageStatus: 'approved', visualsPhase: 'board' }, false),
    ).toBeNull()
  })

  it('asks for a Stop first while a later stage has a run, parked or working', () => {
    expect(
      reopenRefusal({ stage: 'assembly', stageStatus: 'running', visualsPhase: 'board' }, true),
    ).toBe(
      'A later stage is still running or waiting for your review. Press Stop first, then ' +
        'Back to visuals.',
    )
  })

  it('says the board is already open at the visuals stage', () => {
    expect(
      reopenRefusal(
        { stage: 'visuals', stageStatus: 'awaiting_review', visualsPhase: 'board' },
        false,
      ),
    ).toBe('The board is already open.')
  })

  it('refuses a project that never reached the board', () => {
    expect(
      reopenRefusal({ stage: 'voice', stageStatus: 'approved', visualsPhase: null }, false),
    ).toBe('This project has not reached the visuals board yet.')
    expect(
      reopenRefusal({ stage: 'assembly', stageStatus: 'running', visualsPhase: null }, false),
    ).toBe('There is no approved board to reopen. Re-run the visuals stage instead.')
  })
})
