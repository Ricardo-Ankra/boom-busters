import { z } from 'zod'
import type { IsoDate, Person } from '../types'
import type { PoliteClient } from './http'

/**
 * Wikidata entity facts and SPARQL. `facts` is the cheap, exact side: one
 * `wbgetentities` call per 50 ids gives sitelinks and the claims we rank on,
 * and a second batch gives the people's labels, death and conviction claims.
 * `sparql` is the wide side, used to build the hitlist.
 */

export interface EntityFacts {
  qid: string
  enTitle: string | null
  /** Wikipedia language editions only, e.g. `{ dewiki: 'Wirecard (Unternehmen)' }`. */
  sitelinks: Record<string, string>
  /** QID of the P17 country. */
  country: string | null
  /** P5531 SEC Central Index Key. */
  cik: string | null
  /** P576 dissolution date; a coarser precision gives the first day of that month or year. */
  dissolved: IsoDate | null
  /** P31 instance-of QIDs, in claim order. */
  instanceOf: string[]
  /** True when the entity has any P279 subclass-of claim: it is a class or concept, not a thing. */
  isClass: boolean
  /** Founders (P112) and CEOs (P169). Living = no P570; convicted = has P1399. */
  people: Person[]
}

export interface WikidataSource {
  sparql<T>(query: string, schema: z.ZodType<T>): Promise<T>
  /** Entities Wikidata reports as missing are left out of the map. */
  facts(qids: string[]): Promise<Map<string, EntityFacts>>
}

const API = 'https://www.wikidata.org/w/api.php'
const SPARQL = 'https://query.wikidata.org/sparql'
const BATCH = 50

/** Not Wikipedia language editions, though their ids also end in `wiki` or similar. */
const NON_WIKIPEDIA = new Set([
  'commonswiki',
  'wikidatawiki',
  'specieswiki',
  'metawiki',
  'mediawikiwiki',
  'sourceswiki',
])
const NON_WIKIPEDIA_SUFFIXES = [
  'wikiquote',
  'wikinews',
  'wikibooks',
  'wikisource',
  'wikivoyage',
  'wiktionary',
  'wikiversity',
]

/** An empty object comes back from the API as `[]`; read both as a record. */
const lenientRecord = <T extends z.ZodType>(value: T) =>
  z
    .union([z.record(z.string(), value), z.array(z.never())])
    .transform((v): Record<string, z.infer<T>> => (Array.isArray(v) ? {} : v))

const claimSchema = z.object({
  mainsnak: z.object({
    snaktype: z.string(),
    datavalue: z.object({ value: z.unknown() }).optional(),
  }),
})

const entitySchema = z.object({
  id: z.string(),
  missing: z.unknown().optional(),
  sitelinks: lenientRecord(z.object({ title: z.string() })).optional(),
  labels: lenientRecord(z.object({ value: z.string() })).optional(),
  claims: lenientRecord(z.array(claimSchema)).optional(),
})
type Entity = z.infer<typeof entitySchema>

const entitiesSchema = z.object({ entities: z.record(z.string(), entitySchema) })

/** The `value` of every claim for a property that carries one (not "unknown value"). */
function values(entity: Entity, property: string): unknown[] {
  return (entity.claims?.[property] ?? [])
    .filter((c) => c.mainsnak.snaktype === 'value')
    .map((c) => c.mainsnak.datavalue?.value)
}

const entityIdValue = z.object({ id: z.string() })
const timeValue = z.object({ time: z.string(), precision: z.number() })

function itemIds(entity: Entity, property: string): string[] {
  return values(entity, property).flatMap((v) => {
    const parsed = entityIdValue.safeParse(v)
    return parsed.success ? [parsed.data.id] : []
  })
}

/** `+2020-06-25T00:00:00Z` to `2020-06-25`; month or year precision rounds down to the first day. */
export function wikidataDate(value: unknown): IsoDate | null {
  const parsed = timeValue.safeParse(value)
  if (!parsed.success) return null
  const m = /^\+(\d{4,})-(\d\d)-(\d\d)T/.exec(parsed.data.time)
  if (!m) return null
  const year = m[1]!.padStart(4, '0')
  const month = parsed.data.precision >= 10 && m[2] !== '00' ? m[2]! : '01'
  const day = parsed.data.precision >= 11 && m[3] !== '00' ? m[3]! : '01'
  return `${year}-${month}-${day}`
}

function isWikipedia(site: string): boolean {
  if (!site.endsWith('wiki') || NON_WIKIPEDIA.has(site)) return false
  return !NON_WIKIPEDIA_SUFFIXES.some((s) => site.endsWith(s))
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function liveWikidata(client: PoliteClient): WikidataSource {
  async function entities(ids: string[], props: string, extra = ''): Promise<Entity[]> {
    const out: Entity[] = []
    for (const batch of chunks(ids, BATCH)) {
      const url =
        `${API}?action=wbgetentities&format=json${extra}` +
        `&props=${encodeURIComponent(props)}&ids=${encodeURIComponent(batch.join('|'))}`
      const { data } = await client.getJson(url, entitiesSchema)
      out.push(...Object.values(data.entities).filter((e) => e.missing === undefined))
    }
    return out
  }

  return {
    async sparql<T>(query: string, schema: z.ZodType<T>): Promise<T> {
      const url = `${SPARQL}?query=${encodeURIComponent(query)}&format=json`
      const { data } = await client.getJson(url, schema, {
        headers: { Accept: 'application/sparql-results+json' },
      })
      return data
    },

    async facts(qids) {
      const found = await entities([...new Set(qids)], 'sitelinks|claims')

      const personIds = [
        ...new Set(found.flatMap((e) => [...itemIds(e, 'P112'), ...itemIds(e, 'P169')])),
      ]
      const people = new Map<string, Person>()
      for (const p of await entities(personIds, 'labels|claims', '&languages=en')) {
        people.set(p.id, {
          qid: p.id,
          name: p.labels?.en?.value ?? p.id,
          living: (p.claims?.P570 ?? []).length === 0,
          convicted: (p.claims?.P1399 ?? []).length > 0,
        })
      }

      const out = new Map<string, EntityFacts>()
      for (const e of found) {
        const sitelinks: Record<string, string> = {}
        for (const [site, link] of Object.entries(e.sitelinks ?? {})) {
          if (isWikipedia(site)) sitelinks[site] = link.title
        }
        const cik = values(e, 'P5531').find((v): v is string => typeof v === 'string')
        const personQids = [...new Set([...itemIds(e, 'P112'), ...itemIds(e, 'P169')])]
        out.set(e.id, {
          qid: e.id,
          enTitle: e.sitelinks?.enwiki?.title ?? null,
          sitelinks,
          country: itemIds(e, 'P17')[0] ?? null,
          cik: cik ?? null,
          dissolved:
            values(e, 'P576')
              .map(wikidataDate)
              .find((d) => d !== null) ?? null,
          instanceOf: itemIds(e, 'P31'),
          isClass: (e.claims?.P279 ?? []).length > 0,
          people: personQids.map(
            (qid) => people.get(qid) ?? { qid, name: qid, living: true, convicted: false },
          ),
        })
      }
      return out
    },
  }
}
