import { describe, expect, it } from 'vitest'
import { BudgetExceeded, LiveBudget } from './live-budget'

describe('LiveBudget', () => {
  it('lets calls through while the estimate fits, and records what they cost', () => {
    const budget = new LiveBudget(1)
    budget.reserve('sheet', 0.24)
    budget.record('sheet', 0.24)
    budget.reserve('shot', 0.07)
    budget.record('shot', 0.07)
    expect(budget.spentUsd).toBeCloseTo(0.31)
    expect(budget.entries).toEqual([
      { label: 'sheet', usd: 0.24, settled: true },
      { label: 'shot', usd: 0.07, settled: true },
    ])
  })

  it('keeps a reservation unsettled until it is recorded — a failed call still shows its estimate', () => {
    const budget = new LiveBudget(1)
    budget.reserve('sheet', 0.24)
    expect(budget.entries).toEqual([{ label: 'sheet', usd: 0.24, settled: false }])
  })

  it('refuses the call that would pass the cap, before it is made', () => {
    const budget = new LiveBudget(1)
    budget.reserve('a', 0.9)
    budget.record('a', 0.9)
    expect(() => budget.reserve('b', 0.24)).toThrow(BudgetExceeded)
    expect(() => budget.reserve('b', 0.24)).toThrow(
      'b would take this run to $1.14, past its $1.00 cap. Ask the owner before spending more.',
    )
    expect(budget.spentUsd).toBeCloseTo(0.9)
  })

  it('counts an unrecorded reservation, so two quick calls cannot both slip under', () => {
    const budget = new LiveBudget(0.5)
    budget.reserve('a', 0.3)
    expect(() => budget.reserve('b', 0.3)).toThrow(BudgetExceeded)
  })

  it('refuses a non-finite or non-positive cap, in defence of the $1 rule', () => {
    expect(() => new LiveBudget(Number.NaN)).toThrow()
    expect(() => new LiveBudget(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => new LiveBudget(0)).toThrow()
    expect(() => new LiveBudget(-1)).toThrow()
  })
})
