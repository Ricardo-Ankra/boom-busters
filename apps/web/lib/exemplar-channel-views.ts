import type { ChannelExemplarRow, Database } from '@boom-busters/db'
import { listChannelExemplars } from '@boom-busters/db'
import { MANIFEST } from '@boom-busters/providers'
import type { Technique } from '@boom-busters/providers'
import type {
  CriticAxis,
  ExemplarStatus,
  GraphicCode,
  GraphicCodePayload,
  Mechanism,
  MotionMetrics,
} from '@boom-busters/schemas'

/**
 * A channel's exemplars as the Exemplars tab shows them (spec 2026-11-04,
 * section 11.4): one view per manifest technique with the approved
 * version, the newest draft (the side by side when it has a parent) and
 * every version newest first. A stored version's code plays as it is:
 * its `compiled` carries the channel's preamble from its build.
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
}

export interface ChannelExemplarView {
  technique: Technique
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
  }
}

/** Pure: the views from the rows, in the manifest's order. */
export function channelExemplarViewsFrom(
  rows: readonly ChannelExemplarRow[],
): ChannelExemplarView[] {
  return MANIFEST.map((entry) => {
    const own = rows
      .filter((row) => row.technique === entry.technique)
      .sort((a, b) => b.version - a.version)
      .map(versionView)
    const approved = own.find((version) => version.status === 'approved') ?? null
    const pendingDraft = own.find((version) => version.status === 'draft') ?? null
    return { technique: entry.technique, approved, pendingDraft, versions: own }
  })
}

export async function channelExemplarViews(
  db: Database,
  channelId: string,
): Promise<ChannelExemplarView[]> {
  return channelExemplarViewsFrom(await listChannelExemplars(db, channelId))
}
