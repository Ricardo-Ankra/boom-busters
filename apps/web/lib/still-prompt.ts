/**
 * The one place an AI image prompt is assembled, and the still prompt's
 * reference declaration (decision 253, 264, 273, 275, 285).
 *
 * Its own module, pure, with no database, storage or env import, direct or
 * transitive: the live set harness (decision 275, Task 13) builds a still
 * prompt from outside the app and must not drag `visual-assets.ts`'s module-
 * load imports (the database client) along with it. `visual-assets.ts` keeps
 * importing this back; it now assembles the whole prompt (decision 285),
 * rather than decorating one the caller had already put together.
 * `@boom-busters/providers` is safe here — it depends only on
 * `@boom-busters/schemas`, `node-html-parser` and `zod`, none of which touch
 * a database, storage or env, directly or transitively.
 */

import { stripBannedWords } from '@boom-busters/providers'
import type { ReferenceLimits } from '@boom-busters/providers'
import { PHOTOGRAPH_LINE, PLATE_PHOTOGRAPH_LINE, TEASER_COMPOSITION } from './photograph-lines'
import {
  depictedMembers,
  MAX_CHARACTER_REFERENCES,
  MAX_SET_REFERENCES,
  platesForCamera,
  setForBrief,
  spreadReferencePhotos,
} from '@boom-busters/schemas'
import type {
  CastMember,
  CastPhoto,
  ModelRouting,
  ProjectSet,
  SetCamera,
  SetPlate,
  SetPlateDirection,
  ShotBrief,
  ShotSize,
  StillBrief,
  StillRoute,
} from '@boom-busters/schemas'
import { describeCamera, framingLead } from './set-plates'

/**
 * What one still may actually carry: the app's policy (`MAX_CHARACTER_REFERENCES`,
 * `MAX_SET_REFERENCES`, decision 264), never more than the routed model
 * allows. One function because the price estimate and the generator have to
 * spend the same budget, and two copies of this sum once quoted a number no
 * run would spend.
 */
export function referenceBudgets(limits: ReferenceLimits): {
  characters: number
  objects: number
} {
  return {
    characters: Math.min(MAX_CHARACTER_REFERENCES, limits.characters),
    objects: Math.min(MAX_SET_REFERENCES, limits.objects),
  }
}

/**
 * The people this still can actually show a likeness of: the cast members it
 * depicts who have a photograph.
 *
 * This is THE rule, and it is pure so that the generator and the price
 * estimate cannot answer it differently. They did once: the estimate assumed
 * the dearer route for every still and quoted a number no run would ever
 * spend (decision 253, amended). It also has to be settled before the route
 * is chosen, because whether a still needs a likeness is what decides which
 * generator it goes to.
 *
 * A name the cast has never seen, or one with no photograph yet, is not a
 * likeness the app can produce, so such a still is routed, priced and
 * generated as a plain one.
 *
 * Which entry names which member is `depictedMembers` (decision 262). The
 * planner is asked for the name alone and has written "Emad Mostaque,
 * founder and former CEO of Stability AI"; an exact-string join here sent
 * every such still to the plain route, and the estimate agreed with it.
 */
export function depictedFrom(brief: StillBrief, cast: readonly CastMember[]): CastMember[] {
  return depictedMembers(brief.depicts, cast)
    .filter((member) => member.photos.length > 0)
    .slice(0, MAX_CHARACTER_REFERENCES)
}

/**
 * The set this still is shot in, if the project holds it and it has a plate,
 * as a synchronous rule that mirrors `depictedFrom`. A named set nobody has
 * photographed conditions nothing, exactly like a `depicts` name with no
 * photograph, so it is treated as no set at all and the plan screen says so.
 *
 * Sync, and taking the project's sets rather than a project id, for the same
 * reason `depictedFrom` does: the estimate and the generator must read it
 * from a list already loaded, not query it once per brief (a 48-still film
 * must not fire 48 identical set queries to show one price).
 */
export function setFrom(brief: StillBrief, sets: readonly ProjectSet[]): ProjectSet | null {
  const found = setForBrief(brief.set, sets)
  return found && found.plates.length > 0 ? found : null
}

/**
 * Where a still goes, before the owner has said otherwise (decision 264).
 *
 * A still that carries any reference needs the reference-capable route, and
 * that is what `stillsLikeness` is; the setting keeps its name because a
 * likeness is still the reason it exists. A null split means there is one
 * route and this changes nothing.
 */
