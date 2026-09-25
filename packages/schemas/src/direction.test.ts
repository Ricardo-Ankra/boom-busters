import { describe, expect, it } from 'vitest'
import {
  castWarnings,
  containsPhrase,
  craftFindings,
  DirectorsBookSchema,
  findingContext,
  mayBecomeStill,
  motifPattern,
  referenceWarnings,
  renderDirectorsBook,
  repairSummary,
  repairTargets,
  setKeyNoun,
} from './direction'
import type { FindingBrief, FindingContext, FindingSlot } from './direction'
import type { ShotBrief } from './visuals'

const book = {
  visualThesis: 'A company that looked solid from the street and hollow from inside.',
  eraLocks: [{ span: '2011 to 2020', rules: 'flat screens, glass offices, smartphones' }],
  palette: { accent: '#c9a227', temperature: 'cold', note: 'gold only on money and signatures' },
  motifs: ['reflections in dark glass', 'empty chairs', 'printed pages under lamplight'],
  anchorObject: 'a bound annual report',
  neverShow: ['cash in bags', 'handcuffs'],
  principals: [
    {
      name: 'Markus Braun',
      role: 'chief executive',
      depiction: 'likeness',
      identityString:
        'Markus Braun, man in his late forties, shaved head, rimless glasses, black turtleneck',
      guardrail: 'shown at podiums and in corridors; never at a desk with documents',
    },
  ],
  locations: [{ name: 'Aschheim headquarters', look: 'glass box on a business park, grey sky' }],
  chapters: [
    {
      chapter: 1,
      dominantShotFamily: 'environment',
      moodShift: 'confident to uneasy',
      keyImage: 'the empty stage after the results presentation',
    },
    {
      chapter: 2,
      dominantShotFamily: 'document',
      moodShift: 'uneasy to exposed',
      keyImage: 'a ledger page with a missing column',
    },
  ],
  finalImage: 'the headquarters at night, one floor lit',
}

describe('DirectorsBookSchema', () => {
  it('accepts a complete book', () => {
    expect(DirectorsBookSchema.safeParse(book).success).toBe(true)
  })

  it('requires exactly three motifs', () => {
    const result = DirectorsBookSchema.safeParse({ ...book, motifs: book.motifs.slice(0, 2) })
    expect(result.success).toBe(false)
  })

  it('requires a guardrail on every principal', () => {
    const principals = [{ ...book.principals[0], guardrail: '' }]
    expect(DirectorsBookSchema.safeParse({ ...book, principals }).success).toBe(false)
  })
})

describe('renderDirectorsBook', () => {
  it('writes the book as prose sections a prompt can carry', () => {
    const text = renderDirectorsBook(DirectorsBookSchema.parse(book))
    expect(text).toContain('Visual thesis:')
    expect(text).toContain(
      'Motifs: reflections in dark glass; empty chairs; printed pages under lamplight',
    )
    expect(text).toContain('Markus Braun (likeness)')
    expect(text).toContain('Chapter 1:')
  })

  it('reads a chapter family as a lean, not a rule (decision 260)', () => {
    expect(renderDirectorsBook(DirectorsBookSchema.parse(book))).toContain(
      'Chapter 1: leans towards environment shots;',
    )
  })
})

const still = (shotSize: 'wide' | 'close', prompt: string): ShotBrief => ({
  type: 'still',
  coversText: 'x',
  description: 'x',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt,
  shotSize,
})

describe('castWarnings', () => {
  it('names each cast member the book left out, case-insensitively, and nothing else', () => {
    expect(castWarnings(book, ['markus braun', 'Jan Marsalek'])).toEqual([
      'the book has no principal for Jan Marsalek; redraft the direction or add them by hand',
    ])
    expect(castWarnings(null, ['Jan Marsalek'])).toEqual([])
    expect(castWarnings(book, [])).toEqual([])
  })
})

