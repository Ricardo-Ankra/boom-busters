import { describe, expect, it } from 'vitest'
import { extractArticle } from './extract'
import {
  HEAD_BAD_DATES,
  HEAD_BROKEN_JSONLD,
  HEAD_CONSENT_WALL,
  HEAD_GRAPH,
  HEAD_JSONLD,
  HEAD_MODIFIED_ONLY,
  HEAD_OG,
  HEAD_TITLE_ONLY,
} from './fixtures'

const URL_A = 'https://financialrecord.example/2023/03/14/auditors'

describe('extractArticle', () => {
  it('prefers the publisher structured record over its sharing copy', () => {
    const article = extractArticle(HEAD_JSONLD, URL_A)
    // og:title says "$1.9bn"; the JSON-LD says what the page printed.
    expect(article.headline).toBe('Auditors cannot find the $1.9 billion the company says it holds')
    expect(article.author).toBe('Elena Marsh')
    expect(article.outlet).toBe('The Financial Record')
    expect(article.publishedAt).toBe('2023-03-14')
    expect(article.provenance).toMatchObject({
      headline: 'jsonld',
      author: 'jsonld',
      outlet: 'jsonld',
      publishedAt: 'jsonld',
    })
  })

  /**
   * Decision 298: a paper is a source too. arXiv and the journals publish
   * Highwire `citation_*` tags and no JSON-LD, and their og:site_name is
   * absent, so the card read "Arxiv" from the domain and no date at all.
   */
  it('reads a paper from its citation tags, naming arXiv and folding the authors', () => {
    const html = `<html><head>
      <title>[2112.10752] High-Resolution Image Synthesis with Latent Diffusion Models</title>
      <meta name="citation_title" content="High-Resolution Image Synthesis with Latent Diffusion Models">
      <meta name="citation_author" content="Rombach, Robin">
      <meta name="citation_author" content="Blattmann, Andreas">
      <meta name="citation_author" content="Lorenz, Dominik">
      <meta name="citation_date" content="2021/12/20">
      <meta name="citation_online_date" content="2021/12/20">
      <meta name="citation_arxiv_id" content="2112.10752">
      <meta property="og:title" content="High-Resolution Image Synthesis with Latent Diffusion Models">
      <meta property="og:description" content="By decomposing the image formation process into a sequential application of denoising autoencoders...">
    </head><body></body></html>`
    const article = extractArticle(html, 'https://arxiv.org/abs/2112.10752')
    expect(article.outlet).toBe('arXiv')
    expect(article.headline).toBe('High-Resolution Image Synthesis with Latent Diffusion Models')
    expect(article.author).toBe('Robin Rombach and others')
    expect(article.publishedAt).toBe('2021-12-20')
    expect(article.provenance).toMatchObject({
      outlet: 'meta',
      author: 'meta',
      publishedAt: 'meta',
    })
  })

  it('names a journal from its citation tags when the page has no site name', () => {
    const html = `<html><head>
      <meta name="citation_journal_title" content="Nature">
      <meta name="citation_title" content="A result">
      <meta name="citation_author" content="Ada Lovelace">
      <meta name="citation_publication_date" content="2024-05-01">
    </head><body></body></html>`
    const article = extractArticle(html, 'https://nature.example/articles/1')
    expect(article.outlet).toBe('Nature')
    expect(article.headline).toBe('A result')
    expect(article.author).toBe('Ada Lovelace')
    expect(article.publishedAt).toBe('2024-05-01')
  })

  it('never promotes a modified date to the publication date', () => {
    const article = extractArticle(HEAD_MODIFIED_ONLY, URL_A)
    expect(article.headline).toBe('An old story, republished')
    expect(article.publishedAt).toBeNull()
    expect(article.provenance.publishedAt).toBeUndefined()
  })

  it('falls back to Open Graph, and skips a byline that is a profile link', () => {
    const article = extractArticle(HEAD_OG, 'https://cityherald.example/markets/board-backs')
    expect(article.headline).toBe('Board backs chief executive as shares fall 41%')
    expect(article.outlet).toBe('City Herald')
    expect(article.publishedAt).toBe('2023-04-02')
    // "By Tomés Vieira" as an entity, with the "By " the card prints itself.
    expect(article.author).toBe('Tomés Vieira')
    expect(article.provenance.headline).toBe('og')
  })

  it('reads a title-only page and takes the masthead off the end', () => {
    const article = extractArticle(HEAD_TITLE_ONLY, 'https://dailyledger.example/x')
    expect(article.headline).toBe('Regulator opens inquiry into missing escrow')
    expect(article.outlet).toBe('The Daily Ledger')
    expect(article.publishedAt).toBe('2023-06-02')
    expect(article.provenance.headline).toBe('title')
  })

  it('finds the article inside an @graph, decodes it, and folds three bylines', () => {
    const article = extractArticle(HEAD_GRAPH, URL_A)
    expect(article.headline).toBe('Auditors & regulators split over the “missing” accounts')
    expect(article.author).toBe('Elena Marsh and others')
    expect(article.publishedAt).toBe('2021-09-30')
  })

  it('survives a malformed block by reading the rest of the page', () => {
    const article = extractArticle(HEAD_BROKEN_JSONLD, 'https://cityherald.example/x')
    expect(article.headline).toBe('Escrow accounts were never opened, court hears')
    expect(article.publishedAt).toBe('2022-01-18')
  })

  it('refuses a date it cannot read rather than guessing at one', () => {
    expect(extractArticle(HEAD_BAD_DATES, 'https://cityherald.example/x').publishedAt).toBeNull()
  })

  it('reports a consent wall as nothing found, with the domain as a guess', () => {
    const article = extractArticle(HEAD_CONSENT_WALL, 'https://www.cityherald.example/story')
    expect(article.headline).toBe('Please accept cookies to continue')
    expect(article.publishedAt).toBeNull()
    expect(article.author).toBeNull()
    // Nothing declared the outlet, so the hostname is the guess, and says so.
    expect(article.outlet).toBe('Cityherald')
    expect(article.provenance.outlet).toBe('domain')
  })

  it('reads a two-part public suffix as the name before it', () => {
    const article = extractArticle(HEAD_CONSENT_WALL, 'https://news.dailyledger.co.uk/story')
    expect(article.outlet).toBe('Dailyledger')
  })
})
