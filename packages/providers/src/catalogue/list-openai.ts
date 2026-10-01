import { z } from 'zod'
import { getJson, type ListOptions } from './http'
import type { ListedModel } from './types'

const ResponseSchema = z.object({ data: z.array(z.object({ id: z.string() })) })

/** Words that mark a model this app's chat calls cannot use. */
const EXCLUDED = [
  'embedding',
  'tts',
  'transcribe',
  'audio',
  'realtime',
  'image',
  'search',
  'moderation',
  'dall-e',
  'whisper',
]
const DATED = /-\d{4}-\d{2}-\d{2}$/

export async function listOpenAiModels(
  apiKey: string,
  options: ListOptions,
): Promise<ListedModel[]> {
  const parsed = ResponseSchema.parse(
    await getJson(
      'openai',
      'https://api.openai.com/v1/models',
      { Authorization: `Bearer ${apiKey}` },
      options,
    ),
  )
  const chat = parsed.data
    .map((model) => model.id)
    .filter(
      (id) =>
        (id.startsWith('gpt-') || /^o\d/.test(id)) && !EXCLUDED.some((word) => id.includes(word)),
    )
  const ids = new Set(chat)
  return chat
    .filter((id) => !(DATED.test(id) && ids.has(id.replace(DATED, ''))))
    .map((id) => ({
      provider: 'openai' as const,
      id,
      label: id,
      kind: 'llm' as const,
      preview: false,
      contextTokens: null,
      maxOutputTokens: null,
      dialect: null,
      pricePerImage: null,
    }))
}
