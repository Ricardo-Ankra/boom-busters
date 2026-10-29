import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXAMPLE_SLOT_IDS,
  EXAMPLE_SLOTS,
  FIRST_CHANNEL_BIBLE,
  MAX_EXAMPLE_SLOTS,
  isBibleComplete,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { markersIn } from '../bible'
import { FINANCE_WORDS, PSYCHOLOGY_TEST_BIBLE } from './psychology-bible'

const here = dirname(fileURLToPath(import.meta.url))
const normalise = (text: string) => text.replace(/\r\n/g, '\n')

/** A prompt file as it stands, line endings normalised. */
const readPromptFile = (name: string) => normalise(readFileSync(join(here, '..', name), 'utf8'))

/**
 * Slots whose text spans a `${...}` interpolation in their source, so it is
 * not a run of the raw file but is a run of the prompt the model is sent. Only
 * these may be proved from a fixture, and only from the fixtures of the
 * builder that owns them (the graphics cases).
 */
const COMPOSED_ONLY: Record<string, string> = {
  'graphics-worked-beat': 'graphics-',
  'graphics-worked-chart': 'graphics-',
}

/** Every composed request the Task 2 fixtures captured: file name, system prompt and messages. */
const fixtures = readdirSync(join(here, '__fixtures__'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    const request = JSON.parse(
      normalise(readFileSync(join(here, '__fixtures__', file), 'utf8')),
    ) as {
      system?: string
      messages?: { content: unknown }[]
    }
    const text = [
      request.system ?? '',
      ...(request.messages ?? []).map((m) =>
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      ),
    ].join('\n')
    return { file, text }
  })

describe('the slot registry', () => {
  it.each(EXAMPLE_SLOTS)('$id is cut verbatim from its source', (slot) => {
    const source = readPromptFile(slot.source)
    const text = FIRST_CHANNEL_BIBLE.examples[slot.id]!
    expect(text).toBeDefined()
    if (markersIn(source).includes(slot.id)) {
      // Swapped for its marker: the byte proof now lives in the lift fixtures.
      expect(source.includes(text)).toBe(false)
    } else if (slot.id in COMPOSED_ONLY) {
      expect(source.includes(text)).toBe(false)
      const prefix = COMPOSED_ONLY[slot.id]!
      expect(fixtures.some((x) => x.file.startsWith(prefix) && x.text.includes(text))).toBe(true)
    } else {
      expect(source.includes(text)).toBe(true)
    }
    expect(text.length).toBeLessThanOrEqual(slot.maxLength)
  })

  it('is within the ceiling and its ids are unique', () => {
    expect(EXAMPLE_SLOTS.length).toBe(46)
    expect(EXAMPLE_SLOTS.length).toBeLessThanOrEqual(MAX_EXAMPLE_SLOTS)
    expect(new Set(EXAMPLE_SLOT_IDS).size).toBe(EXAMPLE_SLOT_IDS.length)
    expect(Object.keys(FIRST_CHANNEL_BIBLE.examples).sort()).toEqual([...EXAMPLE_SLOT_IDS].sort())
  })

  it('has a teaches line for every slot', () => {
    for (const slot of EXAMPLE_SLOTS) expect(slot.teaches.trim().length).toBeGreaterThan(10)
  })
})

describe('the psychology test bible', () => {
  it('is complete and finance-free', () => {
    expect(isBibleComplete(PSYCHOLOGY_TEST_BIBLE)).toBe(true)
    const everything = JSON.stringify(PSYCHOLOGY_TEST_BIBLE).toLowerCase()
    expect(FINANCE_WORDS.filter((word) => everything.includes(word))).toEqual([])
  })

  it('fills exactly the registry, within each slot limit', () => {
    expect(Object.keys(PSYCHOLOGY_TEST_BIBLE.examples).sort()).toEqual([...EXAMPLE_SLOT_IDS].sort())
    for (const slot of EXAMPLE_SLOTS) {
      expect(PSYCHOLOGY_TEST_BIBLE.examples[slot.id]!.length).toBeLessThanOrEqual(slot.maxLength)
    }
  })

  it('gives a different example from Boom & Busters for every slot', () => {
    for (const id of EXAMPLE_SLOT_IDS) {
      expect(PSYCHOLOGY_TEST_BIBLE.examples[id]).not.toBe(FIRST_CHANNEL_BIBLE.examples[id])
    }
  })
})
