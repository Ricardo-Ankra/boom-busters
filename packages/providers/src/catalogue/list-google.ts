import { z } from 'zod'
import { getJson, MAX_PAGES, type ListOptions } from './http'
import type { ListedModel } from './types'

const PageSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        displayName: z.string().optional(),
        inputTokenLimit: z.number().optional(),
        outputTokenLimit: z.number().optional(),
        supportedGenerationMethods: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
})

const EXCLUDED = ['embedding', 'tts', 'audio', 'live', 'aqa']

export async function listGoogleModels(
  apiKey: string,
  options: ListOptions,
): Promise<ListedModel[]> {
  const models: ListedModel[] = []
  let token: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' +
      (token ? `&pageToken=${encodeURIComponent(token)}` : '')
    const parsed = PageSchema.parse(
      await getJson('google', url, { 'x-goog-api-key': apiKey }, options),
    )
    for (const model of parsed.models) {
      const id = model.name.replace(/^models\//, '')
      if (!model.supportedGenerationMethods.includes('generateContent')) continue
      if (EXCLUDED.some((word) => id.includes(word))) continue
      models.push({
        provider: 'google',
        id,
        label: model.displayName ?? id,
        kind: id.includes('-image') ? 'image' : 'llm',
        preview: /-preview|-exp/.test(id),
        contextTokens: model.inputTokenLimit ?? null,
        maxOutputTokens: model.outputTokenLimit ?? null,
        dialect: null,
        pricePerImage: null,
      })
    }
    if (!parsed.nextPageToken) break
    token = parsed.nextPageToken
  }
  return models
}
