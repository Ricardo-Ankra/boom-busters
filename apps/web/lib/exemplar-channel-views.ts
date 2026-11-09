import type { ChannelExemplarRow, Database } from '@boom-busters/db'
import { listChannelExemplars } from '@boom-busters/db'
import { MANIFEST } from '@boom-busters/providers'
import { isHouseTechnique } from '@boom-busters/schemas'
import type {
  CriticAxis,
  ExemplarStatus,
  GraphicCode,
  GraphicCodePayload,
  Mechanism,
  MotionMetrics,
  TechniqueKey,
} from '@boom-busters/schemas'

/**
 * A channel's exemplars as the Exemplars tab shows them (spec 2026-11-04,
 * section 11.4): one view per manifest technique with the approved
 * version, the newest draft (the side by side when it has a parent) and
 * every version newest first, then one view per technique of the
 * channel's own (spec 8.5), in key order, with the proposal's words. A
 * stored version's code plays as it is: its `compiled` carries the
 * channel's preamble from its build.
 */

export interface ChannelExemplarVersionView {
  id: string
  version: number
  status: ExemplarStatus
  parentId: string | null
  steer: string | null
  concept: string
  storyboard: string[]
  mechanisms: Mechanism[]
  /** The critic's last scores and lines; null before a critic ran. */
  scores: Record<CriticAxis, { score: number; line: string }> | null
  verdict: 'ready' | 'one-more-pass' | null
  metrics: MotionMetrics | null
  code: GraphicCode
  /** A chart's sample data, from the plan's rewritten slot. */
  data?: GraphicCodePayload['data']
  createdAt: string
  approvedAt: string | null
  copiedFrom: string | null
  /** The layout check's refusal of a kept build (decision 445): refine it, never approve it. */
  refusal: string | null
}

export interface ChannelExemplarView {
  technique: TechniqueKey
  /** The proposal's name for a channel's own technique; null for a house one, which is named from its key. */
  name: string | null
  /** The catalogue's line, or the proposal's for a channel's own technique. */
  description: string
  /** A technique of the channel's own (spec 8.5): no house example, reached by its phrases. */
  channelOnly: boolean
  steerPhrases: readonly string[]
  /** The reference a channel's own technique came from; null for a house one. */
  fromReference: string | null
  approved: ChannelExemplarVersionView | null
  pendingDraft: ChannelExemplarVersionView | null
  versions: ChannelExemplarVersionView[]
}

function versionView(row: ChannelExemplarRow): ChannelExemplarVersionView {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    parentId: row.parentId,
    steer: row.steer,
    concept: row.plan.concept,
    storyboard: row.plan.storyboard,
    mechanisms: row.plan.mechanisms,
    scores: row.critique?.scores ?? null,
    verdict: row.verify?.verdict ?? null,
    metrics: row.metrics,
    code: row.code,
    ...(row.plan.slot.data ? { data: row.plan.slot.data } : {}),
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    copiedFrom: row.copiedFrom,
    refusal: row.refusal,
  }
}

/** Pure: the views from the rows, in the manifest's order. */
export function channelExemplarViewsFrom(
  rows: readonly ChannelExemplarRow[],
): ChannelExemplarView[] {
  const versionsOf = (technique: TechniqueKey) =>
    rows
      .filter((row) => row.technique === technique)
      .sort((a, b) => b.version - a.version)
      .map(versionView)
  const view = (
    technique: TechniqueKey,
    words: Pick<
      ChannelExemplarView,
      'name' | 'description' | 'channelOnly' | 'steerPhrases' | 'fromReference'
    >,
  ): ChannelExemplarView => {
    const own = versionsOf(technique)
    return {
      technique,
      ...words,
      approved: own.find((version) => version.status === 'approved') ?? null,
      pendingDraft: own.find((version) => version.status === 'draft') ?? null,
      versions: own,
    }
  }
  const house = MANIFEST.map((entry) =>
    view(entry.technique, {
      name: null,
      description: entry.description,
      channelOnly: false,
      steerPhrases: [],
      fromReference: null,
    }),
  )
  // The channel's own (spec 8.5): the newest version's proposal names each one.
  const ownKeys = [...new Set(rows.map((row) => row.technique))]
    .filter((technique) => !isHouseTechnique(technique))
    .sort()
  const own = ownKeys.flatMap((technique) => {
    const newest = rows
      .filter((row) => row.technique === technique && row.proposal !== null)
      .sort((a, b) => b.version - a.version)[0]
    if (!newest?.proposal) return []
    return [
      view(technique, {
        name: newest.proposal.name,
        description: newest.proposal.description,
        channelOnly: true,
        steerPhrases: newest.proposal.steerPhrases,
        fromReference: newest.proposal.fromReference,
      }),
    ]
  })
  return [...house, ...own]
}

export async function channelExemplarViews(
  db: Database,
  channelId: string,
): Promise<ChannelExemplarView[]> {
  return channelExemplarViewsFrom(await listChannelExemplars(db, channelId))
}