describe('referenceWarnings: held references nothing names', () => {
  const depicting = (depicts: string[], set?: string): ShotBrief => ({
    type: 'still',
    coversText: 'x',
    description: 'x',
    motion: { kind: 'static' },
    transition: 'cut',
    prompt: 'x',
    shotSize: 'wide',
    depicts,
    ...(set ? { set } : {}),
  })

  it('says so once when no picture brief names any reference', () => {
    const warnings = referenceWarnings(
      [{ brief: still('wide', 'a') }, { brief: still('close', 'b') }],
      ['Markus Braun'],
      ['Aschheim headquarters'],
    )
    expect(warnings[0]).toBe(
      'none of the 2 picture briefs names a reference, so every one is generated without ' +
        'your 1 photographed cast member or 1 photographed set',
    )
    expect(warnings).toContain('no brief depicts Markus Braun, so their photographs are never sent')
    expect(warnings).toContain(
      'no brief names the set "Aschheim headquarters", so its plates are never sent',
    )
  })

  it('drops the headline once anything is used, and names only what is not', () => {
    const warnings = referenceWarnings(
      [{ brief: depicting(['Markus Braun']) }],
      ['Markus Braun', 'Jan Marsalek'],
      [],
    )
    expect(warnings).toEqual(['no brief depicts Jan Marsalek, so their photographs are never sent'])
  })

  // The join that decision 262 exists for: the planner writes the role after
  // the name, and an exact-string check would call a used reference unused.
  it('counts a role-suffixed depicts entry as naming the person', () => {
    expect(
      referenceWarnings(
        [{ brief: depicting(['Markus Braun, chief executive']) }],
        ['Markus Braun'],
        [],
      ),
    ).toEqual([])
  })

  it('counts a named set as used', () => {
    expect(
      referenceWarnings(
        [{ brief: depicting([], 'Aschheim headquarters') }],
        [],
        ['Aschheim headquarters'],
      ),
    ).toEqual([])
  })

  it('is silent when the producer holds no references at all', () => {
    expect(referenceWarnings([{ brief: still('wide', 'a') }], [], [])).toEqual([])
  })

  // A chapter of charts and maps names nobody and is not a miss.
  it('is silent when there are no picture briefs to name anything', () => {
    expect(referenceWarnings([], ['Markus Braun'], [])).toEqual([])
  })
})

describe('containsPhrase and setKeyNoun (decision 271)', () => {
  it('matches whole words, ignoring case and spacing', () => {
    expect(containsPhrase("Parker's money arrived.", 'Parker')).toBe(true)
    expect(containsPhrase('They met on Parkerton Road.', 'Parker')).toBe(false)
    expect(containsPhrase('The Data  Center ran hot.', 'data center')).toBe(true)
    expect(containsPhrase('anything', '   ')).toBe(false)
  })

  it('reads a set by its last word, or its last two when the last is generic', () => {
    expect(setKeyNoun('Venture Capital Boardroom')).toBe('boardroom')
    expect(setKeyNoun('Cloud Computing Data Center')).toBe('data center')
    expect(setKeyNoun('Lobby')).toBe('lobby')
    expect(setKeyNoun('Office')).toBe('office')
    expect(setKeyNoun('')).toBeNull()
  })
})

const at = (
  brief: Partial<FindingBrief> & { type: string },
  chapter = 'chapter 1',
): FindingSlot => ({ chapter, brief: { coversText: 'x', description: 'x', ...brief } })

const ctx = (over: Partial<FindingContext> = {}): FindingContext => ({
  motifs: [],
  eraLocks: [],
  cast: [],
  sets: [],
  bannedWords: [],
  ...over,
})

describe('motifPattern', () => {
  it('matches the head noun and its plural, never the modifier', () => {
    expect(motifPattern('reflections in dark glass')?.test('her glasses on the desk')).toBe(true)
    expect(motifPattern('server racks')?.test('a rack of servers')).toBe(true)
    expect(motifPattern('[mock] empty chairs')?.test('empty desks')).toBe(false)
    expect(motifPattern('')).toBeNull()
  })
})

