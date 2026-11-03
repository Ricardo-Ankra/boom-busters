import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CohesionReport } from '@boom-busters/schemas'
import { CohesionPanel } from './cohesion-panel'

const report: CohesionReport = {
  cells: {
    title: { topic: 'hit', format: 'miss', pillar: 'none' },
    descriptionOpening: { topic: 'hit', format: 'hit', pillar: 'none' },
    tags: { topic: 'miss', format: 'miss', pillar: 'none' },
    hashtags: { topic: 'none', format: 'hit', pillar: 'none' },
    spokenIntro: { topic: 'hit', format: 'miss', pillar: 'none' },
  },
  gaps: ['No pillar keywords set', 'No channel hashtag set'],
}

describe('CohesionPanel', () => {
  it('renders five rows and three columns with words for every cell', () => {
    render(<CohesionPanel report={report} />)
    const table = screen.getByRole('table')
    for (const column of ['Topic', 'Format', 'Pillar']) {
      expect(within(table).getByRole('columnheader', { name: column })).toBeTruthy()
    }
    const rows = within(table)
      .getAllByRole('row')
      .filter((row) => within(row).queryAllByRole('rowheader').length > 0)
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Title',
      'Description opening',
      'Tags',
      'Hashtags',
      'Spoken intro',
    ])
    expect(within(table).getAllByText('Yes')).toHaveLength(5)
    expect(within(table).getAllByText('No')).toHaveLength(4)
    expect(within(table).getAllByText('Not set')).toHaveLength(6)
  })

  it('lists each gap and holds no button', () => {
    render(<CohesionPanel report={report} />)
    expect(screen.getByText('No pillar keywords set')).toBeTruthy()
    expect(screen.getByText('No channel hashtag set')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
