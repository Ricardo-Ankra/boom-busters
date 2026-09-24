/**
 * The spend cap on a live harness run (decision 275; the owner's rule: at
 * most $1 per test, and ask before more). Every paid call reserves its
 * estimate first and is refused if the run would pass the cap; `record`
 * replaces the reservation with what the call actually cost.
 */
export class BudgetExceeded extends Error {}

export class LiveBudget {
  private readonly items: { label: string; usd: number; settled: boolean }[] = []

  constructor(private readonly capUsd: number) {}

  get spentUsd(): number {
    return this.items.reduce((total, item) => total + item.usd, 0)
  }

  get entries(): { label: string; usd: number }[] {
    return this.items.map(({ label, usd }) => ({ label, usd }))
  }

  reserve(label: string, estimateUsd: number): void {
    const next = this.spentUsd + estimateUsd
    if (next > this.capUsd + 1e-9) {
      throw new BudgetExceeded(
        `${label} would take this run to $${next.toFixed(2)}, past its $${this.capUsd.toFixed(2)} cap. ` +
          'Ask the owner before spending more.',
      )
    }
    this.items.push({ label, usd: estimateUsd, settled: false })
  }

  record(label: string, actualUsd: number): void {
    const item = this.items.find((entry) => entry.label === label && !entry.settled)
    if (item) {
      item.usd = actualUsd
      item.settled = true
    } else {
      this.items.push({ label, usd: actualUsd, settled: true })
    }
  }
}
