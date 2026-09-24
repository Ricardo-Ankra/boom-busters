import { outputBudget } from '@boom-busters/providers'
import type { LLMTaskRequest } from '@boom-busters/providers'

/**
 * The inventory-draft request (decision 275): a `shotlist` vision call over a
 * set's first plate, asking for the room's six-line inventory.
 *
 * Its own module, pure, with no database, storage or env import, direct or
 * transitive: the live set harness (decision 275, Task 13) builds this
 * request from outside the app and must not drag `set-layout.ts`'s
 * module-load imports (storage) along with it. `draftSetLayout` keeps
 * calling this to build its request, so app behaviour is unchanged.
 */

const SYSTEM =
  "You describe rooms for a documentary's art department. You write what a location scout " +
  'would note, plainly, and nothing else.'

/**
 * The compass is fixed to the frame, not to the room's most prominent wall
 * (live run 1, 2026-09-24): "north is the wall this photograph faces" let the
 * drafter call the window wall north in a diagonal shot, so the inventory and
 * the contact sheet, which treats the plate's own view as north, disagreed.
 */
function request(name: string, look: string): string {
  return (
    `This photograph shows ${name}.` +
    (look.trim() ? ` The room's look: ${look.trim()}.` : '') +
    ' Write the room inventory as exactly six lines, each starting with its label: ' +
    '"North wall:", "East wall:", "South wall:", "West wall:", "Centre:", "Light:". ' +
    'Use a compass fixed to this photograph. ' +
    'North is the far wall straight ahead of the camera, where its line of sight ends at the centre of the frame. ' +
    'West is the wall along the left side of the frame, east is the wall along the right side, ' +
    'and south is the wall behind the camera, which the photograph cannot show. ' +
    'Describe fixed things only: architecture, furniture, fittings, materials, light sources; ' +
    'no people. Describe the walls the photograph shows as they are, and invent the rest ' +
    'plausibly and consistently with it. ' +
    'Describe each wall as its own surface; never as matching another wall. ' +
    'At most 25 words per line. Reply with the six lines only.'
  )
}

export function layoutDraftRequest(input: {
  name: string
  look: string
  image: { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }
}): LLMTaskRequest {
  return {
    task: 'shotlist',
    system: SYSTEM,
    messages: [{ role: 'user', content: request(input.name, input.look), images: [input.image] }],
    // Six short lines, plus the house thinking headroom.
    maxTokens: outputBudget(600),
  }
}
