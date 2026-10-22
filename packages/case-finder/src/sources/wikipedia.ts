import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
  /**
   * The subset of `redirects` that were once the article's own title, in input order. A move
   * leaves a redirect whose last edit summary is MediaWiki's automatic "Moved page [[a]] to [[b]]" (before 2013 "X moved [[a]] to [[b]]")
   * and which usually carries `{{R from move}}`; either marks it. Other redirects (nicknames,
   * misspellings, tickers) are not the article's history, and counting them costs a pageviews
   * request each.
   */
  formerTitles(title: string, redirects: string[]): Promise<string[]>
  /** Requested title to QID, following normalisation and redirects. Titles with no item are absent. */
  qidsFor(titles: string[]): Promise<Map<string, string>>
  /** The newest revision before 00:00 UTC of `day`; null if the page is missing or did not exist yet. */
  revisionBefore(title: string, day: IsoDate): Promise<{ revid: number; timestamp: string } | null>
  /**
   * Categories, external links and article links written in one revision's own wikitext, each
   * normalised by `normalTitle` (URLs as written), deduped in first-seen order. It reads the raw
   * text, not a parse: `action=parse&oldid=` expands today's templates, so navboxes and
   * template-added categories would leak later content into an old revision. Whatever only a
   * template adds is therefore dropped, deliberately: undercounting is the conservative side.
   */
  parsed(revid: number): Promise<RevisionItems>
  /** Namespace-0 full-text search, in the engine's result order. */
  search(query: string, limit: number): Promise<{ title: string; pageid: number }[]>
  /**
   * The page as it reads now, through the same wikitext extraction as `parsed`. For a live
   * dossier, where today's article is the point; a missing page has no items. Not cached.
   */
  currentItems(title: string): Promise<RevisionItems>
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

const formerPageSchema = z.object({
  title: z.string(),
  revisions: z.array(z.object({ comment: z.string().optional() })).optional(),
  templates: z.array(z.object({ title: z.string() })).optional(),
})

const formerQuery = z.object({
  normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  pages: z.array(formerPageSchema).optional(),
})

