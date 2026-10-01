import { z } from 'zod'
import { getJson, MAX_PAGES, type ListOptions } from './http'
import type { ListedModel } from './types'

const PageSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      display_name: z.string().optional(),
      max_input_tokens: z.number().nullish(),
      max_tokens: z.number().nullish(),
    }),
  ),
  has_more: z.boolean(),
  last_id: z.string().nullish(),
})

export async function listAnthropicModels(
  apiKey: string,
  options: ListOptions,
): Promise<ListedModel[]> {
  const models: ListedModel[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      'https://api.anthropic.com/v1/models?limit=1000' +
      (after ? `&after_id=${encodeURIComponent(after)}` : '')
    const parsed = PageSchema.parse(
      await getJson(
        'anthropic',
        url,
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        options,
      ),
    )
    for (const model of parsed.data) {
      models.push({
        provider: 'anthropic',
        id: model.id,
        label: model.display_name ?? model.id,
        kind: 'llm',
        preview: false,
        contextTokens: model.max_input_tokens ?? null,
        maxOutputTokens: model.max_tokens ?? null,
        dialect: null,
        pricePerImage: null,
      })
    }
    if (!parsed.has_more || !parsed.last_id) break
    after = parsed.last_id
  }
  return models
}
