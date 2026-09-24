import { mockProvidersEnabled } from '@boom-busters/providers'
import type { SetPlate } from '@boom-busters/schemas'
import { callLlm } from '@/lib/llm'
import { layoutDraftRequest } from '@/lib/set-layout-prompt'
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

/**
 * The drafted inventory, or null when the call or the storage read fails, or
 * the reply was cut off at its budget: half an inventory would travel with
 * every shot in the room as if it were the whole room.
 */
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
      layoutDraftRequest({
        name: input.name,
        look: input.look,
        image: {
          mimeType: input.plate.mimeType,
          data: Buffer.from(object.bytes).toString('base64'),
        },
      }),
      { projectId: input.projectId },
    )
    if (result.truncated) {
      console.error('[sets] inventory draft was cut off at its token budget')
      return null
    }
    const text = result.text.trim().slice(0, 1500)
    return text === '' ? null : text
  } catch (error) {
    console.error('[sets] inventory draft failed', error)
    return null
  }
}
