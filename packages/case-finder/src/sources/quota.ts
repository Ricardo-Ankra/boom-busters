/**
 * The YouTube Data API gives a fixed number of units a day. The ledger is a
 * hard stop, not a meter: a spend that would pass the allowance throws before
 * it is counted, so a run can never push the key over quota and into a
 * Google-side lockout. Persisting `spentToday` across runs is the caller's job.
 */
export class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotaExhaustedError'
  }
}

export interface QuotaLedger {
  /** Count `units`, or throw `QuotaExhaustedError` without counting them. */
  spend(units: number): void
  remaining(): number
}

export function createQuotaLedger(dailyUnits: number, spentToday: number): QuotaLedger {
  let spent = spentToday
  return {
    spend(units) {
      if (spent + units > dailyUnits) {
        throw new QuotaExhaustedError(
          `YouTube quota: spending ${units} units would pass the daily ${dailyUnits} ` +
            `(${dailyUnits - spent} left)`,
        )
      }
      spent += units
    },
    remaining() {
      return dailyUnits - spent
    },
  }
}
