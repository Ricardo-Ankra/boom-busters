import {
  getProject,
  latestScriptParagraphSources,
  listCastMembers,
  listLogos,
  listProjectSets,
  listVoiceTakes,
  scriptableClaims,
} from '@boom-busters/db'
import type { ScriptClaim } from '@boom-busters/providers'
import { DirectorsBookSchema } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { timedParagraphs } from './shot-list'

/**
 * Everything a re-plan plans against, read once per run inside its own step:
 * the case, the stored book, the timed narration, the claims in prompt order,
 * the cast, the film's rooms and the logo library. Shared by the
 * visuals-replanner and the stretch-replanner, so a stretch is planned under
 * exactly the context the whole plan was.
 */
export async function loadPlanInputs(projectId: string) {
  const project = await getProject(db, projectId)
  if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
  const book = DirectorsBookSchema.safeParse(project.direction)
  const sources = await latestScriptParagraphSources(db, projectId)
  const takes = await listVoiceTakes(db, projectId)
  const claims = await scriptableClaims(db, projectId)
  const cast = await listCastMembers(db, projectId)
  // Loaded once for the whole re-plan: the shot-list prompt lists the
  // film's rooms, and the craft notes count how often each is used.
  const sets = await listProjectSets(db, projectId)
  // The logo library (decision 268, Plan B), threaded exactly like `sets`.
  const logos = await listLogos(db)
  return {
    caseTitle: project.title,
    direction: book.success ? book.data : null,
    chapters: sources.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
    paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
    claims: claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      sourceUrl: claim.sourceUrl,
      confidence: claim.confidence,
      // Which claims a headline card may cite (decision 257).
      sourceType: claim.sourceType,
    })) satisfies ScriptClaim[],
    // Who the producer has photographed (decision 253, amended). Their
    // prompts name them and carry no physical description, because the
    // photograph is the likeness.
    photographed: cast.filter((member) => member.photos.length > 0).map((member) => member.name),
    // Every member, photographed or not (decision 271): the Fix button
    // weighs an unphotographed person as a manual finding.
    cast: cast.map((member) => ({
      name: member.name,
      photographed: member.photos.length > 0,
    })),
    // The film's rooms: named, described and inventoried for the
    // shot-list prompt (decision 275), and counted by the craft notes
    // below (decision 264).
    sets: sets.map(({ name, look, layout }) => ({ name, look, layout })),
    logos: logos.map((row) => ({
      id: row.id,
      title: row.title ?? '',
      width: row.width,
      height: row.height,
    })),
  }
}
