import type { ClaimRow } from '@boom-busters/db'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DossierReview } from './dossier-review'

/**
 * The inline-claims dossier (decision 196): the document renders as
 * formatted text, anchored claims are pressable highlights that open a
 * modal, and everything the matcher cannot place stays reachable in the
 * bar. The anchoring maths itself is tested in lib/dossier-markdown.test.ts;
 * this file tests that the screen wires it to the claim actions.
 */

const quarantineClaim = vi.fn()
const editClaim = vi.fn()
const verifyClaimAction = vi.fn()
const quarantineAllBlocking = vi.fn()
const refresh = vi.fn()

vi.mock('./actions', () => ({
  quarantineClaim: (...args: unknown[]) => quarantineClaim(...args),
  editClaim: (...args: unknown[]) => editClaim(...args),
  verifyClaimAction: (...args: unknown[]) => verifyClaimAction(...args),
  quarantineAllBlocking: (...args: unknown[]) => quarantineAllBlocking(...args),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

beforeEach(() => {
  vi.clearAllMocks()
  quarantineClaim.mockResolvedValue({ ok: true })
})

function claim(patch: Partial<ClaimRow>): ClaimRow {
  return {
    id: 'claim-1',
    dossierId: 'dossier-1',
    text: 'Wirecard filed for insolvency in June 2020.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'sourced',
    quarantined: false,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    ...patch,
  }
}

const MD = [
  '# Wirecard — research dossier',
  '',
  '## Summary',
  '',
  'Wirecard filed for insolvency in June 2020. The company had **overstated** its balances for years.',
].join('\n')

describe('DossierReview', () => {
  it('renders the markdown as structure, not as source text', () => {
    render(<DossierReview projectId="p1" contentMd={MD} claims={[]} />)

    expect(
      screen.getByRole('heading', { level: 3, name: 'Wirecard — research dossier' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'Summary' })).toBeInTheDocument()
    // The bold run is an element, and no literal markers leak through.
    expect(screen.getByText('overstated').tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
  })

  it('highlights an anchored claim and opens its actions in a modal', async () => {
    const user = userEvent.setup()
    render(<DossierReview projectId="p1" contentMd={MD} claims={[claim({})]} />)

    const highlight = screen.getByRole('button', { name: /Review claim: Wirecard filed/ })
    await user.click(highlight)

    const dialog = screen.getByRole('dialog', { name: 'Claim' })
    expect(within(dialog).getByText('ft.com')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /Quarantine/ }))
    expect(quarantineClaim).toHaveBeenCalledWith('p1', 'claim-1', true)
  })

  it('always lists a blocking claim the text never states', () => {
    const missing = claim({
      id: 'claim-2',
      text: 'Jan Marsalek is alleged to have maintained contacts with foreign intelligence services.',
      sourceUrl: null,
      confidence: 'unverified',
    })
    render(<DossierReview projectId="p1" contentMd={MD} claims={[missing]} />)

    expect(screen.getByText(/1 still block approval/)).toBeInTheDocument()
    expect(screen.getByText(/1 not found in the text/)).toBeInTheDocument()
    // Its row — and therefore its Quarantine button — is on screen without
    // any toggling, because an unfindable blocker still holds the gate.
    expect(screen.getByText(missing.text)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Quarantine$/ })).toBeInTheDocument()
  })

  it('keeps non-blocking claims out of the bar until the list is asked for', async () => {
    const user = userEvent.setup()
    const sourced = claim({})
    render(<DossierReview projectId="p1" contentMd={MD} claims={[sourced]} />)

    // Highlighted in the document, but no row in the bar.
    expect(screen.queryByText('ft.com')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'List all 1 claims' }))
    expect(screen.getByText('ft.com')).toBeInTheDocument()
  })

  it('strikes a quarantined claim through in the document rather than hiding it', () => {
    render(<DossierReview projectId="p1" contentMd={MD} claims={[claim({ quarantined: true })]} />)
    const highlight = screen.getByRole('button', { name: /Review claim: Wirecard filed/ })
    expect(highlight.querySelector('span')?.className).toContain('line-through')
  })

  it('says plainly when the dossier is empty', () => {
    render(<DossierReview projectId="p1" contentMd="" claims={[]} />)
    expect(screen.getByText('The dossier is empty.')).toBeInTheDocument()
    expect(screen.getByText(/No claims were extracted/)).toBeInTheDocument()
  })
})
