import { mockProvidersEnabled } from '@boom-busters/providers'
import type { SetPlate } from '@boom-busters/schemas'
import { callLlm } from '@/lib/llm'
import { getObjectBytes } from '@/lib/storage'

/**
 * The room inventory, drafted from a set's first plate (decision 275): one
 * vision call on the `shotlist` route, a picture-planning task, well under a
 * cent. The owner corrects it once; after that it travels with every shot
 * in the room, so walls no plate shows stay the same wall.
 */

/** What mock mode drafts: fixed, so tests can assert it. */
export const MOCK_LAYOUT = [
  'North wall: [mock] three tall windows, overcast city view.',
  'East wall: [mock] walnut credenza, a door at the south end.',
  'South wall: [mock] glass wall onto the corridor.',
  'West wall: [mock] bare concrete, a dark wall screen.',
  'Centre: [mock] a long walnut table, black mesh chairs, an open laptop.',
  'Light: [mock] overcast daylight from the north windows.',
].join('\n')

const SYSTEM =
  "You describe rooms for a documentary's art department. You write what a location scout " +
  'would note, plainly, and nothing else.'

function request(name: string, look: string): string {
  return (
    `This photograph shows ${name}, facing north.` +
    (look.trim() ? ` The room's look: ${look.trim()}.` : '') +
    ' Write the room inventory as exactly six lines, each starting with its label: ' +
    '"North wall:", "East wall:", "South wall:", "West wall:", "Centre:", "Light:". ' +
    'North is the wall this photograph faces; east is to its right. Describe fixed things ' +
    'only: architecture, furniture, fittings, materials, light sources; no people. Describe ' +
    'the walls the photograph shows as they are, and invent the unseen walls plausibly and ' +
    'consistently with it. At most 25 words per line. Reply with the six lines only.'
  )
}

/** The drafted inventory, or null when the call or the storage read fails. */
export async function draftSetLayout(input: {
  projectId: string
  name: string
  look: string
  plate: SetPlate
}): Promise<string | null> {
  if (mockProvidersEnabled()) return MOCK_LAYOUT
  try {
    const object = await getObjectBytes(input.plate.r2Key)
    const result = await callLlm(
      {
        task: 'shotlist',
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: request(input.name, input.look),
            images: [
              {
                mimeType: input.plate.mimeType,
                data: Buffer.from(object.bytes).toString('base64'),
              },
            ],
          },
        ],
        maxTokens: 600,
      },
      { projectId: input.projectId },
    )
    const text = result.text.trim().slice(0, 1500)
    return text === '' ? null : text
  } catch (error) {
    console.error('[sets] inventory draft failed', error)
    return null
  }
}
