import { describe, expect, it } from 'vitest'
import { createQuotaLedger, QuotaExhaustedError } from './quota'

describe('quota ledger', () => {
  it('reports what is left after spending', () => {
    const ledger = createQuotaLedger(10_000, 2_500)
    expect(ledger.remaining()).toBe(7_500)
    ledger.spend(100)
    expect(ledger.remaining()).toBe(7_400)
  })

  it('throws QuotaExhaustedError when a spend would pass the daily units, before spending', () => {
    const ledger = createQuotaLedger(100, 90)
    expect(() => ledger.spend(11)).toThrow(QuotaExhaustedError)
    expect(ledger.remaining()).toBe(10)
    ledger.spend(10)
    expect(ledger.remaining()).toBe(0)
  })
})
