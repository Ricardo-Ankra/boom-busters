import { z } from 'zod'
import type { IsoDate } from '../types'
import type { PoliteClient } from './http'

/**
 * English Wikipedia through the MediaWiki action API. The hitlist reads
 * category members and list-page links, and evidence gathering reads a page
 * as it stood before a back-test day (`revisionBefore`, then `parsed`), so
 * nothing written after the day can leak into a score.
 */

export interface WikipediaSource {
  /** Namespace-0 titles; `category` has no `Category:` prefix. Depth 1 adds each direct subcategory's pages. */
  categoryMembers(category: string, depth: 0 | 1): Promise<string[]>
  /** Namespace-0 links of a page. Includes navbox links; the hitlist resolves and filters later. */
  listLinks(page: string): Promise<string[]>
  /** Titles of the redirects that point at `title`, not `title` itself. */
  redirectsTo(title: string): Promise<string[]>
  /** Requested title to QID, following normalisation and redirects. Titles with no item are absent. */
  qidsFor(titles: string[]): Promise<Map<string, string>>
  /** The newest revision before 00:00 UTC of `day`; null if the page is missing or did not exist yet. */
  revisionBefore(title: string, day: IsoDate): Promise<{ revid: number; timestamp: string } | null>
  /**
   * Category names (underscores as spaces, hidden ones included), external links and namespace-0
   * link titles of one revision. Links to pages that do not exist are kept: a list names its entries
   * whether or not they have an article yet.
   */
  parsed(revid: number): Promise<{ categories: string[]; externalLinks: string[]; links: string[] }>
}

const API = 'https://en.wikipedia.org/w/api.php'
const BATCH = 50

const continueSchema = z.record(z.string(), z.union([z.string(), z.number()]))

/** Every action-API reply may carry a `continue` object; `query` is absent on some. */
const envelope = <T extends z.ZodType>(query: T) =>
  z.object({ continue: continueSchema.optional(), query: query.optional() })

const pageSchema = z.object({
  title: z.string(),
  missing: z.unknown().optional(),
  links: z.array(z.object({ title: z.string() })).optional(),
  redirects: z.array(z.object({ title: z.string() })).optional(),
  pageprops: z.object({ wikibase_item: z.string().optional() }).optional(),
  revisions: z.array(z.object({ revid: z.number(), timestamp: z.string() })).optional(),
})

const pagesQuery = z.object({
  normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  redirects: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  pages: z.array(pageSchema).optional(),
})

const membersQuery = z.object({
  categorymembers: z.array(z.object({ ns: z.number(), title: z.string() })).optional(),
})

