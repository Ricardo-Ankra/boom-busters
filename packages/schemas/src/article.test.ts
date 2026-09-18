import { describe, expect, it } from 'vitest'
import {
  ArticleMetadataSchema,
  articleIsRenderable,
  articleSourceLabel,
  emphasisFits,
  normaliseArticleUrl,
  suggestEmphasis,
} from './article'
import type { ArticleMetadata } from './article'

const RECORD: ArticleMetadata = {
  url: 'https://financialrecord.example/2023/03/14/auditors',
  outlet: 'The Financial Record',
  headline: 'Auditors cannot find the $1.9 billion the company says it holds',
  author: 'Elena Marsh',
  publishedAt: '2023-03-14',
  description: null,
  provenance: { headline: 'jsonld', outlet: 'og' },
  status: 'fetched',
  failureReason: null,
}

describe('ArticleMetadataSchema', () => {
  it('parses a fetched record', () => {
    expect(ArticleMetadataSchema.parse(RECORD)).toEqual(RECORD)
  })

  it('accepts a record with nothing on it but a failure', () => {
    const failed = ArticleMetadataSchema.parse({
      url: RECORD.url,
      outlet: null,
      headline: null,
      author: null,
      publishedAt: null,
      description: null,
      status: 'failed',
      failureReason: 'The publisher returned 403',
    })
    expect(failed.provenance).toEqual({})
  })

  it('refuses a timestamp where a date belongs', () => {
    expect(
      ArticleMetadataSchema.safeParse({ ...RECORD, publishedAt: '2023-03-14T06:02:11Z' }).success,
    ).toBe(false)
  })
})

describe('normaliseArticleUrl', () => {
  it('folds the ways one article is shared into one row', () => {
    expect(normaliseArticleUrl('https://WWW.FT.example/content/abc?utm_source=twitter#top')).toBe(
      'https://ft.example/content/abc',
    )
    expect(normaliseArticleUrl('https://ft.example/content/abc/')).toBe(
      'https://ft.example/content/abc',
    )
  })

  it('keeps a parameter that identifies the article', () => {
    expect(normaliseArticleUrl('https://news.example/story.php?id=4821&utm_medium=email')).toBe(
      'https://news.example/story.php?id=4821',
    )
  })

  it('preserves path case, because publishers serve case-sensitive paths', () => {
    expect(normaliseArticleUrl('https://news.example/Business/Story-A')).toBe(
      'https://news.example/Business/Story-A',
    )
  })

  it('refuses anything that is not a web address', () => {
    expect(normaliseArticleUrl('mailto:tips@news.example')).toBeNull()
    expect(normaliseArticleUrl('FT, June 2020')).toBeNull()
    expect(normaliseArticleUrl('  ')).toBeNull()
  })
})

describe('articleSourceLabel', () => {
  it('drops the scheme', () => {
    expect(articleSourceLabel('https://ft.example/content/abc')).toBe('ft.example/content/abc')
  })

  it('elides the middle of a long address, keeping the slug', () => {
    const label = articleSourceLabel(
      'https://news.example/business/2023/03/14/auditors-cannot-find-the-money-in-escrow',
    )
    expect(label.length).toBeLessThanOrEqual(48)
    expect(label.startsWith('news.example/')).toBe(true)
    expect(label.endsWith('money-in-escrow')).toBe(true)
  })
})

describe('suggestEmphasis', () => {
  it('finds the money, with its scale word', () => {
    expect(suggestEmphasis('Auditors cannot find the $1.9 billion the company says it holds')).toBe(
      '$1.9 billion',
    )
    expect(suggestEmphasis('Shares fall 41% after the board backs its chief executive')).toBe('41%')
    expect(suggestEmphasis('Regulator freezes €500m of client money')).toBe('€500m')
  })

  it('takes the first figure when a headline carries two', () => {
    expect(suggestEmphasis('A $4 billion valuation and 41% growth, both invented')).toBe(
      '$4 billion',
    )
  })

  it('has nothing to say about a headline with no figure', () => {
    expect(suggestEmphasis('Auditors resign over the accounts')).toBeNull()
  })
})

describe('emphasisFits', () => {
  it('matches across the whitespace the renderer collapses', () => {
    expect(emphasisFits('Auditors cannot  find the  money', 'cannot find')).toBe(true)
  })

  it('refuses a paraphrase', () => {
    expect(emphasisFits('Auditors cannot find the money', 'could not find')).toBe(false)
    expect(emphasisFits('Auditors cannot find the money', '   ')).toBe(false)
  })
})

describe('articleIsRenderable', () => {
  it('needs the outlet, the headline and the date', () => {
    expect(articleIsRenderable(RECORD)).toBe(true)
    expect(articleIsRenderable({ ...RECORD, publishedAt: null })).toBe(false)
    expect(articleIsRenderable({ ...RECORD, outlet: null })).toBe(false)
  })

  it('does not need a byline, because plenty of reporting has none', () => {
    expect(articleIsRenderable({ ...RECORD, author: null })).toBe(true)
  })
})