// Decision 277: the notes the plan screen used to raise on its own are
// findings now, so the Fix button acts on every one of them.
describe('craftFindings: the notes Fix could not act on', () => {
  const room = (coversText: string, chapter = 'chapter 1', set = 'Venture Capital Boardroom') =>
    at({ type: 'still', coversText, prompt: 'a room', set }, chapter)
  const plain = (chapter = 'chapter 1') => at({ type: 'still', prompt: 'a street' }, chapter)
  const sets = ['Venture Capital Boardroom']

  it('flags the latest shots that keep a set above half a chapter, only as many as needed', () => {
    const slots = [
      room('The money moved.'),
      plain(),
      room('Nobody asked.'),
      plain(),
      room('It kept going.'),
    ]
    const found = craftFindings(slots, ctx({ sets })).filter((f) => f.kind === 'set-heavy')
    expect(found.map((f) => [f.slotIndex, f.repair])).toEqual([[4, 'auto']])
    expect(found[0]!.message).toContain('carries 3 of 5 picture briefs in chapter 1')
  })

  it('says nothing at exactly half a chapter, which is not a majority', () => {
    const slots = [room('a'), plain(), room('b'), plain()]
    expect(craftFindings(slots, ctx({ sets })).some((f) => f.kind === 'set-heavy')).toBe(false)
  })

  it('never flags a shot whose own sentence puts it in the room', () => {
    const slots = [
      room('Inside the boardroom.'),
      room('The boardroom went quiet.'),
      room('Back in the boardroom, they voted.'),
      plain(),
    ]
    expect(craftFindings(slots, ctx({ sets })).some((f) => f.kind === 'set-heavy')).toBe(false)
  })

  it('flags a set the film does not hold, naming the ones it does', () => {
    const found = craftFindings([room('x', 'chapter 1', 'A car park')], ctx({ sets }))
    expect(found.map((f) => [f.kind, f.repair])).toEqual([['unknown-set', 'auto']])
    expect(found[0]!.message).toContain('"Venture Capital Boardroom"')
  })

  it('flags a set even when the film holds no sets at all', () => {
    const found = craftFindings([room('x', 'chapter 1', 'A car park')], ctx())
    expect(found[0]).toMatchObject({ kind: 'unknown-set' })
    expect(found[0]!.message).toContain('the film has no sets')
  })

  it('flags each still whose prompt carries a banned word, naming every word once', () => {
    const slots = [
      at({ type: 'still', prompt: 'A cinematic, stunning, cinematic corridor' }),
      at({ type: 'still', prompt: 'A plain corridor' }),
    ]
    const found = craftFindings(slots, ctx({ bannedWords: ['cinematic', 'stunning'] }))
    expect(found.map((f) => [f.kind, f.slotIndex])).toEqual([['banned-word', 0]])
    expect(found[0]!.message).toContain('"cinematic" or "stunning"')
  })
})

