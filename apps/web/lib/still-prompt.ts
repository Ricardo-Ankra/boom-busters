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
      `The photographs of ${names} are for likeness only: match ` +
        `${people.length === 1 ? 'the face' : 'each face'} exactly, while clothing, pose ` +
        `and expression follow the text above.`,
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
