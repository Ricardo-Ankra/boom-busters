import { cleanup, render, screen, within } from '@testing-library/react'
import type { SearchBrief } from '@boom-busters/schemas'
import { afterEach, describe, expect, it } from 'vitest'
import { VerdictCard } from './verdict-card'

/** The verdict card: five checks with their reasons, each linking to its evidence. */

function brief(overrides: Partial<SearchBrief> = {}): SearchBrief {
  return {
    subject: 'Wirecard',
    measuredAt: '2026-11-04T10:00:00.000Z',
    targetKeyword: {
      keyword: 'wirecard documentary',
      volume: 64,
      competition: 38,
      overall: 63,
      estimatedMonthlySearch: 6200,
      growthPct: null,
      fit: 'fits',
      intent: 'wants the story of the collapse',
      topic: 'wirecard collapse',
    },
    secondaryKeywords: [],
    searchedQuestions: [],
    outliers: [],
    titlePatterns: [],
    toldAlready: [],
    angleOptions: [
      {
        angle: 'The auditors who signed off for a decade.',
        keyword: '',
        answers: [],
        gap: 'A gap.',
      },
    ],
    chosenAngle: null,
    formatKey: null,
    fit: { inScope: true, pillarKey: 'con', reason: 'A fraud.' },
    searchedTitles: [],
    otherLanguages: [],
    recommendedAngle: null,
    recommendationReason: null,
    ownAngle: false,
    ...overrides,
  }
}

afterEach(cleanup)

describe('VerdictCard', () => {
  it('shows five checks with reasons and links to their evidence', () => {
    render(<VerdictCard brief={brief()} caseCategory="con" />)
    const rows = within(screen.getByRole('list')).getAllByRole('link')
    expect(rows).toHaveLength(5)
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '#evidence-intent',
      '#evidence-angle',
      '#evidence-fit',
      '#evidence-demand',
      '#evidence-competition',
    ])
    const [intent, angle, fit, demand, competition] = rows
    expect(intent).toHaveTextContent('Intent')
    expect(intent).toHaveTextContent(
      'Searchers for "wirecard documentary" want what this channel makes',
    )
    expect(angle).toHaveTextContent('Angle evidence')
    expect(fit).toHaveTextContent('Channel fit')
    expect(demand).toHaveTextContent('Demand')
    expect(demand).toHaveTextContent('6,200 searches a month for wirecard collapse')
    expect(competition).toHaveTextContent('Competition')
    expect(competition).toHaveTextContent('Not checked for this keyword')
  })

  it('states each result in words, so colour is never the only signal', () => {
    render(<VerdictCard brief={brief()} caseCategory="con" />)
    const links = screen.getAllByRole('link')
    expect(within(links[0]!).getByText('OK')).toHaveClass('sr-only')
    expect(within(links[4]!).getByText('Warning')).toHaveClass('sr-only')
  })

  it('says Problem for a failed check', () => {
    render(<VerdictCard brief={brief({ angleOptions: [] })} caseCategory="con" />)
    expect(within(screen.getAllByRole('link')[1]!).getByText('Problem')).toBeInTheDocument()
  })

  it('shows the old-brief line instead of a verdict', () => {
    const old = brief({
      targetKeyword: {
        keyword: 'wirecard documentary',
        volume: 64,
        competition: 38,
        overall: 63,
        estimatedMonthlySearch: 6200,
        growthPct: null,
      },
    })
    render(<VerdictCard brief={old} caseCategory="con" />)
    expect(
      screen.getByText(
        'Researched before the full checks. Research again for intent, demand and competition evidence.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('checks the chosen angle, else the recommended one', () => {
    const options = [
      { angle: 'The auditors who signed off for a decade.', keyword: '', answers: [], gap: 'g' },
      { angle: 'One short seller against the whole market.', keyword: '', answers: [], gap: 'g' },
    ]
    render(
      <VerdictCard
        brief={brief({
          angleOptions: options,
          chosenAngle: null,
          recommendedAngle: 1,
          nicheTests: [
            { angle: options[1]!.angle, verdict: 'v', direct: true, evidence: [], notes: '' },
          ],
        })}
        caseCategory="con"
      />,
    )
    expect(screen.getAllByRole('link')[1]).toHaveTextContent('A niche test found direct evidence')
  })
})
