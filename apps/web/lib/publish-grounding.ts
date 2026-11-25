import 'server-only'
import { getLatestScript, scriptableClaims } from '@boom-busters/db'
import type { channelForProject } from '@boom-busters/db'
import {
  fillTitleTemplate,
  leadKeyword,
  OutlineSchema,
  runtimeWords,
  topicForTitle,
} from '@boom-busters/schemas'
import type { SearchBrief, TitleSlot, TitleSlotValues } from '@boom-busters/schemas'
import type { ScriptClaim } from '@boom-busters/providers'
import { db } from '@/lib/db'
import { pillarOf } from '@/lib/pillar'
import { descriptionIngredients } from '@/lib/publish-review'

/**
 * What the film's metadata calls are grounded in: the claim list and the
 * format's filled title frame. Shared by the title action and the thumbnail
 * set planner, so both read the same facts. Moved out of `publish-actions.ts`
 * unchanged; that module is `'use server'` and may export only actions.
 */

/** The film's facts, as the claim list every metadata call reads (decision 303). */
export async function metadataGrounding(projectId: string): Promise<{
  claims: ScriptClaim[]
  centralQuestion: string | undefined
  scriptVersion: number
}> {
  const [claims, latest] = await Promise.all([
    scriptableClaims(db, projectId),
    getLatestScript(db, projectId),
  ])
  const outline = OutlineSchema.safeParse(latest?.script.outline)
  return {
    // An unverified claim is no ground for a public title or description,
    // and its source is not listed either (decision 303, review).
    claims: claims
      .filter((claim) => claim.confidence !== 'unverified')
      .map((claim) => ({
        id: claim.id,
        text: claim.text,
        sourceUrl: claim.sourceUrl,
        confidence: claim.confidence,
        legal: claim.legalStatus,
      })),
    centralQuestion: outline.success ? outline.data.centralQuestion : undefined,
    scriptVersion: latest?.script.version ?? 0,
  }
}

/**
 * The format's title template filled for this project, and the values a title
 * must hold. Null for a Short and for a format with no template: titles are
 * then written and scored as they always were.
 */
export async function titleFrameFor(
  projectId: string,
  project: {
    caseTitle: string
    caseCategory: string
    searchBrief: SearchBrief | null
  },
  frozen: Awaited<ReturnType<typeof channelForProject>>,
): Promise<{
  pattern: string
  required: string[]
  slots: readonly TitleSlot[]
  values: TitleSlotValues
} | null> {
  const { format } = frozen
  if (format.titleTemplate === '') return null
  const brief = project.searchBrief
  const runtimeSec = format.titleTemplate.includes('{runtime}')
    ? (await descriptionIngredients(db, projectId)).runtimeSec
    : null
  const values: TitleSlotValues = {
    topic: topicForTitle({
      targetKeyword: brief?.targetKeyword?.keyword ?? null,
      subject: brief?.subject ?? project.caseTitle,
      formatKeywords: format.keywords,
    }),
    formatKeyword: leadKeyword(format),
    pillar: format.titleTemplate.includes('{pillar}')
      ? (pillarOf(frozen.bible, project.caseCategory)?.label ?? null)
      : null,
    runtime: runtimeSec === null ? null : runtimeWords(runtimeSec),
  }
  const slots = format.titleRequiredSlots
  return {
    pattern: fillTitleTemplate(format.titleTemplate, values),
    required: slots.flatMap((slot) => (values[slot] === null ? [] : [values[slot]])),
    slots,
    values,
  }
}
