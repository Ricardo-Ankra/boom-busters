import { describe, expect, it } from 'vitest'
import {
  THUMB_MARK_PLACEMENTS,
  ThumbnailSetRequestedSchema,
  ThumbnailSettingsSchema,
  figuresIn,
  headlineWords,
  packageInFlight,
  PACKAGE_STALE_MS,
  vetPlannedPackages,
  type PlannedPackage,
} from './thumbnails'

const ID = '01HZX3K9Q8W2N5M7R4T6V8Y0AB'
const ID2 = '01HZX3K9Q8W2N5M7R4T6V8Y0AC'

function pkg(over: Partial<PlannedPackage> = {}): PlannedPackage {
  return {
    idea: 'person',
    angle: 'The founder who sold a story',
    title: 'The $47 Billion Lie',
    headline: 'The $47bn lie',
    picture: {
      subject: 'A founder at a podium',
      framing: '',
      textSide: 'left',
      stillSlotIds: ['s1'],
      depicts: ['Adam Neumann, co-founder of WeWork'],
    },
    claimIds: ['c1'],
    ...over,
  }
}

function input(over: Partial<Parameters<typeof vetPlannedPackages>[0]> = {}) {
  return {
    packages: [pkg()],
    cast: [{ name: 'Adam Neumann' }],
    claims: [{ id: 'c1', text: 'WeWork was valued at $47bn in 2019' }],
    stills: [{ slotId: 's1', depicts: ['Adam Neumann'] }],
    heldIdeas: [] as Parameters<typeof vetPlannedPackages>[0]['heldIdeas'],
    places: 3,
    ...over,
  }
}

describe('ThumbnailSettingsSchema markPlacement', () => {
  it('defaults to the top left and offers no bottom right', () => {
    expect(ThumbnailSettingsSchema.parse({}).markPlacement).toBe('tl')
    expect(THUMB_MARK_PLACEMENTS).toEqual(['none', 'tl', 'tr', 'bl'])
    expect(ThumbnailSettingsSchema.safeParse({ markPlacement: 'br' }).success).toBe(false)
  })
})

describe('headlineWords', () => {
  it('counts headline words', () => {
    expect(headlineWords('')).toBe(0)
    expect(headlineWords('  The $47bn  lie ')).toBe(3)
  })
})

describe('figuresIn', () => {
  it('reads a figure whatever its punctuation', () => {
    expect(figuresIn('$47 Billion in 2019')).toEqual(['47', '2019'])
    expect(figuresIn('47,000 staff.')).toEqual(['47000'])
  })
})

describe('vetPlannedPackages', () => {
  it('keeps a title whose figure a claim holds in other words', () => {
    const out = vetPlannedPackages(input())
    expect(out.kept).toHaveLength(1)
    expect(out.dropped).toEqual([])
  })

  it('keeps 47,000 staff against 47000 employees', () => {
    const out = vetPlannedPackages(
      input({
        packages: [pkg({ title: '47,000 staff', headline: '47,000 staff' })],
        claims: [{ id: 'c1', text: 'It had 47000 employees' }],
      }),
    )
    expect(out.kept).toHaveLength(1)
  })

  it('drops a figure no claim holds', () => {
    const out = vetPlannedPackages(
      input({ packages: [pkg({ title: 'The $48 Billion Lie', headline: 'The lie' })] }),
    )
    expect(out.kept).toEqual([])
    expect(out.dropped).toHaveLength(1)
    expect(out.dropped[0]!.reason).toContain('48')
  })

  it('matches a depicted name the way the cast does', () => {
    expect(vetPlannedPackages(input()).kept).toHaveLength(1)
  })

  it('drops a person no named still shows', () => {
    const out = vetPlannedPackages(
      input({
        packages: [pkg({ picture: { ...pkg().picture, stillSlotIds: [] } })],
      }),
    )
    expect(out.kept).toEqual([])
    expect(out.dropped).toHaveLength(1)
  })

  it('drops a name the cast does not hold', () => {
    const out = vetPlannedPackages(input({ cast: [{ name: 'Someone Else' }] }))
    expect(out.kept).toEqual([])
    expect(out.dropped).toHaveLength(1)
  })

  it('drops an unknown claim id', () => {
    const out = vetPlannedPackages(input({ packages: [pkg({ claimIds: ['nope'] })] }))
    expect(out.kept).toEqual([])
    expect(out.dropped[0]!.reason).toContain('nope')
  })

  it('drops an unknown still', () => {
    const out = vetPlannedPackages(
      input({
        packages: [pkg({ picture: { ...pkg().picture, stillSlotIds: ['ghost'] } })],
      }),
    )
    expect(out.kept).toEqual([])
    expect(out.dropped[0]!.reason).toContain('ghost')
  })

  it('drops a five-word headline', () => {
    const out = vetPlannedPackages(
      input({ packages: [pkg({ headline: 'one two three four five' })] }),
    )
    expect(out.kept).toEqual([])
    expect(out.dropped).toHaveLength(1)
  })

  it('never repeats an idea', () => {
    const two = vetPlannedPackages(input({ packages: [pkg(), pkg({ angle: 'Another way in' })] }))
    expect(two.kept).toHaveLength(1)
    expect(two.dropped).toHaveLength(1)
    const held = vetPlannedPackages(
      input({ packages: [pkg({ idea: 'figure' })], heldIdeas: ['figure'] }),
    )
    expect(held.kept).toEqual([])
    expect(held.dropped[0]!.idea).toBe('figure')
  })

  it('cuts to the free places', () => {
    const out = vetPlannedPackages(
      input({
        packages: [pkg(), pkg({ idea: 'figure' }), pkg({ idea: 'object' })],
        places: 2,
      }),
    )
    expect(out.kept).toHaveLength(2)
  })
})

describe('ThumbnailSetRequestedSchema', () => {
  it('needs a package id for one package', () => {
    expect(
      ThumbnailSetRequestedSchema.safeParse({ projectId: ID, targetId: ID2, mode: 'paint' })
        .success,
    ).toBe(false)
    expect(
      ThumbnailSetRequestedSchema.safeParse({ projectId: ID, targetId: ID2, mode: 'set' }).success,
    ).toBe(true)
    expect(
      ThumbnailSetRequestedSchema.safeParse({
        projectId: ID,
        targetId: ID2,
        mode: 'compose',
        packageId: ID,
      }).success,
    ).toBe(true)
  })
})

describe('packageInFlight', () => {
  const now = new Date('2026-11-25T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)

  it('a planned or painting package is in flight for fifteen minutes', () => {
    expect(PACKAGE_STALE_MS).toBe(15 * 60_000)
    expect(packageInFlight({ state: 'planned', updatedAt: ago(60_000) }, now)).toBe(true)
    expect(packageInFlight({ state: 'painting', updatedAt: ago(PACKAGE_STALE_MS - 1) }, now)).toBe(
      true,
    )
  })

  it('a stale planned package is no longer in flight', () => {
    expect(packageInFlight({ state: 'planned', updatedAt: ago(PACKAGE_STALE_MS + 1) }, now)).toBe(
      false,
    )
    expect(packageInFlight({ state: 'painting', updatedAt: ago(PACKAGE_STALE_MS + 1) }, now)).toBe(
      false,
    )
  })

  it('a ready or failed package is never in flight', () => {
    expect(packageInFlight({ state: 'ready', updatedAt: now }, now)).toBe(false)
    expect(packageInFlight({ state: 'failed', updatedAt: now }, now)).toBe(false)
  })
})
