import {
  EMPTY_BIBLE,
  EXAMPLE_SLOTS,
  FIRST_CHANNEL_BIBLE,
  bibleDraftUnits,
  defaultFormat,
} from '@boom-busters/schemas'
import type { BibleDraftInputs, ChannelBible } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  bibleUnitSchema,
  buildBibleUnitRequest,
  mergeBibleUnit,
  parseBibleUnit,
} from './bible-draft'
import { mockBibleUnit, mockResearchDigest } from './bible-mocks'

const INPUTS: BibleDraftInputs = {
  description: 'psychology experiments',
  audience: 'curious adults',
  admiredChannels: ['Veritasium'],
  videos: [],
  avoid: 'gossip',
}
const EXAMPLE_HEADING =
  'An example of shape and level of detail, from another channel. Do not reuse its subjects or words.'
const HOOKS_RULE =
  "Write each entry as this channel's own line for a case it could make. Name the pattern in `note` and list the videos it came from in `drawnFrom`, from the research sources only. Never copy a line from them."

const scriptUnit = bibleDraftUnits().find((u) => 'source' in u && u.source === 'script.ts')!
const scriptSlots = EXAMPLE_SLOTS.filter((s) => s.source === 'script.ts')

describe('bibleUnitSchema', () => {
  it('takes a section as the strict pick of its fields', () => {
    const schema = bibleUnitSchema({ section: 'search' })
    const answer = mockBibleUnit({ section: 'search' })
    expect(schema.parse(answer)).toEqual(answer)
    expect(schema.safeParse({ ...answer, subject: 'x' }).success).toBe(false)
    const { language: _language, ...missing } = answer
    expect(schema.safeParse(missing).success).toBe(false)
  })

  it('takes the formats section as a list of formats and refuses an answer without it', () => {
    const schema = bibleUnitSchema({ section: 'formats' })
    expect(schema.safeParse({ formats: [defaultFormat('Sleep')] }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('refuses a language that is a name, not a code, so the model is retried', () => {
    const schema = bibleUnitSchema({ section: 'search' })
    const answer = mockBibleUnit({ section: 'search' })
    expect(schema.safeParse({ ...answer, language: 'English' }).success).toBe(false)
    expect(schema.safeParse({ ...answer, language: 'en-GB' }).success).toBe(true)
  })

  it('refuses an examples answer with an id from another group, an extra key or an overlong entry', () => {
    const schema = bibleUnitSchema(scriptUnit)
    const good = mockBibleUnit(scriptUnit)
    expect(schema.safeParse(good).success).toBe(true)
    const examples = good.examples!
    const first = scriptSlots[0]!
    const foreign = EXAMPLE_SLOTS.find((s) => s.source !== 'script.ts')!
    const { [first.id]: _removed, ...without } = examples
    // another group's id in place of one of the group's
    expect(schema.safeParse({ examples: { ...without, [foreign.id]: 'x' } }).success).toBe(false)
    // an extra key
    expect(schema.safeParse({ examples: { ...examples, [foreign.id]: 'x' } }).success).toBe(false)
    // a missing id
    expect(schema.safeParse({ examples: without }).success).toBe(false)
    // over its slot's limit, and empty
    const long = { examples: { ...examples, [first.id]: 'a'.repeat(first.maxLength + 1) } }
    expect(schema.safeParse(long).success).toBe(false)
    expect(schema.safeParse({ examples: { ...examples, [first.id]: '' } }).success).toBe(false)
    // a field outside examples
    expect(schema.safeParse({ ...good, subject: 'x' }).success).toBe(false)
  })

  it('takes a single slot unit as that slot alone', () => {
    const unit = { section: 'examples', slotId: scriptSlots[0]!.id } as const
    expect(bibleUnitSchema(unit).safeParse(mockBibleUnit(unit)).success).toBe(true)
    expect(bibleUnitSchema(unit).safeParse(mockBibleUnit(scriptUnit)).success).toBe(false)
  })
})

describe('parseBibleUnit and mergeBibleUnit', () => {
  it('parses a fenced answer and refuses a wrong shape', () => {
    const unit = { section: 'voice' } as const
    const text = '```json\n' + JSON.stringify(mockBibleUnit(unit)) + '\n```'
    expect(parseBibleUnit(unit, text)).toEqual(mockBibleUnit(unit))
    expect(() => parseBibleUnit(unit, '{"narrationRegister": "x"}')).toThrow(/bible section/)
  })

  it('merges examples by key and replaces other keys', () => {
    const draft: ChannelBible = {
      ...EMPTY_BIBLE,
      subject: 'kept',
      examples: { 'script-foreshadow': 'old', 'dossier-claims-focus': 'stays' },
    }
    const merged = mergeBibleUnit(
      draft,
      { section: 'examples', slotId: 'script-foreshadow' },
      { examples: { 'script-foreshadow': 'new' } },
    )
    expect(merged.examples).toEqual({ 'script-foreshadow': 'new', 'dossier-claims-focus': 'stays' })
    expect(merged.subject).toBe('kept')
    const replaced = mergeBibleUnit(draft, { section: 'identity' }, { subject: 'fresh' })
    expect(replaced.subject).toBe('fresh')
    expect(replaced.examples).toEqual(draft.examples)
  })
})

describe('buildBibleUnitRequest', () => {
  const base = { channelName: 'Quiet Minds', inputs: null, research: null, draft: EMPTY_BIBLE }

  it('for voice holds the example heading and the steer, and no psychology words', () => {
    const request = buildBibleUnitRequest({
      ...base,
      unit: { section: 'voice' },
      steer: 'Make it warmer',
    })
    const content = request.messages[0]!.content
    expect(request.task).toBe('bible')
    expect(content).toContain(EXAMPLE_HEADING)
    expect(content).toContain('The owner asks: Make it warmer')
    expect(content).toContain('narrationRegister')
    expect(content).toContain(FIRST_CHANNEL_BIBLE.narrationRegister)
    expect(content).toMatch(/JSON object/)
    expect(content).not.toContain('Already drafted')
    expect(content).not.toContain("The owner's inputs")
    const text = (request.system + content).toLowerCase()
    for (const word of ['psycholog', 'experiment', 'volunteer']) expect(text).not.toContain(word)
  })

  it('guides the formats unit with the intent and pillar keyword lines', () => {
    const formats = buildBibleUnitRequest({ ...base, unit: { section: 'formats' } })
    expect(formats.messages[0]!.content).toContain('"calm" for one made to relax or fall asleep to')
    const identity = buildBibleUnitRequest({ ...base, unit: { section: 'identity' } })
    expect(identity.messages[0]!.content).toContain(
      'keywords: up to 6 search phrases for that pillar',
    )
    expect(identity.messages[0]!.content).toContain('the pillars (kinds of film)')
    expect(identity.messages[0]!.content).not.toContain('keywordContext')
  })

  it('orders the sections as the brief lists them', () => {
    const request = buildBibleUnitRequest({
      ...base,
      unit: { section: 'hooks' },
      inputs: INPUTS,
      research: mockResearchDigest(INPUTS),
      draft: { ...EMPTY_BIBLE, subject: 'an already drafted subject' },
      steer: 'Shorter',
      previousError: 'too long',
    })
    const content = request.messages[0]!.content
    const order = [
      "The owner's inputs",
      'Research digest',
      'an already drafted subject',
      '- hooks:',
      EXAMPLE_HEADING,
      HOOKS_RULE,
      'The owner asks: Shorter',
      'Your last answer was refused: too long',
      'Answer with one JSON object',
    ].map((part) => content.indexOf(part))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('leaves the hooks rule out of other units', () => {
    const request = buildBibleUnitRequest({ ...base, unit: { section: 'look' } })
    expect(request.messages[0]!.content).not.toContain('Never copy a line from them')
  })

  it('lists each slot of an examples unit with its id, teaches and kind', () => {
    const request = buildBibleUnitRequest({ ...base, unit: scriptUnit })
    const content = request.messages[0]!.content
    for (const slot of scriptSlots) {
      expect(content).toContain(slot.id)
      expect(content).toContain(slot.teaches)
      expect(content).toContain(`(${slot.kind},`)
    }
    expect(request.maxTokens).toBeGreaterThan(4000)
  })

  it('leaves owner text as typed, brackets included, and the draft out of its own unit', () => {
    const request = buildBibleUnitRequest({
      ...base,
      unit: { section: 'identity' },
      steer: 'Keep [[example:script-foreshadow]] out',
      draft: { ...EMPTY_BIBLE, subject: 'own subject', narrationRegister: 'a [[if:x-y]] register' },
    })
    const content = request.messages[0]!.content
    expect(content).toContain('Keep [[example:script-foreshadow]] out')
    expect(content).toContain('a [[if:x-y]] register')
    expect(content).not.toContain('own subject')
    expect(content).not.toContain('')
  })
})
