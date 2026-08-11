import { ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { extractJson, parseJsonCompletion } from './json'

const schema = z.object({ name: z.string(), score: z.number() })

describe('extractJson', () => {
  it('finds a bare object', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}')
  })

  it('strips a markdown fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('ignores prose before and after', () => {
    expect(extractJson('Here you go:\n{"a":1}\nHope that helps!')).toBe('{"a":1}')
  })

  it('keeps nested objects whole', () => {
    // A regex stopping at the first closing brace would truncate this.
    const json = '{"a":{"b":{"c":1}}}'
    expect(extractJson(`prefix ${json} suffix`)).toBe(json)
  })

  it('is not fooled by braces inside strings', () => {
    const json = '{"quote":"they said }{ and left"}'
    expect(extractJson(json)).toBe(json)
  })

  it('is not fooled by an escaped quote inside a string', () => {
    const json = '{"quote":"he said \\"stop\\" loudly"}'
    expect(extractJson(json)).toBe(json)
  })

  it('handles a top-level array', () => {
    expect(extractJson('[{"a":1},{"b":2}]')).toBe('[{"a":1},{"b":2}]')
  })

  it('returns undefined when there is no JSON at all', () => {
    expect(extractJson('I am afraid I cannot help with that.')).toBeUndefined()
  })

  it('returns undefined for a truncated object rather than guessing', () => {
    // Truncation means the content is incomplete, not just the syntax.
    // Closing the brace here would invent data.
    expect(extractJson('{"a":1,"b":')).toBeUndefined()
  })
})

describe('parseJsonCompletion', () => {
  it('parses and validates in one step', () => {
    expect(parseJsonCompletion('{"name":"x","score":1}', schema, 'thing')).toEqual({
      name: 'x',
      score: 1,
    })
  })

  it('explains a refusal rather than reporting a parse error', () => {
    const call = () => parseJsonCompletion('I cannot do that.', schema, 'thing')

    expect(call).toThrow(ValidationError)
    expect(call).toThrow(/returned no JSON/)
    // The model's own words are quoted back, because "no JSON" is useless
    // when the real problem is that it refused.
    expect(call).toThrow(/I cannot do that/)
  })

  it('names the failing field when the shape is wrong', () => {
    const call = () => parseJsonCompletion('{"name":"x"}', schema, 'thing')

    expect(call).toThrow(/score/)
  })

  it('refuses to repair malformed JSON', () => {
    // A trailing comma is trivially fixable and fixing it is still wrong:
    // broken syntax means the generation went wrong, and the run should
    // retry rather than proceed on half a payload.
    expect(() => parseJsonCompletion('{"name":"x","score":1,}', schema, 'thing')).toThrow(
      /malformed JSON/,
    )
  })

  it('truncates a very long refusal in the error message', () => {
    const long = 'no. '.repeat(500)
    const error = (() => {
      try {
        parseJsonCompletion(long, schema, 'thing')
      } catch (e) {
        return e as Error
      }
      return new Error('did not throw')
    })()

    expect(error.message.length).toBeLessThan(400)
  })
})
