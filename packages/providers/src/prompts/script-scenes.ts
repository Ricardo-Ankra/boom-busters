import type { GroundedResearch } from '@boom-busters/schemas'
import { unstop } from './dossier-render'

/** The marker a scene carries when the dossier could not find its quote. */
const UNPLACED = ' (unplaced)'

/**
 * The dossier's scenes as plain lines, the one reading both the script's
 * drafter and its reviewer share so a scene number means the same to each.
 * The stored research wins; a dossier without it falls back to the Timeline
 * section of its markdown.
 */
export function sceneLines(dossier: {
  research: GroundedResearch | null
  contentMd: string
}): string[] {
  const scenes = dossier.research?.scenes ?? []
  if (scenes.length > 0) {
    return scenes.map(
      (scene) =>
        `${scene.when} — ${unstop(scene.what)} (${scene.who}). ${scene.why.trim()}` +
        // A scene whose quote was not found stays in the list marked, as the dossier renders it.
        (scene.ref.found ? '' : UNPLACED),
    )
  }
  const lines = dossier.contentMd.split(/\r?\n/)
  const start = lines.findIndex((line) => /^## Timeline\s*$/.test(line))
  if (start === -1) return []
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    if (!line.startsWith('- ')) continue
    // The marker is read first, so the source link that sits before it can be stripped.
    const unplaced = /\s*\(unplaced\)\s*$/.test(line)
    const text = line
      .slice(2)
      .replace(/\s*\(unplaced\)\s*$/, '')
      .replace(/\s*\(\[source\]\(.*\)\)\s*$/, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .trim()
    if (text) out.push(unplaced ? `${text}${UNPLACED}` : text)
  }
  return out
}

/** The scenes numbered S1, S2, so a scene stays apart from a claim number. */
export function sceneList(scenes: readonly string[]): string {
  if (scenes.length === 0) return 'No scenes.'
  return scenes.map((scene, at) => `[S${at + 1}] ${scene}`).join('\n')
}
