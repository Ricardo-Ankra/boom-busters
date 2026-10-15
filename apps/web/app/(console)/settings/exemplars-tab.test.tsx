import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import type { ExemplarView } from '@/lib/exemplar-views'
import { ExemplarsTab } from './exemplars-tab'

const TEMPLATE = {
  name: 'stat-counter',
  repository: 'reactvideoeditor/remotion-templates',
  url: 'https://github.com/reactvideoeditor/remotion-templates/blob/6209b72/templates/stat-counter.tsx',
  licence: 'MIT' as const,
}

const WRITTEN: ExemplarView = {
  technique: 'stat-counter',
  description: 'one large figure counting up to its mark, a label beneath, held',
  title: 'The 1.2bn raised',
  template: TEMPLATE,
  code: {
    version: 1,
    source: 'function Graphic() { return null }',
    compiled: 'function Graphic() { return null }',
    title: 'The 1.2bn raised',
    facts: [],
    words: [{ text: 'raised', atMs: 0 }],
    durationMs: 6000,
    motion: 1,
  },
}

const UNWRITTEN: ExemplarView = {
  technique: 'lower-third',
  description: 'a name and a role in a band at the bottom of the frame, sliding in and holding',
  template: { ...TEMPLATE, name: 'lower-third', url: 'https://example.test/lower-third.tsx' },
}

const BROKEN: ExemplarView = {
  technique: 'typewriter',
  description: 'a line typed out character by character with a cursor, then held',
  title: 'Delete everything',
  template: { ...TEMPLATE, name: 'Typewriter', url: 'https://example.test/typewriter.tsx' },
  issue: 'the code does not compile: Unexpected "}"',
}

const brand = DEFAULT_SETTINGS.brandKit

describe('ExemplarsTab (decision 305)', () => {
  it('says how many examples are written', () => {
    render(<ExemplarsTab exemplars={[WRITTEN, UNWRITTEN, BROKEN]} brand={brand} />)
    expect(screen.getByText('2 of 3 examples written')).toBeInTheDocument()
  })

  it('shows a written example with its title, its template and licence, and a Play button', () => {
    render(<ExemplarsTab exemplars={[WRITTEN]} brand={brand} />)
    const card = screen.getByRole('region', { name: 'Stat counter' })
    expect(within(card).getByText(WRITTEN.description)).toBeInTheDocument()
    expect(within(card).getByText('The 1.2bn raised')).toBeInTheDocument()
    const link = within(card).getByRole('link', { name: 'stat-counter' })
    expect(link).toHaveAttribute('href', TEMPLATE.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(within(card).getByText(/MIT licence/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Play example' })).toBeInTheDocument()
  })

  it('marks a technique with no design as not written, with nothing to play', () => {
    render(<ExemplarsTab exemplars={[UNWRITTEN]} brand={brand} />)
    const card = screen.getByRole('region', { name: 'Lower third' })
    expect(within(card).getByText('Not written yet')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Play example' })).not.toBeInTheDocument()
  })

  it('says why a stored design cannot play, rather than hiding it', () => {
    render(<ExemplarsTab exemplars={[BROKEN]} brand={brand} />)
    const card = screen.getByRole('region', { name: 'Typewriter' })
    expect(within(card).getByText(/does not compile/)).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Play example' })).not.toBeInTheDocument()
  })
})
