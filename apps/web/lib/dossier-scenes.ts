import { getDossier } from '@boom-busters/db'
import { sceneLines } from '@boom-busters/providers'
import { db } from '@/lib/db'

/**
 * The dossier's scenes, read inside the step or action that builds the request.
 * A project with no dossier has none.
 */
export async function scenesForProject(projectId: string): Promise<string[]> {
  const dossier = await getDossier(db, projectId)
  return dossier ? sceneLines({ research: dossier.research, contentMd: dossier.contentMd }) : []
}
