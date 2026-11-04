import { describe, expect, it } from 'vitest'
import { cohesionReport, type CohesionInput } from './cohesion'

const base: CohesionInput = {
  title: 'Cleopatra | History for Sleep',
  description: 'A calm history for sleep about Cleopatra.',
  tags: ['cleopatra', 'history for sleep'],
  hashtags: ['#HistoryForSleep'],
  spokenIntro: 'Tonight, Cleopatra.',
  topic: ['cleopatra'],
  formatKeywords: ['history for sleep'],
  pillar: { label: 'Ancient Egypt', keywords: [] },
  channelHashtag: '#HistoryForSleep',
}

describe('cohesionReport', () => {
  it('hits topic and format in a title that holds both', () => {
    const { cells } = cohesionReport(base)
    expect(cells.title.topic).toBe('hit')
    expect(cells.title.format).toBe('hit')
    expect(cells.title.pillar).toBe('miss')
  })
  it('matches the pillar label when the pillar has no keywords', () => {
    const { cells } = cohesionReport({ ...base, title: 'Ancient Egypt at Night' })
    expect(cells.title.pillar).toBe('hit')
  })
  it('marks the format column none and gaps first when no format keywords', () => {
    const report = cohesionReport({ ...base, formatKeywords: [] })
    for (const row of Object.values(report.cells)) expect(row.format).toBe('none')
    expect(report.gaps[0]).toBe('No format keywords set')
  })
  it('lists gaps in order, only when true', () => {
    expect(cohesionReport(base).gaps).toEqual(['No pillar keywords set'])
    expect(
      cohesionReport({ ...base, formatKeywords: [], pillar: null, channelHashtag: '' }).gaps,
    ).toEqual(['No format keywords set', 'No pillar keywords set', 'No channel hashtag set'])
  })
  it('marks the pillar column none when there is no pillar', () => {
    expect(cohesionReport({ ...base, pillar: null }).cells.title.pillar).toBe('none')
  })
  it('matches a hashtag with the keyword spaces removed', () => {
    expect(cohesionReport(base).cells.hashtags.format).toBe('hit')
    expect(cohesionReport({ ...base, hashtags: ['#Other'] }).cells.hashtags.format).toBe('miss')
  })
  it('reads only the first 150 characters of the description', () => {
    const late = `${'x'.repeat(150)}history for sleep`
    expect(cohesionReport({ ...base, description: late }).cells.descriptionOpening.format).toBe(
      'miss',
    )
    const edge = `${'x'.repeat(133)}history for sleep`
    expect(cohesionReport({ ...base, description: edge }).cells.descriptionOpening.format).toBe(
      'hit',
    )
  })
  it('collapses whitespace and case, and joins tags with a comma', () => {
    const r = cohesionReport({
      ...base,
      title: 'HISTORY   FOR\nSLEEP',
      tags: ['history', 'for sleep'],
    })
    expect(r.cells.title.format).toBe('hit')
    expect(r.cells.tags.format).toBe('miss')
  })
})
