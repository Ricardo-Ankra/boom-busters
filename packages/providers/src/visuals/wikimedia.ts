import { z } from 'zod'
import type { SlotCandidate } from '@boom-busters/schemas'
import { mapNetworkError, throwForResponse } from '../llm/http'
import type { StockCallOptions, StockProvider, StockQuery } from './types'

/**
 * Wikimedia Commons — the archival source (product spec: "source pool
 * Wikimedia/Flickr Commons/national archives"; Commons is the one with a
 * clean keyless API, so it is the one built; the others are additive later).
 *
 * The licence field is the whole point of archival search. Commons hosts
 * everything from public domain to CC BY-SA to "fair use claimed", and the
 * brief's licence is a thing the human must VERIFY at the gate — so the
 * adapter reports exactly what Commons says (`LicenseShortName`), and says
 * `Unknown — verify at source` rather than guessing when the metadata is
 * missing. Attribution likewise: Commons files carry their author as HTML,
 * stripped here to the plain text the credits will need.
 */

const COMMONS = 'https://commons.wikimedia.org/w/api.php'

/** Wikimedia policy requires a descriptive User-Agent; anonymous UAs get 403s under load. */
const USER_AGENT = 'boom-busters/1.0 (single-user production console)'

const MetaValueSchema = z.object({ value: z.string() }).nullish()

const ImageInfoSchema = z.object({
  url: z.string(),
  descriptionurl: z.string().nullish(),
  thumburl: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  extmetadata: z
    .object({
      LicenseShortName: MetaValueSchema,
      Artist: MetaValueSchema,
      ImageDescription: MetaValueSchema,
    })
    .nullish(),
})

const PageSchema = z.object({
  pageid: z.number(),
  title: z.string(),
  imageinfo: z.array(ImageInfoSchema).nullish(),
})

const ResponseSchema = z.object({
  query: z.object({ pages: z.array(PageSchema) }).nullish(),
})

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const wikimediaStock: StockProvider = {
  id: 'wikimedia',
  requiresKey: false,

  async search(query: StockQuery, options: StockCallOptions): Promise<SlotCandidate[]> {
    const fetchImpl = options.fetchImpl ?? fetch
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'search',
      gsrsearch: `filetype:bitmap ${query.query}`,
      gsrnamespace: '6',
      gsrlimit: String(query.count),
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata',
      iiurlwidth: '640',
      origin: '*',
    })

    let response: Response
    try {
      response = await fetchImpl(`${COMMONS}?${params}`, {
        headers: { 'User-Agent': USER_AGENT },
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('wikimedia', cause)
    }
    if (!response.ok) await throwForResponse('wikimedia', response)

    const parsed = ResponseSchema.parse(await response.json())
    const pages = parsed.query?.pages ?? []

    return pages.flatMap((page): SlotCandidate[] => {
      const info = page.imageinfo?.[0]
      if (!info) return []

      const meta = info.extmetadata
      const licence = meta?.LicenseShortName?.value?.trim()
      const artist = meta?.Artist?.value ? stripHtml(meta.Artist.value) : undefined
      const description = meta?.ImageDescription?.value
        ? stripHtml(meta.ImageDescription.value)
        : undefined
      // "File:Wirecard HQ 2019.jpg" → "Wirecard HQ 2019"
      const title = page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')

      return [
        {
          id: String(page.pageid),
          provider: 'wikimedia',
          kind: 'image',
          sourceUrl: info.url,
          ...(info.descriptionurl ? { pageUrl: info.descriptionurl } : {}),
          ...(info.thumburl ? { thumbUrl: info.thumburl } : {}),
          ...(info.width ? { width: info.width } : {}),
          ...(info.height ? { height: info.height } : {}),
          licence: licence || 'Unknown — verify at source',
          ...(artist ? { attributionText: artist } : {}),
          summary: description ? `${title}. ${description}` : title,
        },
      ]
    })
  },

  // Keyless — "verifying" it is just proving Commons answers, which the
  // Connections screen never asks for. Kept because the interface promises it.
  async verifyKey(_apiKey, options = {}) {
    await this.search({ query: 'test', brief: '', rejectionCriteria: [], count: 1 }, options)
  },
}
