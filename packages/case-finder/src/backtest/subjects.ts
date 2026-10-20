import { z } from 'zod'
import { BACKTEST, LONG_FORM_MIN_SEC } from '../config'
import { titleMatches } from '../score/measure'
import type { ChannelUploads, HitlistEntry, IsoDate, Lane } from '../types'

export interface SubjectProposal {
  videoId: string
  channelHandle: string
  title: string
  publishedAt: IsoDate
  proposedQid: string | null
  matchedQuery: string | null
}

export interface SubjectFixture {
  videoId: string
  qid: string | null
  verdict: 'subject' | 'skip-not-single' | 'miss-not-on-hitlist'
  note?: string
}

/** The hand-checked fixture's shape; the run refuses a file that does not match it. */
export const SubjectFixturesSchema = z.array(
  z.object({
    videoId: z.string(),
    qid: z.string().nullable(),
    verdict: z.enum(['subject', 'skip-not-single', 'miss-not-on-hitlist']),
    note: z.string().optional(),
  }),
)

export type SelectedSubject = SubjectFixture & { lane: Lane; channelHandle: string }

const qidNumber = (qid: string): number => Number(qid.replace(/^Q/, ''))

/**
 * A first guess at each video's subject, for the human to confirm. The longest
 * matching query wins because "Lehman Brothers" is a better guess than "Lehman";
 * the hand-check, not this guess, decides the fixture.
 */
export function proposeSubjects(
  uploads: Map<string, ChannelUploads>,
  hitlist: HitlistEntry[],
): SubjectProposal[] {
  const queried = hitlist.filter((e): e is HitlistEntry & { query: string } => e.query !== null)
  const out: SubjectProposal[] = []
  for (const [channelHandle, channel] of uploads) {
    for (const v of channel.uploads) {
      if (v.durationSec < LONG_FORM_MIN_SEC) continue
      if (v.publishedAt < BACKTEST.from || v.publishedAt > BACKTEST.to) continue
      let best: (HitlistEntry & { query: string }) | null = null
      for (const e of queried) {
        if (!titleMatches(e.query, v.title)) continue
        if (
          best === null ||
          e.query.length > best.query.length ||
          (e.query.length === best.query.length && qidNumber(e.qid) < qidNumber(best.qid))
        ) {
          best = e
        }
      }
      out.push({
        videoId: v.id,
        channelHandle,
        title: v.title,
        publishedAt: v.publishedAt,
        proposedQid: best?.qid ?? null,
        matchedQuery: best?.query ?? null,
      })
    }
  }
  return out.sort(
    (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.videoId.localeCompare(b.videoId),
  )
}

function missLane(fixture: SubjectFixture): Lane {
  const m = /lane:\s*(downfall|success)/.exec(fixture.note ?? '')
  if (!m) {
    throw new Error(`Fixture for video ${fixture.videoId} is a miss without a "lane:" note`)
  }
  return m[1] as Lane
}

/**
 * Walks the proposals newest first and applies the pre-registered selection
 * rule to the hand-checked verdicts. Misses stay in: the spec counts them
 * against the rubric. Once the downfall quota is full only success stories are
 * taken, so the set always has room for the minimum of successes.
 */
export function selectTestSet(
  checked: SubjectFixture[],
  proposals: SubjectProposal[],
  /** The subject's lane at the video's test date; the same QID can differ between two videos. */
  laneOfQid: (qid: string, videoId: string) => Lane | null,
): { selected: SelectedSubject[]; note: string } {
  const byVideo = new Map(checked.map((f) => [f.videoId, f]))
  const downfallQuota = BACKTEST.size - BACKTEST.minSuccess
  const perChannel = new Map<string, number>()
  const selected: SelectedSubject[] = []
  let downfalls = 0
  let successes = 0
  let notSingle = 0
  let unchecked = 0
  let noLane = 0
  let capped = 0

  for (const p of proposals) {
    if (selected.length >= BACKTEST.size) break
    const fixture = byVideo.get(p.videoId)
    if (!fixture) {
      unchecked++
      continue
    }
    if (fixture.verdict === 'skip-not-single') {
      notSingle++
      continue
    }
    let lane: Lane | null
    if (fixture.verdict === 'miss-not-on-hitlist') lane = missLane(fixture)
    else lane = fixture.qid === null ? null : laneOfQid(fixture.qid, p.videoId)
    if (lane === null) {
      noLane++
      continue
    }
    if ((perChannel.get(p.channelHandle) ?? 0) >= BACKTEST.maxPerChannel) {
      capped++
      continue
    }
    if (lane === 'downfall' && downfalls >= downfallQuota) continue
    perChannel.set(p.channelHandle, (perChannel.get(p.channelHandle) ?? 0) + 1)
    if (lane === 'downfall') downfalls++
    else successes++
    selected.push({ ...fixture, lane, channelHandle: p.channelHandle })
  }

  const reached = successes >= BACKTEST.minSuccess
  const note =
    `${selected.length} selected: ${downfalls} downfall, ${successes} success; ` +
    `${notSingle} skipped as not single; ${unchecked} unchecked; ${noLane} with no lane; ` +
    `${capped} capped by channel; success minimum (${BACKTEST.minSuccess}) ` +
    (reached ? 'reached.' : 'not reached.')
  return { selected, note }
}
