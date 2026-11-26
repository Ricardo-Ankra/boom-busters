import { describe, expect, it } from 'vitest'
import {
  THUMB_MARK_PLACEMENTS,
  ThumbnailSetRequestedSchema,
  ThumbnailSettingsSchema,
  figuresIn,
  headlineWords,
  packageInFlight,
  PACKAGE_STALE_MS,
  upcomingDefaultId,
  vetPlannedPackages,
  whatHasWon,
  type PlannedPackage,
} from './thumbnails'

describe('whatHasWon', () => {
  const results = [
    { idea: 'person' as const, tests: 4, wins: 3 },
    { idea: 'figure' as const, tests: 1, wins: 0 },
    { idea: 'object' as const, tests: 4, wins: 1 },
    { idea: 'moment' as const, tests: 0, wins: 0 },
    { idea: 'contrast' as const, tests: 6, wins: 2 },
  ]

  it('says nothing below five tests with a winner', () => {
    expect(whatHasWon(results, 4)).toBeNull()
    expect(whatHasWon(results, 0)).toBeNull()
  })

  it('lists ideas most tested first', () => {
    expect(whatHasWon(results, 5)).toBe(
      'Contrast: won 2 of 6 tests. Person: won 3 of 4 tests. Object: won 1 of 4 tests. ' +
        'Figure: won 0 of 1 test.',
    )
  })

  it('says nothing when five tests have winners but none carries an idea', () => {
    const unlabelled = results.map((row) => ({ ...row, tests: 0, wins: 0 }))
    expect(whatHasWon(unlabelled, 5)).toBeNull()
  })

  it('has a singular test and leaves out ideas never tested', () => {
    const text = whatHasWon([{ idea: 'person', tests: 1, wins: 1 }, ...results.slice(3, 4)], 9)
    expect(text).toBe('Person: won 1 of 1 test.')
  })
})

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

  it('drops a picture that names a cast member it does not list', () => {
    const out = vetPlannedPackages(
      input({
        packages: [
          pkg({
            idea: 'moment',
            picture: {
              subject: 'Adam Neumann at a podium',
              framing: '',
              textSide: 'left',
              stillSlotIds: [],
              depicts: [],
            },
          }),
        ],
      }),
    )
    expect(out.kept).toEqual([])
    expect(out.dropped[0]!.reason).toBe(
      'Adam Neumann is described in the picture but is not listed as shown.',
    )
    const viaFraming = vetPlannedPackages(
      input({
        packages: [
          pkg({
            idea: 'moment',
            picture: {
              subject: 'A podium',
              framing: 'close on adam neumann, low angle',
              textSide: 'left',
              stillSlotIds: [],
              depicts: [],
            },
          }),
        ],
      }),
    )
    expect(viaFraming.kept).toEqual([])
  })

  it('a title may name someone the picture does not show', () => {
    const out = vetPlannedPackages(
      input({
        packages: [
          pkg({
            idea: 'figure',
            title: 'Adam Neumann and the $47 Billion Lie',
            headline: 'The $47bn lie',
            picture: {
              subject: 'A huge number on a wall',
              framing: '',
              textSide: 'left',
              stillSlotIds: [],
              depicts: [],
            },
          }),
        ],
      }),
    )
    expect(out.kept).toHaveLength(1)
  })

  it('matches the name as whole words only', () => {
    const picture = (subject: string) => ({
      subject,
      framing: '',
      textSide: 'left' as const,
      stillSlotIds: [],
      depicts: [],
    })
    const run = (subject: string) =>
      vetPlannedPackages(input({ packages: [pkg({ idea: 'object', picture: picture(subject) })] }))
        .kept.length
    expect(run('Neumann alone at a podium')).toBe(1)
    expect(run('Adamson Neumannsburg at a podium')).toBe(1)
    expect(run('Adam Neumann at a podium')).toBe(0)
    expect(run('Adam Neumann, at a podium')).toBe(0)
  })

  it('a person package must show someone', () => {
    const out = vetPlannedPackages(
      input({
        packages: [
          pkg({
            idea: 'person',
            picture: {
              subject: 'A founder at a podium',
              framing: '',
              textSide: 'left',
              stillSlotIds: [],
              depicts: [],
            },
          }),
        ],
      }),
    )
    expect(out.kept).toEqual([])
    expect(out.dropped[0]!.reason).toBe('A person package must show someone from the cast.')
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

describe('upcomingDefaultId', () => {
  const row = (over: Partial<Parameters<typeof upcomingDefaultId>[0][number]> = {}) => ({
    id: 'a',
    position: 0,
    state: 'ready',
    approved: false,
    hasImage: true,
    ...over,
  })

  it('the upcoming default skips a failed package at the front', () => {
    expect(
      upcomingDefaultId([
        row({ id: 'a', position: 0, state: 'failed', hasImage: false }),
        row({ id: 'b', position: 1 }),
      ]),
    ).toBe('b')
  })

  it('an approved package ahead of a ready one is the default', () => {
    expect(
      upcomingDefaultId([
        row({ id: 'a', position: 0 }),
        row({ id: 'b', position: 1, approved: true }),
      ]),
    ).toBe('a')
    expect(
      upcomingDefaultId([
        row({ id: 'b', position: 2, approved: true }),
        row({ id: 'a', position: 1, state: 'ready', approved: false }),
      ]),
    ).toBe('a')
  })

  it('nothing is the default when nothing can go up', () => {
    expect(upcomingDefaultId([])).toBeNull()
    expect(
      upcomingDefaultId([
        row({ state: 'painting', hasImage: false }),
        row({ id: 'c', position: 1, state: 'ready', hasImage: false }),
      ]),
    ).toBeNull()
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
