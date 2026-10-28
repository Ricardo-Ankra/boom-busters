import { FIRST_CHANNEL_IN_USE } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { LIFT_CASES } from './lift-cases'

describe('the lift cases', () => {
  it('have unique kebab-case names', () => {
    const names = LIFT_CASES.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })
})

describe.each(LIFT_CASES)('$name', (c) => {
  it('composes exactly the captured prompt from the first channel', async () => {
    await expect(JSON.stringify(c.build(FIRST_CHANNEL_IN_USE), null, 2) + '\n').toMatchFileSnapshot(
      `./__fixtures__/${c.name}.json`,
    )
  })
})