/** MediaWiki's automatic edit summary on the redirect a page move leaves behind. */
const MOVE_SUMMARY = /moved (page )?\[\[[^\]]+\]\] to \[\[/i
const MOVE_TEMPLATE = 'Template:R from move'

const membersQuery = z.object({
  categorymembers: z.array(z.object({ ns: z.number(), title: z.string() })).optional(),
})

const contentQuery = z.object({
  badrevids: z.record(z.string(), z.unknown()).optional(),
  pages: z
    .array(
      z.object({
        revisions: z
          .array(
            z.object({
              // A suppressed revision has `texthidden` and no `content`; only the absence is read.
              slots: z.object({ main: z.object({ content: z.string().optional() }) }).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

const searchQuery = z.object({
  search: z.array(z.object({ title: z.string(), pageid: z.number() })).default([]),
})

/** The content reply keeps the API's `error` object, which the shared envelope drops. */
const contentReply = z.object({
  error: z.object({ code: z.string(), info: z.string().optional() }).optional(),
  query: contentQuery.optional(),
})

/** Prefixes that put a link outside the article namespace (`<ns> talk` is matched separately). */
const NAMESPACES = new Set([
  'category',
  'file',
  'image',
  'media',
  'template',
  'wikipedia',
  'wp',
  'help',
  'portal',
  'draft',
  'module',
  'user',
  'special',
  'talk',
])

/** `de:`, `zh-yue:`: a language interwiki, not an article title. */
const INTERWIKI = /^[a-z]{2,3}(-[a-z]+)*$/

/** Trimmed, underscores as spaces, first letter upper-cased: how MediaWiki names a page. */
export function normalTitle(title: string): string {
  const spaced = title.replaceAll('_', ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** True when a link target has a namespace or interwiki prefix before its first colon. */
function prefixed(target: string): boolean {
  const colon = target.indexOf(':')
  if (colon < 0) return false
  const prefix = target.slice(0, colon).replaceAll('_', ' ').trim()
  const lower = prefix.toLowerCase()
  return NAMESPACES.has(lower) || lower.endsWith(' talk') || INTERWIKI.test(prefix)
}

const unique = (items: string[]) => [...new Set(items)]

export interface RevisionItems {
  categories: string[]
  externalLinks: string[]
  links: string[]
}

const itemsSchema = z.object({
  categories: z.array(z.string()),
  externalLinks: z.array(z.string()),
  links: z.array(z.string()),
})

/** What a revision's own text says, with HTML comments removed first. */
export function wikitextItems(wikitext: string): RevisionItems {
  const text = wikitext.replace(/<!--[\s\S]*?-->/g, '')
  const categories = [...text.matchAll(/\[\[\s*category\s*:([^|\]]*)(?:\|[^\]]*)?\]\]/gi)]
    .map((m) => normalTitle(m[1]!))
    .filter((name) => name !== '')
  const links: string[] = []
  for (const m of text.matchAll(/\[\[([^[\]]+)\]\]/g)) {
    const inner = m[1]!
    // A leading colon links to a page rather than categorising or interwiki-linking this one.
    if (inner.trimStart().startsWith(':')) continue
    const target = inner.split('|')[0]!.split('#')[0]!
    if (target.trim() === '' || prefixed(target)) continue
    links.push(normalTitle(target))
  }
  const externalLinks = [...text.matchAll(/https?:\/\/[^\s|\]}<>"]+/g)].map((m) => m[0])
  return {
    categories: unique(categories),
    externalLinks: unique(externalLinks),
    links: unique(links),
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface LiveWikipediaOptions {
  /**
   * Where `parsed` keeps each revision's extracted items, one `<revid>.json`
   * each. The raw wikitext is never cached: across every back-test date it
   * would run to gigabytes, and only the items are ever read. null keeps
   * nothing (tests).
   */
  itemsCacheDir?: string | null
}

export function liveWikipedia(
  client: PoliteClient,
  options: LiveWikipediaOptions = {},
): WikipediaSource {
  const itemsCacheDir = options.itemsCacheDir ?? null
  const urlFor = (params: Record<string, string>) =>
    `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`

  const emptyItems = (): RevisionItems => ({ categories: [], externalLinks: [], links: [] })

  /** One revision's items from its wikitext, which is fetched but not cached. */
  async function fetchItems(revid: number): Promise<RevisionItems> {
    const { data } = await client.getJson(
      urlFor({
        action: 'query',
        prop: 'revisions',
        revids: String(revid),
        rvprop: 'content',
        rvslots: 'main',
      }),
      contentReply,
      { noStore: true },
    )
    if (data.error !== undefined) {
      throw new Error(`Wikipedia revision ${revid}: ${data.error.code} ${data.error.info ?? ''}`)
    }
    const revision = data.query?.pages?.[0]?.revisions?.[0]
    if (data.query?.badrevids !== undefined || revision === undefined) {
      throw new Error(`Wikipedia has no revision ${revid}`)
    }
    // The revision exists but its text is suppressed (revision deletion) or absent: it says
    // nothing, so it has no items. Throwing here would abort every rerun on one hidden edit.
    const content = revision.slots?.main.content
    if (content === undefined) return emptyItems()
    return wikitextItems(content)
  }

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

    async formerTitles(_title, redirects) {
      const former = new Set<string>()
      for (const batch of chunks([...new Set(redirects)], BATCH)) {
        const replies = await allReplies(
          {
            action: 'query',
            prop: 'revisions|templates',
            rvprop: 'comment',
            tltemplates: MOVE_TEMPLATE,
            tllimit: 'max',
            titles: batch.join('|'),
          },
          formerQuery,
        )
        const normalized = new Map<string, string>()
        const moved = new Set<string>()
        for (const r of replies) {
          for (const n of r.normalized ?? []) normalized.set(n.from, n.to)
          // A `continue` reply repeats a page with only its next templates, so the evidence is unioned.
          for (const p of r.pages ?? []) {
            const comment = p.revisions?.[0]?.comment ?? ''
            if (MOVE_SUMMARY.test(comment) || p.templates?.some((t) => t.title === MOVE_TEMPLATE)) {
              moved.add(p.title)
            }
          }
        }
        for (const requested of batch) {
          if (moved.has(normalized.get(requested) ?? requested)) former.add(requested)
        }
      }
      return redirects.filter((r) => former.has(r))
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

    async search(query, limit) {
      const { data } = await client.getJson(
        urlFor({
          action: 'query',
          list: 'search',
          srsearch: query,
          srnamespace: '0',
          srlimit: String(limit),
        }),
        envelope(searchQuery),
      )
      return (data.query?.search ?? []).map((hit) => ({ title: hit.title, pageid: hit.pageid }))
    },

    async currentItems(title) {
      const { data } = await client.getJson(
        urlFor({
          action: 'query',
          prop: 'revisions',
          titles: title,
          rvprop: 'content',
          rvslots: 'main',
          rvlimit: '1',
        }),
        contentReply,
        { noStore: true },
      )
      if (data.error !== undefined) {
        throw new Error(`Wikipedia page ${title}: ${data.error.code} ${data.error.info ?? ''}`)
      }
      // A missing page has no `revisions`; a suppressed one has no content. Neither says anything.
      const content = data.query?.pages?.[0]?.revisions?.[0]?.slots?.main.content
      return content === undefined ? emptyItems() : wikitextItems(content)
    },

    async parsed(revid) {
      if (itemsCacheDir === null) return fetchItems(revid)
      // A revision never changes, so its items never expire.
      const file = path.join(itemsCacheDir, `${revid}.json`)
      try {
        return itemsSchema.parse(JSON.parse(await readFile(file, 'utf8')))
      } catch {
        // Not cached yet, or unreadable: fetch it again.
      }
      const items = await fetchItems(revid)
      await mkdir(itemsCacheDir, { recursive: true })
      await writeFile(file, JSON.stringify(items))
      return items
    },
  }
}
