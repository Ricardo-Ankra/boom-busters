export type Lane = 'downfall' | 'success'
/** 'YYYY-MM-DD' */
export type IsoDate = string

/** A tag with the date it began to apply; `since` null means undated (hindsight noted). */
export interface DatedTag {
  tag: string
  lane: Lane
  since: IsoDate | null
}

export interface HitlistEntry {
  qid: string
  enTitle: string | null
  query: string | null
  /** e.g. `{ dewiki: 'Wirecard' }` */
  sitelinks: Record<string, string>
  tags: DatedTag[]
  country: string | null
  cik: string | null
}

/** `month` is 'YYYY-MM'. */
export interface MonthlyViews {
  month: string
  views: number
}

export interface DailyViews {
  date: IsoDate
  views: number
}

export interface YoutubeVideo {
  id: string
  channelId: string
  title: string
  publishedAt: IsoDate
  durationSec: number
  views: number
}

export interface ChannelUploads {
  channelId: string
  uploads: YoutubeVideo[]
}

export type DocumentSource =
  'courtlistener' | 'edgar' | 'sec-aaer' | 'sec-litigation' | 'wikipedia-reference'

export interface PrimaryDocument {
  url: string
  title: string
  source: DocumentSource
  datedAt: IsoDate | null
}

export interface Person {
  qid: string
  name: string
  living: boolean
  convicted: boolean
}

export interface EntryEvidence {
  entry: HitlistEntry
  asOf: IsoDate
  enMonthly: MonthlyViews[]
  worldMonthly: MonthlyViews[]
  enDaily: DailyViews[]
  /** null means not measured (outside the top 250). */
  search: { fetchedAt: IsoDate; videos: YoutubeVideo[] } | null
  channels: Record<string, ChannelUploads>
  documents: PrimaryDocument[]
  people: Person[]
  /** Tags whose `since` is before `asOf`, plus category tags from the revision at `asOf`. */
  tagsAtT: DatedTag[]
}
