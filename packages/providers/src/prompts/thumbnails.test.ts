import { describe, expect, it } from 'vitest'
import { FIRST_CHANNEL_IN_USE, THUMBNAIL_IDEAS } from '@boom-busters/schemas'
import type { PictureBrief } from '@boom-busters/schemas'
import {
  buildThumbnailPicturePrompt,
  buildThumbnailSetRequest,
  mockThumbnailSet,
  parseThumbnailSet,
} from './thumbnails'
import type { ScriptClaim } from './script'

const CLAIM: ScriptClaim = {
  id: '01HQ00000000000000000000AA',
  text: 'Stability AI announced a 101 million dollar funding round in October 2022.',
  sourceUrl: 'https://stability.ai/news',
  confidence: 'sourced',
}

const baseInput = {
  bible: FIRST_CHANNEL_IN_USE,
  channelName: 'Boom & Busters',
  caseTitle: 'Stability AI',
  hook: 'In October 2022 a start-up raised 101 million dollars.',
  claims: [CLAIM],
  cast: [{ name: 'Emad Mostaque', role: 'founder', guardrail: 'Show him as a man in a suit.' }],
  stills: [{ slotId: 'slot-7', shows: 'A founder at a podium', depicts: ['Emad Mostaque'] }],
  places: 2,
  heldIdeas: ['object' as const],
  styleNote: 'Dark, cinematic, high contrast.',
  referenceNotes: ['Bold single subject'],
}

function validPackage(overrides: Record<string, unknown> = {}) {
  return {
    idea: 'figure',
    angle: 'The number is the story.',
    title: 'The 101 million dollar bet',
    headline: 'The big bet',
    picture: {
      subject: 'A huge number on a wall',
      framing: 'Low angle',
      textSide: 'left',
      stillSlotIds: [],
      depicts: [],
    },
    claimIds: [CLAIM.id],
    ...overrides,
  }
}

describe('buildThumbnailSetRequest', () => {
  const request = buildThumbnailSetRequest(baseInput)

  it('asks for the free places only', () => {
    expect(request.system).toContain('exactly 2 packages')
    expect(request.system).toContain('Ideas already taken, never plan these again: object.')
    expect(request.system).toContain('three different ideas')
    expect(request.system).toContain('person is a principal of the story')
    expect(request.system).toContain('contrast is before and after')
    expect(request.system).toContain('at most 4 words')
    expect(request.system).toContain('at most 100 characters')
    expect(request.system).toContain('only a person who is in the cast')
    expect(request.system).toContain('names the claim ids it rests on')
    expect(request.system).toContain('{"packages"')
  })

  it('shows the claims with their ids', () => {
    const content = request.messages.map((m) => m.content).join('\n')
    expect(content).toContain(`(id: ${CLAIM.id})`)
    expect(content).toContain('101 million dollar funding round')
  })

  it('shows each still with its slot id and who it depicts', () => {
    const content = request.messages.map((m) => m.content).join('\n')
    expect(content).toContain('slot-7')
    expect(content).toContain('A founder at a podium')
    expect(content).toContain('Emad Mostaque')
  })

  it('carries the title frame when the format has one', () => {
    const framed = buildThumbnailSetRequest({
      ...baseInput,
      titleFrame: { pattern: 'Cleopatra | History for Sleep', required: ['Cleopatra'] },
    })
    expect(framed.system).toContain('"Cleopatra | History for Sleep"')
    expect(framed.system).toContain('Every title contains: "Cleopatra".')
    expect(request.system).not.toContain('follows this pattern')
  })

  it('leaves past results out when none are given', () => {
    expect(request.messages.map((m) => m.content).join('\n')).not.toContain('Past results')
    const withPast = buildThumbnailSetRequest({ ...baseInput, pastResults: 'Figures won twice.' })
    expect(withPast.messages.map((m) => m.content).join('\n')).toContain('Figures won twice.')
  })
})

