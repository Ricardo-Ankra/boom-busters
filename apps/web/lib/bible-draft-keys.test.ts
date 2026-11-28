import { describe, expect, it } from 'vitest'
import { errorSection, flagSection } from './bible-draft-keys'

describe('errorSection', () => {
  it('maps unit keys to their section', () => {
    expect(errorSection('voice')).toBe('voice')
    expect(errorSection('hooks')).toBe('hooks')
    expect(errorSection('examples:script.ts')).toBe('examples')
    expect(errorSection('slot:script-close-hedge')).toBe('examples')
  })

  it('maps one field of a section drafted by field to that section', () => {
    expect(errorSection('hooks:openings')).toBe('hooks')
    expect(errorSection('hooks:titles')).toBe('hooks')
  })

  it('knows no section for an unknown key', () => {
    expect(errorSection('nothing')).toBeNull()
    expect(errorSection('nothing:hooks')).toBeNull()
  })
})

describe('flagSection', () => {
  it('maps list and example paths to their section', () => {
    expect(flagSection('titles.3')).toBe('hooks')
    expect(flagSection('examples.script-foreshadow')).toBe('examples')
    expect(flagSection('voiceDos.0')).toBeNull()
  })
})
