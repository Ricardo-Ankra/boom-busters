import { describe, expect, it } from 'vitest'
import { falDialect } from './fal-dialect'

function openapi(properties: string[], via: 'ref' | 'name' = 'ref') {
  const schema = { type: 'object', properties: Object.fromEntries(properties.map((p) => [p, {}])) }
  return {
    paths:
      via === 'ref'
        ? {
            '/fal-ai/x': {
              post: {
                requestBody: {
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/XIn' } } },
                },
              },
            },
          }
        : {},
    components: { schemas: via === 'ref' ? { XIn: schema } : { XInput: schema } },
  }
}

describe('falDialect (decision 287)', () => {
  it('reads flux, aspect and aspect-negative from the input schema', () => {
    expect(falDialect(openapi(['prompt', 'num_images', 'image_size']))).toBe('flux')
    expect(falDialect(openapi(['prompt', 'num_images', 'aspect_ratio']))).toBe('aspect')
    expect(falDialect(openapi(['prompt', 'num_images', 'aspect_ratio', 'negative_prompt']))).toBe(
      'aspect-negative',
    )
  })

  it('falls back to a schema named ...Input', () => {
    expect(falDialect(openapi(['prompt', 'num_images', 'image_size'], 'name'))).toBe('flux')
  })

  it('refuses an endpoint that makes one image per request, or has no schema', () => {
    expect(falDialect(openapi(['prompt', 'image_size']))).toBeNull()
    expect(falDialect(undefined)).toBeNull()
    expect(falDialect({ error: 'expansion failed' })).toBeNull()
  })
})
