import { describe, expect, it } from 'vitest'
import { GRADE_FILTER } from './DocumentaryMaster'

describe('GRADE_FILTER (decision 285)', () => {
  it('leaves an ungraded film alone', () => {
    expect(GRADE_FILTER.none).toBeUndefined()
  })

  it('mutes photographs, and strong goes further', () => {
    expect(GRADE_FILTER.muted).toMatch(/saturate\(0\.\d+\)/)
    const sat = (f: string | undefined) => Number(/saturate\(([\d.]+)\)/.exec(f ?? '')?.[1])
    expect(sat(GRADE_FILTER.strong)).toBeLessThan(sat(GRADE_FILTER.muted))
  })
})