const parseSchema = z.object({
  parse: z.object({
    categories: z.array(z.object({ category: z.string() })),
    externallinks: z.array(z.string()),
    links: z.array(z.object({ ns: z.number(), title: z.string() })),
  }),
})

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function liveWikipedia(client: PoliteClient): WikipediaSource {
  const urlFor = (params: Record<string, string>) =>
    `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`

  /** Every reply of a query, merging each `continue` object into the next request until it is absent. */
  async function allReplies<T extends z.ZodType>(
    params: Record<string, string>,
    query: T,
  ): Promise<z.infer<T>[]> {
    const replies: z.infer<T>[] = []
    let next: Record<string, string> = {}
    for (;;) {
      const { data } = await client.getJson(urlFor({ ...params, ...next }), envelope(query))
      if (data.query !== undefined) replies.push(data.query)
      if (data.continue === undefined) return replies
      next = Object.fromEntries(Object.entries(data.continue).map(([k, v]) => [k, String(v)]))
    }
  }

  /** Pages of one category, plus its direct subcategories' titles in `Category:` form. */
  async function members(category: string, type: string) {
    const replies = await allReplies(
      {
        action: 'query',
        list: 'categorymembers',
        cmtitle: `Category:${category}`,
        cmtype: type,
        cmlimit: 'max',
      },
      membersQuery,
    )
    const all = replies.flatMap((r) => r.categorymembers ?? [])
    return {
      pages: all.filter((m) => m.ns === 0).map((m) => m.title),
      subcategories: all.filter((m) => m.ns === 14).map((m) => m.title),
    }
  }

  return {
    async categoryMembers(category, depth) {
      const top = await members(category, 'page|subcat')
      const titles = [...top.pages]
      if (depth === 1) {
        for (const sub of top.subcategories) {
          const inner = await members(sub.replace(/^Category:/, ''), 'page')
          titles.push(...inner.pages)
        }
      }
      return [...new Set(titles)]
    },

    async listLinks(page) {
      const replies = await allReplies(
        { action: 'query', prop: 'links', plnamespace: '0', pllimit: 'max', titles: page },
        pagesQuery,
      )
      const titles = replies.flatMap((r) => (r.pages ?? []).flatMap((p) => p.links ?? []))
      return [...new Set(titles.map((l) => l.title))]
    },

    async redirectsTo(title) {
      const replies = await allReplies(
        {
          action: 'query',
          prop: 'redirects',
          rdnamespace: '0',
          rdlimit: 'max',
          titles: title,
        },
        pagesQuery,
      )
      const titles = replies.flatMap((r) => (r.pages ?? []).flatMap((p) => p.redirects ?? []))
      return [...new Set(titles.map((r) => r.title))]
    },

    async qidsFor(titles) {
      const out = new Map<string, string>()
      for (const batch of chunks([...new Set(titles)], BATCH)) {
        const replies = await allReplies(
          {
            action: 'query',
            prop: 'pageprops',
            ppprop: 'wikibase_item',
            redirects: '1',
            titles: batch.join('|'),
          },
          pagesQuery,
        )
        const normalized = new Map<string, string>()
        const redirected = new Map<string, string>()
        const qidByTitle = new Map<string, string>()
        for (const r of replies) {
          for (const n of r.normalized ?? []) normalized.set(n.from, n.to)
          for (const d of r.redirects ?? []) redirected.set(d.from, d.to)
          for (const p of r.pages ?? []) {
            const qid = p.pageprops?.wikibase_item
            if (qid !== undefined) qidByTitle.set(p.title, qid)
          }
        }
        for (const requested of batch) {
          const normal = normalized.get(requested) ?? requested
          const final = redirected.get(normal) ?? normal
          const qid = qidByTitle.get(final)
          if (qid !== undefined) out.set(requested, qid)
        }
      }
      return out
    },

    async revisionBefore(title, day) {
      // One request, never `continue`: with rvlimit=1 the API offers a continuation whenever older
      // revisions exist, and following it would walk the article's whole history.
      // rvstart is inclusive, so start one second before midnight to exclude a revision stamped at T.
      const rvstart = new Date(Date.parse(`${day}T00:00:00Z`) - 1000)
        .toISOString()
        .replace('.000Z', 'Z')
      const { data } = await client.getJson(
        urlFor({
          action: 'query',
          prop: 'revisions',
          rvprop: 'ids|timestamp',
          rvdir: 'older',
          rvstart,
          rvlimit: '1',
          titles: title,
        }),
        envelope(pagesQuery),
      )
      const page = data.query?.pages?.[0]
      const revision = page?.missing !== undefined ? undefined : page?.revisions?.[0]
      return revision ? { revid: revision.revid, timestamp: revision.timestamp } : null
    },

    async parsed(revid) {
      const { data } = await client.getJson(
        urlFor({
          action: 'parse',
          oldid: String(revid),
          prop: 'categories|externallinks|links',
        }),
        parseSchema,
      )
      return {
        categories: data.parse.categories.map((c) => c.category.replaceAll('_', ' ')),
        externalLinks: data.parse.externallinks,
        links: data.parse.links.filter((l) => l.ns === 0).map((l) => l.title),
      }
    },
  }
}
