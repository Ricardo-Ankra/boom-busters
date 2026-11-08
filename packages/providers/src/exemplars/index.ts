import { DESIGNS } from './designs/index'
import type { ExemplarDesign } from './designs/index'
import { MANIFEST, TECHNIQUES } from './manifest'
import type { ExemplarEntry, ExemplarSlot, Technique } from './manifest'
import type { Mechanism, TechniqueKey } from '@boom-busters/schemas'

export { DESIGNS, MANIFEST, TECHNIQUES }
export type { ExemplarDesign, ExemplarEntry, ExemplarSlot, Technique }
// The mechanisms live beside the technique keys in the schemas package (spec 8.5); re-exported here with them.
export { MECHANISM_KEYS, MECHANISMS, MechanismSchema } from '@boom-busters/schemas'
export type { Mechanism }

/** What the slot message shows: the technique, its one-line description, and the stored design. */
export interface Exemplar {
  /** A house key, or a channel's own (spec 8.5). */
  technique: TechniqueKey
  description: string
  /** What the design is built on, so the slot message can say "it uses: ..." (spec 8.5). */
  mechanisms: readonly Mechanism[]
  title: string
  source: string
}

/**
 * The manifest joined with whatever designs are stored. A function, not a
 * module-level value, so a client bundle that imports the providers barrel
 * runs nothing here and can drop the stored design sources.
 */
export function exemplars(): readonly (ExemplarEntry & { design?: ExemplarDesign })[] {
  return MANIFEST.map((entry) => {
    const design = DESIGNS[entry.technique]
    return design ? { ...entry, design } : entry
  })
}

/** The exemplar for a technique, or undefined while no design is stored for it. */
export function exemplarFor(technique: Technique): Exemplar | undefined {
  const entry = exemplars().find((candidate) => candidate.technique === technique)
  if (!entry?.design) return undefined
  return {
    technique,
    description: entry.description,
    mechanisms: entry.mechanisms,
    title: entry.design.title,
    source: entry.design.source,
  }
}

/** The vendored template's path, relative to this directory. */
export function vendoredPath(entry: ExemplarEntry): string {
  const name = entry.source.path.split('/').pop() ?? entry.source.path
  return `vendored/${entry.source.repo}/${name}.txt`
}
export { claimedBySteer, techniqueFor } from './technique'
export type { TechniqueInput } from './technique'
export { entryFromProposal } from './channel-technique'
export type { TechniqueEntry } from './channel-technique'