describe('craftFindings (decision 271)', () => {
  it('flags the third shot of one size in a row, then counts again from there', () => {
    const slots = Array.from({ length: 6 }, () => at({ type: 'still', shotSize: 'wide' }))
    expect(craftFindings(slots, ctx()).map((f) => [f.kind, f.slotIndex, f.repair])).toEqual([
      ['size-run', 2, 'auto'],
      ['size-run', 5, 'auto'],
    ])
  })

  it('lets a chart break a run of photographs, whatever size it is tagged', () => {
    const slots = [
      at({ type: 'still', shotSize: 'wide' }),
      at({ type: 'chart', shotSize: 'wide' }),
      at({ type: 'still', shotSize: 'wide' }),
      at({ type: 'still', shotSize: 'wide' }),
    ]
    expect(craftFindings(slots, ctx())).toEqual([])
  })

  it('flags the third photograph of a run that starts after a chart', () => {
    const wide = (type: string) => at({ type, shotSize: 'wide' })
    const slots = ['still', 'still', 'chart', 'still', 'still', 'still'].map(wide)
    expect(craftFindings(slots, ctx()).map((f) => f.slotIndex)).toEqual([5])
  })

  it('never flags a chart, whose brief carries claim references', () => {
    const charts = Array.from({ length: 3 }, () =>
      at({ type: 'chart', shotSize: 'graphic', coversText: 'Mostaque inside the boardroom.' }),
    )
    expect(
      craftFindings(
        charts,
        ctx({
          cast: [{ name: 'Emad Mostaque', photographed: true }],
          sets: ['Venture Capital Boardroom'],
        }),
      ),
    ).toEqual([])
  })

  it('flags a motif after its first use in a chapter, and an adjacent repeat across chapters', () => {
    const motifs = ['server racks']
    const hit = (chapter: string) =>
      at({ type: 'still', shotSize: 'wide', prompt: 'rows of racks' }, chapter)
    const miss = (chapter: string) =>
      at({ type: 'still', shotSize: 'close', prompt: 'a desk' }, chapter)
    const indexes = (slots: FindingSlot[]) =>
      craftFindings(slots, ctx({ motifs })).map((f) => f.slotIndex)
    expect(indexes([hit('chapter 1'), miss('chapter 1'), hit('chapter 1')])).toEqual([2])
    expect(indexes([hit('chapter 1'), hit('chapter 2')])).toEqual([1])
    expect(indexes([hit('chapter 1'), miss('chapter 2'), hit('chapter 2')])).toEqual([])
  })

  it('does not count a motif noun that is only inside the pasted era lock', () => {
    const eraLocks = ['flat-panel LCD monitors, rack-mounted blade servers']
    const motifs = ['a glowing blue server blade in a darkened rack']
    const pasted = (shotSize: string) =>
      at({
        type: 'still',
        shotSize,
        prompt: 'A desk at dusk. 2019 to 2024: flat-panel LCD monitors, rack-mounted blade servers',
      })
    const slots = [pasted('wide'), pasted('close')]
    expect(craftFindings(slots, ctx({ motifs, eraLocks }))).toEqual([])
    // Without the era lock to take out, the old overcount comes back.
    expect(craftFindings(slots, ctx({ motifs })).map((f) => f.kind)).toEqual(['motif-repeat'])
  })

  it('flags a set run only when the sentence does not put the shot there', () => {
    const sets = ['Venture Capital Boardroom']
    const inRoom = (coversText: string, shotSize: string) =>
      at({ type: 'still', shotSize, coversText, set: 'Venture Capital Boardroom' })
    expect(
      craftFindings(
        [inRoom('Inside the boardroom.', 'wide'), inRoom('The money was gone.', 'close')],
        ctx({ sets }),
      ).map((f) => [f.kind, f.slotIndex]),
    ).toEqual([['set-run', 1]])
    expect(
      craftFindings(
        [
          inRoom('Inside the boardroom.', 'wide'),
          inRoom('Back in the boardroom, they argued.', 'close'),
        ],
        ctx({ sets }),
      ),
    ).toEqual([])
  })

  describe('ignored-person, graded by what the fix would cost', () => {
    const cast = [
      { name: 'Emad Mostaque', photographed: true },
      { name: 'Sean Parker', photographed: false },
    ]
    const one = (brief: Partial<FindingBrief> & { type: string }) =>
      craftFindings([at({ shotSize: 'wide', ...brief })], ctx({ cast }))

    it('is auto for a photographed member left off a still', () => {
      expect(one({ type: 'still', coversText: 'Mostaque told the investors.' })).toEqual([
        {
          kind: 'ignored-person',
          slotIndex: 0,
          repair: 'auto',
          message:
            'Emad Mostaque is named here and photographed, but the shot does not show ' +
            'Emad Mostaque; show Emad Mostaque and list the name in "depicts"',
        },
      ])
    })

    it('is manual for an unphotographed member, saying the likeness would come from a description', () => {
      const [finding] = one({ type: 'still', coversText: "Parker's money arrived." })
      expect(finding).toMatchObject({ repair: 'manual' })
      expect(finding?.message).toContain('from a description, with no photograph')
    })

    it('is manual for anyone on a stock slot, saying it would become a generated still', () => {
      expect(one({ type: 'stock', coversText: 'Mostaque told the investors.' })).toEqual([
        {
          kind: 'ignored-person',
          slotIndex: 0,
          repair: 'manual',
          message:
            'Emad Mostaque is named here but the shot is stock; fixing makes it a ' +
            'generated still of Emad Mostaque',
        },
      ])
    })

    it('never flags archival, which the producer sources by hand', () => {
      expect(one({ type: 'archival', coversText: 'Mostaque told the investors.' })).toEqual([])
    })

    it('is silent when depicts names the member, role suffix and all', () => {
      expect(
        one({
          type: 'still',
          coversText: 'Mostaque told the investors.',
          depicts: ['Emad Mostaque, founder'],
        }),
      ).toEqual([])
    })

    it('matches the surname as a whole word only', () => {
      expect(one({ type: 'still', coversText: 'They met on Parkerton Road.' })).toEqual([])
    })

    it('matches a surname only as the cast spells it, so a common word is not a person', () => {
      const cast = [{ name: 'Kenneth Lay', photographed: true }]
      const still = (coversText: string) =>
        craftFindings([at({ type: 'still', shotSize: 'wide', coversText })], ctx({ cast }))
      expect(still('The problem lay in the accounts.')).toEqual([])
      expect(still('Lay told the board nothing.')).toHaveLength(1)
    })

    it('reads the surname before a suffix', () => {
      const cast = [{ name: 'Martin Luther King Jr.', photographed: true }]
      expect(
        craftFindings(
          [at({ type: 'still', shotSize: 'wide', coversText: 'King spoke first.' })],
          ctx({ cast }),
        ),
      ).toHaveLength(1)
    })

    it('names people and never refers back with a pronoun', () => {
      const messages = [
        ...one({ type: 'still', coversText: 'Mostaque and Parker met.' }),
        ...one({ type: 'stock', coversText: 'Mostaque and Parker met.' }),
      ].map((f) => f.message)
      expect(messages).toHaveLength(4)
      for (const message of messages) expect(message).not.toMatch(/\b(he|him|his|she|her|hers)\b/i)
    })
  })

  describe('ignored-set', () => {
    const sets = ['Venture Capital Boardroom', 'Cloud Computing Data Center']
    const one = (brief: Partial<FindingBrief> & { type: string }) =>
      craftFindings([at({ shotSize: 'wide', ...brief })], ctx({ sets }))

    // The owner's own example (decision 271).
    it('is auto for a still set in the wrong room', () => {
      expect(
        one({
          type: 'still',
          coversText:
            'Reporting at the time pointed to financial pressure on the business and ' +
            'disagreements inside the boardroom over where it was headed.',
          prompt: 'A high-end, aluminum-chassis rack-mounted AI server unit',
          set: 'Cloud Computing Data Center',
        }),
      ).toEqual([
        {
          kind: 'ignored-set',
          slotIndex: 0,
          repair: 'auto',
          message:
            'the sentence is in Venture Capital Boardroom, but the shot is set in ' +
            '"Cloud Computing Data Center"; set it in "Venture Capital Boardroom"',
        },
      ])
    })

    it('is silent for a still already in that room', () => {
      expect(
        one({
          type: 'still',
          coversText: 'Inside the boardroom.',
          set: 'Venture Capital Boardroom',
        }),
      ).toEqual([])
    })

    it('is manual on stock', () => {
      expect(one({ type: 'stock', coversText: 'Inside the boardroom.' })).toMatchObject([
        { kind: 'ignored-set', repair: 'manual' },
      ])
    })

    it('reads a generic last word together with the word before it', () => {
      expect(one({ type: 'still', coversText: 'The data center ran hot.' })).toMatchObject([
        { kind: 'ignored-set', message: expect.stringContaining('names no set') },
      ])
      expect(one({ type: 'still', coversText: 'At the center of it all was one man.' })).toEqual([])
    })

    it('passes a still already in one of two rooms that share a word', () => {
      const shared = ['Stability AI Boardroom', 'Coatue Boardroom']
      expect(
        craftFindings(
          [
            at({
              type: 'still',
              shotSize: 'wide',
              coversText: 'Inside the boardroom.',
              set: 'Coatue Boardroom',
            }),
          ],
          ctx({ sets: shared }),
        ),
      ).toEqual([])
      expect(
        craftFindings(
          [at({ type: 'still', shotSize: 'wide', coversText: 'Inside the boardroom.' })],
          ctx({ sets: shared }),
        ),
      ).toMatchObject([
        { kind: 'ignored-set', message: expect.stringContaining('or Coatue Boardroom') },
      ])
    })

    it('raises one finding naming every room the sentence could mean', () => {
      const shared = ['Stability AI Boardroom', 'Coatue Boardroom']
      expect(
        craftFindings(
          [at({ type: 'still', shotSize: 'wide', coversText: 'Inside the boardroom.' })],
          ctx({ sets: shared }),
        ).map((f) => [f.repair, f.message]),
      ).toEqual([
        [
          'auto',
          'the sentence is in Stability AI Boardroom or Coatue Boardroom, but the shot names no set; set it in one of them',
        ],
      ])
      expect(
        craftFindings(
          [at({ type: 'stock', shotSize: 'wide', coversText: 'Inside the boardroom.' })],
          ctx({ sets: shared }),
        ).map((f) => [f.repair, f.message]),
      ).toEqual([
        [
          'manual',
          'the sentence is in Stability AI Boardroom or Coatue Boardroom but the shot is stock; fixing makes it a generated still set in one of them',
        ],
      ])
    })
  })

  describe('reuse-linked slots', () => {
    it('raises nothing on a slot that reuses another shot', () => {
      const cast = [{ name: 'Emad Mostaque', photographed: true }]
      const slots: FindingSlot[] = [
        {
          chapter: 'chapter 1',
          linked: true,
          brief: { type: 'still', shotSize: 'wide', coversText: 'Mostaque spoke.' },
        },
      ]
      expect(craftFindings(slots, ctx({ cast }))).toEqual([])
    })

    it('still counts a linked slot in a size run, and flags the next slot it can repair', () => {
      const wide = (linked: boolean): FindingSlot => ({
        ...at({ type: 'still', shotSize: 'wide' }),
        linked,
      })
      expect(
        craftFindings([wide(false), wide(false), wide(true), wide(false)], ctx()).map(
          (f) => f.slotIndex,
        ),
      ).toEqual([3])
    })
  })

  describe('shared camera (decision 275)', () => {
    const brief = (position: string, facing = 'north', set = 'The boardroom') => ({
      type: 'still',
      coversText: `They met at ${position.trim()}.`,
      set,
      camera: { facing, position },
    })
    const context = { motifs: [], eraLocks: [], cast: [], sets: ['The boardroom'] }

    it('flags the second still in a set with the same facing and position', () => {
      const findings = craftFindings(
        [
          { brief: brief('The South doorway ') },
          // The set's name in another case is the same room.
          { brief: brief('the south doorway', 'north', 'the Boardroom') },
          { brief: brief('the window') },
        ],
        context,
      ).filter((finding) => finding.kind === 'shared-camera')
      expect(findings).toEqual([
        {
          kind: 'shared-camera',
          slotIndex: 1,
          repair: 'auto',
          message:
            'the still covering "They met at The South doorway." in "the Boardroom" already stands at "the south doorway" facing north; move the camera',
        },
      ])
    })

    it('does not flag a different facing from the same place, or a linked slot', () => {
      const findings = craftFindings(
        [
          { brief: brief('the doorway') },
          { brief: brief('the doorway', 'east') },
          { brief: brief('the doorway'), linked: true },
        ],
        context,
      ).filter((finding) => finding.kind === 'shared-camera')
      expect(findings).toEqual([])
    })
  })
})

