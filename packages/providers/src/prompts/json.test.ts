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

  it('calls a cut-off answer cut off, and points at maxTokens', () => {
    // Verbatim from the production run mirror: the model wrote most of a good
    // brief and ran out of tokens mid-sentence. The old message was "returned
    // no JSON… It answered: {" — which sends you to read a prompt that is
    // fine, and never mentions the budget that actually ran out.
    const call = () =>
      parseJsonCompletion(
        '{\n  "summary": "Carillion plc was the UK\'s second-largest construction firm and a major',
        schema,
        'case brief',
      )

    expect(call).toThrow(ValidationError)
    expect(call).toThrow(/cut off mid-answer/)
    expect(call).toThrow(/maxTokens/)
    expect(call).not.toThrow(/returned no JSON/)
  })

  it('does not call a prose refusal truncated just because it contains a brace', () => {
    // A paragraph that trails off into a stray brace is a model declining, not
    // a model running out of room, and "raise maxTokens" would be nonsense
    // advice. The opener has to arrive early, as it does when a model actually
    // answers in JSON.
    expect(() =>
      parseJsonCompletion(
        'I am not able to research this case, because every source I can reach is behind a ' +
          'paywall and I will not invent one. For reference the shape you wanted was {incomplete',
        schema,
        'thing',
      ),
    ).toThrow(/returned no JSON/)
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

describe('parseJsonCompletion past a stray bracket (decision 472)', () => {
  const answer = '{"name":"x","score":1}'

  it('finds the answer behind a fragment of code in the prose before it', () => {
    // Production: "Unexpected token 'h', "[head.length - 1]" is not valid JSON".
    const text = `I'll take the last word with words[head.length - 1] and land it.\n\n${answer}`
    expect(parseJsonCompletion(text, schema, 'thing')).toEqual({ name: 'x', score: 1 })
  })

  it('finds the answer behind a brace in the prose before it', () => {
    // Production: "Expected property name or '}' in JSON at position 1".
    const text = `The insets come in as {top, right, bottom, left}.\n${answer}`
    expect(parseJsonCompletion(text, schema, 'thing')).toEqual({ name: 'x', score: 1 })
  })

  it('finds the answer behind a stray array that parses but is the wrong shape', () => {
    // Production: "(root): Invalid input: expected object, received array".
    const text = `Timings [1, 2, 3] first, then:\n\`\`\`json\n${answer}\n\`\`\``
    expect(parseJsonCompletion(text, schema, 'thing')).toEqual({ name: 'x', score: 1 })
  })

  it('never takes a nested piece of a wrong answer for the whole', () => {
    // The answer itself is the wrong shape; a piece inside it happens to fit.
    const text = '{"wrapper": {"name":"x","score":1}}'
    expect(() => parseJsonCompletion(text, schema, 'thing')).toThrow(/did not match/)
  })

  it('keeps the first region’s error when nothing else fits', () => {
    expect(() => parseJsonCompletion('Using [a] and {"name":"x"} only.', schema, 'thing')).toThrow(
      /malformed JSON/,
    )
  })

  describe('with a schema any object fits', () => {
    const loose = z.looseObject({})

    it('never takes a piece nested in a malformed answer behind a stray bracket', () => {
      const text = 'Using [a] first.\n{"source": "x", "props": {"a": 1}, broken}'
      expect(() => parseJsonCompletion(text, loose, 'thing')).toThrow(/malformed JSON/)
    })

    it('still calls a cut-off answer cut off when it holds a closed object', () => {
      const text = '{"source": "const s = {}; return null", "title": "unfinish'
      expect(() => parseJsonCompletion(text, loose, 'thing')).toThrow(/cut off mid-answer/)
    })
  })

  it('still calls an answer cut off when it is', () => {
    const text = '{"name":"x","items":[{"a":1},{"b":'
    expect(() => parseJsonCompletion(text, schema, 'thing')).toThrow(/cut off mid-answer/)
  })
})