export function routeForBrief(
  brief: ShotBrief,
  cast: readonly CastMember[],
  sets: readonly ProjectSet[],
  routing: ModelRouting,
): StillRoute {
  if (brief.type !== 'still' && brief.type !== 'hero') return routing.stills
  const people = depictedMembers(brief.depicts, cast).filter((m) => m.photos.length > 0)
  const set = setForBrief(brief.set, sets)
  const conditioned = people.length > 0 || (set !== null && set.plates.length > 0)
  return conditioned && routing.stillsLikeness ? routing.stillsLikeness : routing.stills
}

/**
 * The declaration that closes a prompt carrying references, and the marker that
 * stops it being written twice.
 *
 * The adapters send flat inline images with no labels, so the prompt is the only
 * thing that can say what each photograph IS. It used to say so as a fragment
 * glued to the front ("Emad Mostaque, the person in the reference photo, at a
 * podium..."), which named the references but never ranked them, and the models
 * followed the sentence and invented the face anyway (owner report, 2026-09-22).
 * It now closes the prompt instead, counts what actually travelled, and says
 * outright that the images outrank the words.
 *
 * Built from the photographs that ACTUALLY went, never from what the brief asked
 * for. A set with no plates, or a model whose object budget is zero, attaches
 * nothing, and a prompt promising references the call never carried would be
 * lying to the model about its own input.
 */
export const REFERENCE_MARKER = 'References attached:'

/** "2 photographs", "1 photograph" — the inventory counts what really travelled. */
export function photographCount(count: number): string {
  return count === 1 ? '1 photograph' : `${count} photographs`
}

/** "a, b and c" — an English list, so the declaration reads as a sentence. */
export function andList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/*
 * What the planner used to paste into every prompt (decisions 252 to 275),
 * matched by shape rather than by today's Brand Kit values, because a kit
 * edited since planning would otherwise leave its old anchors behind.
 */
const LEGACY_HOUSE_LINE =
  /An available-light documentary photograph,[^.;]*?real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line(?:; people caught candid and mid-moment, never posing or acting for the camera)?\./g
const LEGACY_ANCHORS =
  /(?:[a-z]+ film grain|clean, no grain); muted documentary colour grade anchored on #[0-9a-f]{3,8} and #[0-9a-f]{3,8} against #[0-9a-f]{3,8}; sombre, photographic realism\.?/gi
