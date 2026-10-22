import type { ClaimRow, ClaimSupportRow } from '@boom-busters/db'
import type { GroundedRef, GroundedResearch, Notice } from '@boom-busters/schemas'
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

// The notice line's own action (decision 293); `components/notices.test.tsx` tests it.
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))

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
    legalStatus: 'none',
    legalStatusDate: null,
    legalStatusDocumentId: null,
    series: null,
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

  it('shows what the research trimmed or dropped above the document (decision 293)', () => {
    const notice: Notice = {
      id: '01J0000000000000000000000N',
      projectId: 'p1',
      subject: 'dossier',
      subjectId: null,
      kind: 'dropped',
      message:
        "Trimmed to fit: the brief's summary. Dropped claim 37: its text ran over 1,000 characters.",
      createdAt: new Date('2026-10-09T10:00:00Z'),
    }
    render(<DossierReview projectId="p1" contentMd={MD} claims={[]} notices={[notice]} />)

    const line = screen.getByRole('status')
    expect(line).toHaveTextContent(
      "Trimmed to fit: the brief's summary. Dropped claim 37: its text ran over 1,000 characters.",
    )
    expect(screen.getByRole('button', { name: 'Dismiss note' })).toBeInTheDocument()
    // Above the document, where the owner starts reading.
    expect(
      line.compareDocumentPosition(screen.getByText('Dossier')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  describe('grounded research', () => {
    type Doc = NonNullable<Parameters<typeof DossierReview>[0]['documents']>[number]

    function support(patch: Partial<ClaimSupportRow>): ClaimSupportRow {
      return {
        id: 's1',
        claimId: 'claim-1',
        documentId: 'doc-1',
        rank: 1,
        quote: 'filed for insolvency',
        found: true,
        offset: 0,
        locatorSeconds: null,
        createdAt: new Date('2026-08-01'),
        ...patch,
      }
    }

    function doc(patch: Partial<Doc>): Doc {
      return {
        id: 'doc-1',
        url: 'https://example.com/filing',
        title: 'The annual filing',
        kind: 'filing',
        rank: 1,
        failure: null,
        ...patch,
      }
    }

    const noRef: GroundedRef = {
      documentId: null,
      url: null,
      found: false,
      locatorSeconds: null,
      quote: null,
    }

    function research(patch: Partial<GroundedResearch>): GroundedResearch {
      return {
        entity: { qid: null, titles: ['Wirecard'], cik: null, ticker: null, website: null },
        brief: { summary: 's', turningPoint: 't', cast: [], toldAlready: [], openQuestions: [] },
        scenes: [],
        answers: [],
        corpus: { read: 1, unread: 0, failed: 0 },
        ...patch,
      } as GroundedResearch
    }

    async function openClaim(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: /Review claim: Wirecard filed/ }))
      return screen.getByRole('dialog')
    }

    it('shows each support with its quote and whether it was found', async () => {
      const user = userEvent.setup()
      render(
        <DossierReview
          projectId="p1"
          contentMd={MD}
          claims={[claim({})]}
          documents={[doc({})]}
          supports={{
            'claim-1': [
              support({}),
              support({ id: 's2', rank: 2, quote: 'a missing line', found: false }),
            ],
          }}
        />,
      )
      const dialog = await openClaim(user)
      expect(within(dialog).getByText('filed for insolvency').tagName).toBe('BLOCKQUOTE')
      expect(within(dialog).getByText('Found in the document')).toBeInTheDocument()
      expect(within(dialog).getByText('Not found in the document')).toBeInTheDocument()
      expect(within(dialog).getAllByText('The annual filing')).toHaveLength(2)
    })

    it('links a video support at its timestamp', async () => {
      const user = userEvent.setup()
      render(
        <DossierReview
          projectId="p1"
          contentMd={MD}
          claims={[claim({})]}
          documents={[
            doc({
              id: 'v1',
              url: 'https://www.youtube.com/watch?v=abc',
              kind: 'video',
              title: 'V',
            }),
            doc({ id: 'v2', url: 'https://youtu.be/xyz', kind: 'video', title: 'W' }),
          ]}
          supports={{
            'claim-1': [
              support({ documentId: 'v1', locatorSeconds: 95 }),
              support({ id: 's2', rank: 2, documentId: 'v2', locatorSeconds: 12 }),
              support({ id: 's3', rank: 3, documentId: 'gone' }),
            ],
          }}
        />,
      )
      const dialog = await openClaim(user)
      const hrefs = within(dialog)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'))
      expect(hrefs).toContain('https://www.youtube.com/watch?v=abc&t=95')
      expect(hrefs).toContain('https://youtu.be/xyz?t=12')
    })

    it('shows the corpus line with unread and failed lists', () => {
      render(
        <DossierReview
          projectId="p1"
          contentMd={MD}
          claims={[]}
          research={research({
            entity: { ...research({}).entity, titles: ['Wirecard', 'Jan Marsalek'] },
          })}
          documents={[
            doc({ id: 'a', rank: 1 }),
            doc({ id: 'b', rank: 2, url: 'https://example.com/b' }),
            doc({ id: 'c', rank: null, url: 'https://example.com/unread' }),
            doc({ id: 'd', rank: null, url: 'https://example.com/broken', failure: 'timeout' }),
          ]}
        />,
      )
      expect(
        screen.getByText('Researched from: Wirecard, Jan Marsalek, 2 documents read'),
      ).toBeInTheDocument()
      expect(screen.getByText('1 gathered, not read')).toBeInTheDocument()
      expect(screen.getByText('1 could not be fetched')).toBeInTheDocument()
      expect(screen.getByText('https://example.com/unread')).toBeInTheDocument()
      expect(screen.getByText('https://example.com/broken')).toBeInTheDocument()
    })

    it('renders scenes from research with an unplaced marker', () => {
      const md = [MD, '', '## Timeline', '', '- **June 2020** markdown only entry'].join('\n')
      render(
        <DossierReview
          projectId="p1"
          contentMd={md}
          claims={[]}
          research={research({
            scenes: [
              {
                when: 'June 2020',
                who: 'Wirecard',
                what: 'The company filed for insolvency.',
                why: 'Because the cash was never there.',
                quote: 'q',
                ref: { ...noRef, url: 'https://example.com/filing', found: true },
              },
              {
                when: 'July 2020',
                who: 'Braun',
                what: 'The chief executive was arrested.',
                why: 'Prosecutors alleged fraud.',
                quote: 'q',
                ref: { ...noRef, url: 'https://example.com/arrest', found: false },
              },
            ],
          })}
        />,
      )
      expect(screen.queryByText(/markdown only entry/)).not.toBeInTheDocument()
      expect(screen.getByText(/The company filed for insolvency/)).toBeInTheDocument()
      expect(screen.getByText('Because the cash was never there.').tagName).toBe('EM')
      expect(screen.getAllByText('(unplaced)')).toHaveLength(1)
      const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
      expect(links).toContain('https://example.com/arrest')
      // The rest of the document still comes from the markdown.
      expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument()
    })

    it('renders empty corpus lists as plain lines and says "1 document read" in the singular', () => {
      const { container, rerender } = render(
        <DossierReview
          projectId="p1"
          contentMd={MD}
          claims={[]}
          research={research({})}
          documents={[doc({ id: 'a', rank: 1 })]}
        />,
      )
      expect(screen.getByText('Researched from: Wirecard, 1 document read')).toBeInTheDocument()
      expect(screen.getByText('0 gathered, not read')).toBeInTheDocument()
      expect(container.querySelector('summary')).toBeNull()

      rerender(
        <DossierReview
          projectId="p1"
          contentMd={MD}
          claims={[]}
          research={research({})}
          documents={[
            doc({ id: 'a', rank: 1 }),
            doc({ id: 'c', rank: null, url: 'https://example.com/unread' }),
          ]}
        />,
      )
      expect(container.querySelectorAll('summary')).toHaveLength(1)
      expect(container.querySelector('summary svg')).not.toBeNull()
    })

    it('keeps the markdown Timeline when research has no scenes', () => {
      const md = [MD, '', '## Timeline', '', '- **June 2020** markdown only entry'].join('\n')
      render(<DossierReview projectId="p1" contentMd={md} claims={[]} research={research({})} />)
      expect(screen.getByText(/markdown only entry/)).toBeInTheDocument()
    })

    it('renders an old dossier with no research from its markdown', () => {
      const md = [MD, '', '## Timeline', '', '- **June 2020** markdown only entry'].join('\n')
      render(<DossierReview projectId="p1" contentMd={md} claims={[]} />)
      expect(screen.getByText(/markdown only entry/)).toBeInTheDocument()
      expect(screen.queryByText(/Researched from/)).not.toBeInTheDocument()
    })
  })
})
