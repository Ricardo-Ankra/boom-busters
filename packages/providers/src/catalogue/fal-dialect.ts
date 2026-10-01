import type { FalDialect } from '../visuals/types'

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The input schema fal publishes for an endpoint: the one its POST
 * `requestBody` references, or failing that the first schema named
 * `...Input`. Null when the document has neither.
 */
function inputSchema(openapi: unknown): Json | null {
  if (!isRecord(openapi)) return null
  const components = isRecord(openapi['components']) ? openapi['components'] : {}
  const schemas = isRecord(components['schemas']) ? components['schemas'] : {}
  const paths = isRecord(openapi['paths']) ? openapi['paths'] : {}

  for (const path of Object.values(paths)) {
    if (!isRecord(path) || !isRecord(path['post'])) continue
    const body = path['post']['requestBody']
    const content = isRecord(body) && isRecord(body['content']) ? body['content'] : {}
    const json = isRecord(content['application/json']) ? content['application/json'] : {}
    const schema = isRecord(json['schema']) ? json['schema'] : null
    if (!schema) continue
    const ref = typeof schema['$ref'] === 'string' ? schema['$ref'] : null
    if (ref) {
      const target = schemas[ref.replace('#/components/schemas/', '')]
      if (isRecord(target)) return target
    } else if (isRecord(schema['properties'])) {
      return schema
    }
  }

  const named = Object.entries(schemas).find(
    ([name, value]) => name.endsWith('Input') && isRecord(value),
  )
  return named ? (named[1] as Json) : null
}

/** Which request shape an endpoint speaks, or null if this app cannot send it one (decision 288). */
export function falDialect(openapi: unknown): FalDialect | null {
  const schema = inputSchema(openapi)
  const properties = schema && isRecord(schema['properties']) ? schema['properties'] : null
  if (!properties) return null
  const has = (field: string) => field in properties
  // The board buys several variants in one call; an endpoint without
  // num_images makes one image per request and cannot serve it.
  if (!has('prompt') || !has('num_images')) return null
  if (has('image_size')) return 'flux'
  if (has('aspect_ratio')) return has('negative_prompt') ? 'aspect-negative' : 'aspect'
  return null
}
