/**
 * The still prompt's reference declaration (decision 253, 264, 273, 275).
 *
 * Its own module, pure, with no database, storage or env import, direct or
 * transitive: the live set harness (decision 275, Task 13) builds a still
 * prompt from outside the app and must not drag `visual-assets.ts`'s module-
 * load imports (the database client) along with it. `visual-assets.ts` keeps
 * importing this back, so app behaviour is unchanged. `@boom-busters/providers`
 * is safe here — it depends only on `@boom-busters/schemas`, `node-html-parser`
 * and `zod`, none of which touch a database, storage or env, directly or
 * transitively.
 */

import { stripBannedWords } from '@boom-busters/providers'
import type { ReferenceLimits } from '@boom-busters/providers'
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

/**
 * The prompt, closed with a declaration of what is attached and what each
 * photograph is FOR.
 *
 * It COUNTS, because "2 photographs of Markus Braun" tells the model how much
 * evidence it holds where a bare name does not. It names every person rather
 * than referring back to them, because a pronoun here would be a guess about
 * a real person this app has no business making.
 *
 * It gives each kind of photograph one job (decision 273). The first version
 * said the photographs were "authoritative for the likeness and the room;
 * match them exactly", and that "the text describes only what happens in
 * them". The model read it as an edit: every still of a set kept the plate's
 * exact framing, and the person was pasted onto it at the wrong scale, rising
 * through the boardroom table. So a person's photographs are for the face,
 * a room's are for its design, the picture itself is a new one from the
 * camera position the brief names, and a person stands in it rather than on
 * it.
 *
 * Skipped when the prompt already carries the marker, so a re-generation of an
 * already-decorated prompt cannot stack two declarations.
 */
export function withReferenceClause(
  prompt: string,
  people: readonly { name: string; photos: number }[],
  set: { name: string; plates: number } | null,
  camera: string | null,
): string {
  if (prompt.includes(REFERENCE_MARKER)) return prompt
  if (people.length === 0 && set === null) {
    return camera !== null ? `${prompt.trimEnd()}\n\n${camera}` : prompt
  }

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
  if (camera !== null) sentences.push(camera)
  if (set) {
    sentences.push(
      camera !== null
        ? `The photographs of ${set.name} show this room's furniture, materials and light; ` +
            `this photograph is a new one from the camera above.`
        : `The photographs of ${set.name} are for the room's design only: its architecture, ` +
            `materials, furniture and light.`,
    )
    if (camera === null) {
      sentences.push(
        `This is a new photograph taken inside that room from the camera position the text ` +
          `above describes; never reproduce or edit the framing of its photographs.`,
      )
    }
  }

  return `${prompt.trimEnd()}\n\n${sentences.join(' ')}`
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

/** The one place a still's prompt is put together (decision 285). */
export function assembleStillPrompt(input: StillPromptInput): string {
  const body = input.camera
    ? `${framingLead(input.camera, input.shotSize)}${input.scene}`
    : input.scene
  return withReferenceClause(
    stripBannedWords(body),
    input.people,
    input.set,
    input.camera ? describeCamera(input.camera, input.layout, input.shotSize) : null,
  )
}
