export type CohesionRow = 'title' | 'descriptionOpening' | 'tags' | 'hashtags' | 'spokenIntro'
export type CohesionColumn = 'topic' | 'format' | 'pillar'
/** `none`: the column has no keywords to look for. */
export type CohesionCell = 'hit' | 'miss' | 'none'

export interface CohesionInput {
  title: string
  description: string
  tags: readonly string[]
  hashtags: readonly string[]
  spokenIntro: string
  topic: readonly string[]
  formatKeywords: readonly string[]
  pillar: { label: string; keywords: readonly string[] } | null
  channelHashtag: string
}

export interface CohesionReport {
  cells: Record<CohesionRow, Record<CohesionColumn, CohesionCell>>
  gaps: string[]
}

const DESCRIPTION_OPENING_CHARS = 150

const normalise = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

/** Whether the row's text holds any keyword; a row of hashtags compares with spaces removed. */
function matches(rowText: string | readonly string[], keywords: readonly string[]): boolean {
  if (typeof rowText === 'string') {
    const text = normalise(rowText)
    return keywords.some((k) => {
      const key = normalise(k)
      return key !== '' && text.includes(key)
    })
  }
  const tags = rowText.map((h) => normalise(h).replace(/^#/, ''))
  return keywords.some((k) => {
    const key = normalise(k).replace(/ /g, '')
    return key !== '' && tags.some((tag) => tag.includes(key))
  })
}

/** Where the topic, format and pillar keywords show up across the publish copy. Warn only. */
export function cohesionReport(input: CohesionInput): CohesionReport {
  const columns: Record<CohesionColumn, readonly string[]> = {
    topic: input.topic,
    format: input.formatKeywords,
    pillar: input.pillar ? [input.pillar.label, ...input.pillar.keywords] : [],
  }
  const rows: Record<CohesionRow, string | readonly string[]> = {
    title: input.title,
    descriptionOpening: input.description.slice(0, DESCRIPTION_OPENING_CHARS),
    tags: input.tags.join(', '),
    hashtags: input.hashtags,
    spokenIntro: input.spokenIntro,
  }
  const cell = (row: CohesionRow, column: CohesionColumn): CohesionCell =>
    columns[column].length === 0 ? 'none' : matches(rows[row], columns[column]) ? 'hit' : 'miss'
  const cells = {} as CohesionReport['cells']
  for (const row of Object.keys(rows) as CohesionRow[]) {
    cells[row] = {
      topic: cell(row, 'topic'),
      format: cell(row, 'format'),
      pillar: cell(row, 'pillar'),
    }
  }

  const gaps: string[] = []
  if (input.formatKeywords.length === 0) gaps.push('No format keywords set')
  if (!input.pillar || input.pillar.keywords.length === 0) gaps.push('No pillar keywords set')
  if (input.channelHashtag.trim() === '') gaps.push('No channel hashtag set')
  return { cells, gaps }
}
