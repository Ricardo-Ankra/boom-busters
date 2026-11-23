import {
  approvedTalkingPointSet,
  getLatestScript,
  getProject,
  getPublishRecord,
} from '@boom-busters/db'
import { timelineDurationMs } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import type { ShortEndCardInput } from '@boom-busters/timeline'
import { db } from '@/lib/db'

/**
 * What a point Short's end card says about the long form (decision 479),
 * read at render time so a re-render after the Publish screen carries the
 * film's final title:
 * - title: the long form's Publish title when one is set, else the project's;
 * - chapters: the point's bridge chapters, by the latest script's titles,
 *   numbered from 1 as the film shows them (none when the point is gone);
 * - runtimeMs: the long form's master runtime.
 */
export async function pointEndCardInput(input: {
  projectId: string
  pointId: string | null
  longFormMaster: Timeline
}): Promise<ShortEndCardInput> {
  const [project, publish, latest, points] = await Promise.all([
    getProject(db, input.projectId),
    getPublishRecord(db, 'master', input.projectId),
    getLatestScript(db, input.projectId),
    approvedTalkingPointSet(db, input.projectId),
  ])

  const published = publish?.metadata['title']
  const title =
    (typeof published === 'string' && published.trim() !== '' ? published.trim() : null) ??
    project?.title ??
    ''

  const point = input.pointId
    ? points?.points.find((candidate) => candidate.id === input.pointId)
    : undefined
  const chapters = (point?.bridgeChapters ?? []).flatMap((index) => {
    const chapter = latest?.chapters.find((candidate) => candidate.index === index)
    return chapter ? [{ number: index + 1, title: chapter.title }] : []
  })

  const runtimeMs = timelineDurationMs(input.longFormMaster)
  return { title, chapters, runtimeMs: runtimeMs > 0 ? runtimeMs : null }
}
