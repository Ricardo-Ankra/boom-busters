import { mergeSettings } from '@boom-busters/db'
import { DEFAULT_SETTINGS, SettingsPatchSchema } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { settingsErrorMessage } from './settings-error'

/**
 * A rule that spans two fields is checked when the merged row is parsed, not
 * at the patch's edge (final review of plan 1, issue 2): its refusal must
 * reach the owner as "path: message", never as Zod's JSON.
 */
describe('settingsErrorMessage', () => {
  it('names the field and the rule for a cross-field refusal', () => {
    let caught: unknown
    try {
      mergeSettings(DEFAULT_SETTINGS, SettingsPatchSchema.parse({ motion: { stillMaxMs: 1000 } }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(settingsErrorMessage(caught)).toBe(
      'motion.stillMaxMs: the still limit must be at least the change cadence',
    )
  })

  it('passes any other error through by its message', () => {
    expect(settingsErrorMessage(new Error('the database is away'))).toBe('the database is away')
    expect(settingsErrorMessage('what')).toBe('Could not save settings')
  })
})