// A hex accent never occurs in prose, so it strips unconditionally. A named
// one ("accent muted gold, cold;") reads exactly like prose that happens to
// mention an accent wall or an accent colour, so it strips only when the
// legacy anchors clause follows it directly — the shape it was actually
// pasted in, never on its own (re-review probes: "The room's accent wall is
// bold, cold; a draught crept under the door.", "He picked an accent
// colour, warm; she disagreed.").
const LEGACY_PALETTE_HEX = /accent #[0-9a-f]{3,8}, (?:cold|neutral|warm);/gi
const LEGACY_PALETTE_NAMED =
  /accent [^,;.#]{1,40}, (?:cold|neutral|warm);(?=\s*(?:[a-z]+ film grain|clean, no grain); muted documentary colour grade)/gi
const LEGACY_TEASER_CLAUSE =
  'Vertical 9:16 frame: subject in the centre third, headroom above for the hook text, nothing important in the bottom quarter where captions sit.'

/**
 * The planner's own words in a stored prompt (decision 285): the scene, with
 * every line code now adds taken back out. Stored briefs are never rewritten,
 * so no brief hash moves and no resolved slot is bought again; the strip
 * happens each time a prompt is read. Idempotent.
 */
export function sceneOf(prompt: string): string {
  const marker = prompt.indexOf(REFERENCE_MARKER)
  const own = marker === -1 ? prompt : prompt.slice(0, marker)
  return (
    own
      .replace(LEGACY_HOUSE_LINE, ' ')
      // The named-palette lookahead needs the anchors clause still in
      // place, so the palette strips run before the anchors strip.
      .replace(LEGACY_PALETTE_HEX, ' ')
      .replace(LEGACY_PALETTE_NAMED, ' ')
      .replace(LEGACY_ANCHORS, ' ')
      .split(LEGACY_TEASER_CLAUSE)
      .join(' ')
      .replace(/[ \t]{2,}/g, ' ')
      // Only a run a strip leaves behind, punctuation separated by whitespace,
      // collapses: "e.g., a ledger" and "He waits... then signs." have no
      // whitespace between their marks and must survive untouched.
      .replace(/([.;,])(?:\s+[.;,])+/g, '$1')
      .replace(/\s+([,.;:])/g, '$1')
      .trim()
  )
}

/**
 * What each attached photograph is for (decisions 253, 264, 273, 276): the
 * sentences that used to close the prompt, now one segment of it. Counted
 * from what actually travels.
 */
export function referenceSentences(
  people: readonly { name: string; photos: number }[],
  set: { name: string; plates: number } | null,
  hasCamera: boolean,
): string[] {
  if (people.length === 0 && set === null) return []
  const inventory = andList([
    ...people.map((person) => `${photographCount(person.photos)} of ${person.name}`),
    ...(set ? [`${photographCount(set.plates)} of ${set.name}`] : []),
  ])
  const sentences = [`${REFERENCE_MARKER} ${inventory}.`]
  if (people.length > 0) {
    const names = andList(people.map((person) => person.name))
    sentences.push(
      // Glasses and hair named (live run 10): "the face" alone let a close
      // shot drop the glasses every photograph showed.
      `The photographs of ${names} are for likeness only: match ` +
        `${people.length === 1 ? 'the face' : 'each face'} exactly, with its hair, facial hair ` +
        `and glasses, while clothing, pose and expression follow the text above.`,
      // Live runs 9 and 11: an extra came out as a second copy of the cast
      // member, the same beard and glasses on a stranger.
      `Everyone else in the frame is a different person, unlike ` +
        `${people.length === 1 ? names : 'any of them'} in face, hair and age.`,
      `${people.length === 1 ? names : 'Each person'} is photographed in the scene, never ` +
        `pasted onto it: at true scale, seated in a chair or standing on the floor, lit by ` +
        `the scene's own light, and behind anything standing nearer the camera.`,
    )
  }
  if (set) {
    // Positive either way (decision 285): "never reproduce or edit the
    // framing" read as an edit instruction, the fault decision 275 found.
    sentences.push(
      `The photographs of ${set.name} show this room's furniture, materials and light; this ` +
        `photograph is a new one ${hasCamera ? 'from the camera described above' : 'taken inside it'}.`,
    )
  }
  return sentences
}

/** What one still carries: the photographs and plates that actually travel, and the counts the prompt names. */
export interface StillReferencePlan {
  photos: { member: CastMember; photo: CastPhoto }[]
  plates: SetPlate[]
  people: { name: string; photos: number }[]
  setName: string | null
}

/**
 * The references a still spends (decision 264): people first, because a
 * wrong face is worse than a wrong room, then the plates nearest the camera.
 * Pure, so the generator, the estimate, the board preview and the live
 * harness count exactly the same photographs.
 */
export function planStillReferences(
  members: readonly CastMember[],
  set: ProjectSet | null,
  budgets: { characters: number; objects: number },
  facing?: SetPlateDirection,
): StillReferencePlan {
  const photos = spreadReferencePhotos(members, budgets.characters)
  const plates = set ? platesForCamera(set, facing, budgets.objects) : []
  const names = [...new Set(photos.map(({ member }) => member.name))]
  return {
    photos,
    plates,
    people: names.map((name) => ({
      name,
      photos: photos.filter(({ member }) => member.name === name).length,
    })),
    setName: plates.length > 0 && set ? set.name : null,
  }
}

export type StillKind = 'still' | 'plate' | 'teaser'

export interface StillPromptInput {
  /** The brief's stored prompt. */
  scene: string
  shotSize?: ShotSize
  camera?: SetCamera
  /** The named set's inventory, or '' when the brief names none. */
  layout: string
  people: readonly { name: string; photos: number }[]
  set: { name: string; plates: number } | null
  kind?: StillKind
}

/**
 * The one place an image prompt is put together (decision 285). Order:
 * framing, the camera and the room it sees, the scene, what the photographs
 * are for, the photograph line. The opening of a prompt wins (decision 275's
 * live runs), so the geometry comes before the scene rather than after it.
 * The avoid list is the adapter's, which knows whether its model has a real
 * negative field.
 */
export function assembleStillPrompt(input: StillPromptInput): string {
  const kind = input.kind ?? 'still'
  const camera = input.camera ? describeCamera(input.camera, input.layout, input.shotSize) : null
  const references = referenceSentences(input.people, input.set, camera !== null)
  return [
    kind === 'plate' ? '' : framingLead(input.camera, input.shotSize),
    camera ?? '',
    stripBannedWords(sceneOf(input.scene)),
    kind === 'teaser' ? TEASER_COMPOSITION : '',
    references.join(' '),
    kind === 'plate' ? PLATE_PHOTOGRAPH_LINE : PHOTOGRAPH_LINE,
  ]
    .filter((part) => part.trim() !== '')
    .join('\n\n')
}