describe('parseThumbnailSet', () => {
  it('parses packages and skips a malformed one', () => {
    const text = JSON.stringify({
      packages: [validPackage(), { idea: 'nonsense' }, validPackage({ idea: 'moment' })],
    })
    const parsed = parseThumbnailSet(text)
    expect(parsed.map((p) => p.idea)).toEqual(['figure', 'moment'])
  })

  it('strips blank names and still ids before parsing', () => {
    const text = JSON.stringify({
      packages: [
        validPackage({
          picture: {
            subject: 'A founder',
            textSide: 'right',
            stillSlotIds: ['slot-7', '', '   '],
            depicts: ['', 'Emad Mostaque', '  '],
          },
        }),
      ],
    })
    const [only] = parseThumbnailSet(text)
    expect(only?.picture.stillSlotIds).toEqual(['slot-7'])
    expect(only?.picture.depicts).toEqual(['Emad Mostaque'])
  })
})

describe('mockThumbnailSet', () => {
  it('never plans a person and never repeats a held idea', () => {
    const set = mockThumbnailSet({
      workingTitle: 'Stability',
      places: 3,
      heldIdeas: ['figure'],
      claimIds: ['c1', 'c2'],
    })
    expect(set.map((p) => p.idea)).toEqual(['object', 'moment', 'contrast'])
    expect(THUMBNAIL_IDEAS).toContain(set[0]?.idea)
    for (const p of set) {
      expect(p.title.startsWith('[mock]')).toBe(true)
      expect(p.headline.startsWith('[mock]')).toBe(true)
      expect(p.picture.depicts).toEqual([])
      expect(p.picture.stillSlotIds).toEqual([])
      expect(p.claimIds).toEqual(['c1'])
    }
    expect(
      mockThumbnailSet({ workingTitle: 'x', places: 2, heldIdeas: [], claimIds: ['c1'] }),
    ).toHaveLength(2)
  })
})

describe('buildThumbnailPicturePrompt', () => {
  const picture: PictureBrief = {
    subject: 'A towering stack of cash',
    framing: 'Low angle',
    textSide: 'left',
    stillSlotIds: ['slot-7'],
    depicts: ['Emad Mostaque'],
  }
  const prompt = buildThumbnailPicturePrompt({
    picture,
    styleNote: 'Dark and cinematic.',
    guardrails: [{ name: 'Emad Mostaque', guardrail: 'Show him as a man in a suit.' }],
    attached: { people: ['Emad Mostaque'], stills: 1, styles: 2 },
  })

  it('leads with framing', () => {
    const framing = 'A 16:9 photograph.'
    const clear = 'The left third is plain and uncluttered, kept clear for a headline.'
    expect(prompt.startsWith(framing)).toBe(true)
    const subjectAt = prompt.indexOf('A towering stack of cash')
    expect(prompt.indexOf(clear)).toBeGreaterThan(-1)
    expect(prompt.indexOf(clear)).toBeLessThan(subjectAt)
    expect(prompt.indexOf('at least half the frame height')).toBeLessThan(prompt.indexOf(clear))
    expect(prompt.indexOf('Emad Mostaque')).toBeGreaterThan(subjectAt)
    expect(prompt.indexOf('Show him as a man in a suit.')).toBeGreaterThan(
      prompt.indexOf('Emad Mostaque'),
    )
  })

  it('ends by refusing text and logos', () => {
    expect(
      prompt.endsWith('No text, no letters, no logos, no watermark, no interface elements.'),
    ).toBe(true)
  })

  it('declares only the references that travel', () => {
    expect(prompt).toContain('2 style reference images')
    const bare = buildThumbnailPicturePrompt({
      picture: { ...picture, textSide: 'right', depicts: [] },
      styleNote: 'Dark and cinematic.',
      guardrails: [],
      attached: { people: [], stills: 0, styles: 0 },
    })
    expect(bare).toContain('The right third is plain')
    expect(bare).not.toContain('style reference')
    expect(bare).not.toContain('still')
    expect(bare).not.toContain('Attached')
  })
})
