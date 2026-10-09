import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from '@boom-busters/cost'
import { LedgerTable } from './ledger-table'

/** The Costs screen names what a call was for: a retry's label sits beside its operation. */

const entry = (id: string, meta: Record<string, unknown>): LedgerEntry => ({
  id,
  provider: 'anthropic',
  operation: `llm.direction.${id}`,
  projectId: null,
  estimatedUsd: 0.5,
  actualUsd: 0.4,
  settled: true,
  meta,
  occurredAt: new Date('2026-10-09T08:00:00.000Z'),
})

describe('LedgerTable', () => {
  it("shows a retry's label beside its operation, and nothing extra on a first call", () => {
    render(
      <LedgerTable
        entries={[entry('first', {}), entry('again', { purpose: 'retry: refused' })]}
        activeProvider={null}
      />,
    )
    expect(screen.getByText('retry: refused')).toBeTruthy()
    expect(screen.queryAllByText(/^retry: /)).toHaveLength(1)
    expect(screen.queryByText('demo')).toBeNull()
  })

  it('still marks a demo row', () => {
    render(<LedgerTable entries={[entry('demo', { demo: true })]} activeProvider={null} />)
    expect(screen.getByText('demo')).toBeTruthy()
  })
})