describe('repairTargets, repairSummary and findingContext', () => {
  const cast = [{ name: 'Emad Mostaque', photographed: true }]
  const slots = [
    at({ type: 'still', shotSize: 'wide' }),
    at({ type: 'still', shotSize: 'wide' }),
    // A third wide still AND a photographed name left out: two auto findings on one slot.
    at({ type: 'still', shotSize: 'wide', coversText: 'Mostaque spoke.' }),
    at({ type: 'stock', shotSize: 'close', coversText: 'Mostaque spoke.' }, 'chapter 2'),
  ]
  const findings = craftFindings(slots, ctx({ cast }))

  it('sends a slot once, carrying every finding it has', () => {
    const targets = repairTargets(findings, ['auto'])
    expect(targets.map((t) => t.slotIndex)).toEqual([2])
    expect(targets[0]?.findings.map((f) => f.kind).sort()).toEqual(['ignored-person', 'size-run'])
  })

  it('includes manual findings only when asked', () => {
    expect(repairTargets(findings, ['auto', 'manual']).map((t) => t.slotIndex)).toEqual([2, 3])
  })

  it('counts slots, stills-to-be and chapters for the button', () => {
    expect(repairSummary(slots, findings)).toEqual({ slots: 2, becomeStills: 1, chapters: 2 })
  })

  it('clears only a stock slot with a person or set finding to become a still', () => {
    const person = [{ kind: 'ignored-person' as const }]
    const set = [{ kind: 'ignored-set' as const }]
    const size = [{ kind: 'size-run' as const }]
    expect(mayBecomeStill({ type: 'stock' }, person)).toBe(true)
    expect(mayBecomeStill({ type: 'stock' }, set)).toBe(true)
    expect(mayBecomeStill({ type: 'stock' }, size)).toBe(false)
    expect(mayBecomeStill({ type: 'still' }, person)).toBe(false)
  })

  it('leaves out a cast member the book shows only by archival footage', () => {
    expect(
      findingContext({
        direction: {
          motifs: [],
          eraLocks: [],
          principals: [
            { name: 'Emad Mostaque', depiction: 'archival-only' },
            { name: 'Sean Parker', depiction: 'likeness' },
          ],
        },
        cast: [
          { name: 'Emad Mostaque', photographed: true },
          { name: 'Sean Parker', photographed: true },
          { name: 'Prem Akkaraju', photographed: false },
        ],
        sets: [],
      }).cast.map((member) => member.name),
    ).toEqual(['Sean Parker', 'Prem Akkaraju'])
  })

  it('reads motifs and era-lock rules from the book', () => {
    expect(
      findingContext({
        direction: { motifs: ['m'], eraLocks: [{ span: 's', rules: 'r' }] },
        cast: [],
        sets: [{ name: 'Lobby' }],
      }),
    ).toEqual({ motifs: ['m'], eraLocks: ['r'], cast: [], sets: ['Lobby'], bannedWords: [] })
    expect(findingContext({ direction: null, cast: [], sets: [] })).toEqual({
      motifs: [],
      eraLocks: [],
      cast: [],
      sets: [],
      bannedWords: [],
    })
  })
})
