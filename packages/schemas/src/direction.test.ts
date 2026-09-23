import { describe, expect, it } from 'vitest'
import {
  castWarnings,
  containsPhrase,
  craftFindings,
  DirectorsBookSchema,
  findingContext,
  motifPattern,
  planWarnings,
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

describe('planWarnings', () => {
  const banned = ['cinematic', 'stunning']

  it('flags three adjacent slots at one size', () => {
    const warnings = planWarnings(
      [still('wide', 'a'), still('wide', 'b'), still('wide', 'c')].map((brief) => ({ brief })),
      banned,
    )
    expect(warnings).toEqual([
      expect.stringContaining('three adjacent slots share the size "wide"'),
    ])
  })

  it('flags a banned word in a still prompt, once per word', () => {
    const warnings = planWarnings(
      [{ brief: still('close', 'A cinematic, stunning, cinematic corridor') }],
      banned,
    )
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('"cinematic"')
  })

  it('is silent on a varied, clean plan', () => {
    expect(
      planWarnings([{ brief: still('wide', 'a') }, { brief: still('close', 'b') }], banned),
    ).toEqual([])
  })
})

describe('planWarnings: motifs (decision 260)', () => {
  const motifs = ['reflections in dark glass', 'empty chairs', 'server racks']
  const stock = (description: string): ShotBrief => ({
    type: 'stock',
    coversText: 'x',
    description,
    motion: { kind: 'static' },
    transition: 'cut',
    query: 'q',
    rejectionCriteria: [],
  })
  const chart: ShotBrief = {
    type: 'chart',
    coversText: 'x',
    description: 'a server rack chart',
    motion: { kind: 'static' },
    transition: 'cut',
    chartKind: 'bar',
    series: [
      {
        label: 'a',
        unit: 'USD',
        points: [
          { x: '2019', y: 1 },
          { x: '2020', y: 2 },
        ],
      },
    ],
    dataRefs: ['01HQ00000000000000000000AA'],
    takeaway: 't',
    reveal: 'none',
  }

  it('counts a motif in more than one picture brief of a chapter, by its head noun, and flags neighbours', () => {
    const warnings = planWarnings(
      [
        { brief: still('wide', 'A server rack humming in the dark'), chapter: 'chapter 3' },
        { brief: stock('Rows of server racks'), chapter: 'chapter 3' },
        { brief: still('close', 'A ledger on a desk'), chapter: 'chapter 3' },
      ],
      [],
      motifs,
    )
    expect(warnings).toEqual([
      'motif "server racks" appears in 2 of 3 picture briefs in chapter 3',
      'motif "server racks" appears in two adjacent slots (from slot 0)',
    ])
  })

  it('is silent when each motif appears once per chapter, however many chapters', () => {
    expect(
      planWarnings(
        [
          { brief: still('wide', 'an empty chair'), chapter: 'chapter 1' },
          { brief: still('close', 'a ledger'), chapter: 'chapter 1' },
          { brief: still('wide', 'an empty chair at the head of the table'), chapter: 'chapter 2' },
        ],
        [],
        motifs,
      ),
    ).toEqual([])
  })

  it('matches the head noun and its plural, never the modifier, and skips data briefs', () => {
    expect(
      planWarnings(
        [
          { brief: stock('Deserted office, empty desks'), chapter: 'c' },
          { brief: stock('More empty desks'), chapter: 'c' },
          { brief: chart, chapter: 'c' },
          { brief: chart, chapter: 'c' },
        ],
        [],
        motifs,
      ),
    ).toEqual([])
    expect(motifPattern('reflections in dark glass')?.test('her glasses on the desk')).toBe(true)
    expect(motifPattern('server racks')?.test('a rack of servers')).toBe(true)
    expect(motifPattern('[mock] empty chairs')?.test('empty desks')).toBe(false)
    expect(motifPattern('')).toBeNull()
  })

  it('changes nothing for a caller that passes no motifs', () => {
    expect(
      planWarnings([{ brief: still('wide', 'a') }, { brief: still('close', 'b') }], []),
    ).toEqual([])
  })
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

describe('planWarnings counts sets', () => {
  const slot = (chapter: string, set?: string) => ({
    brief: {
      type: 'still' as const,
      coversText: 'x',
      description: 'x',
      motion: { kind: 'static' as const },
      transition: 'cut' as const,
      prompt: 'a room',
      ...(set ? { set } : {}),
    },
    chapter,
  })

  it('notes a set carrying more than half a chapter of picture briefs', () => {
    const slots = [
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1'),
    ]
    const warnings = planWarnings(slots, [], [], ['Venture Capital Boardroom'])
    expect(warnings.some((w) => w.includes('3 of 4 picture briefs in chapter 1'))).toBe(true)
  })

  it('notes a set in two adjacent slots', () => {
    const slots = [
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1', 'Venture Capital Boardroom'),
    ]
    const warnings = planWarnings(slots, [], [], ['Venture Capital Boardroom'])
    expect(warnings.some((w) => w.includes('two adjacent slots'))).toBe(true)
  })

  it('says nothing at exactly half a chapter, which is not a majority', () => {
    const slots = [
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1'),
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1'),
    ]
    const warnings = planWarnings(slots, [], [], ['Venture Capital Boardroom'])
    expect(warnings.some((w) => w.includes('picture briefs in chapter 1'))).toBe(false)
  })

  it('notes one run of a set once, not once per adjacent pair', () => {
    const slots = [
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1'),
    ]
    const warnings = planWarnings(slots, [], [], ['Venture Capital Boardroom'])
    expect(warnings.filter((w) => w.includes('two adjacent slots'))).toHaveLength(1)
  })

  it('notes a set the project does not hold, because it conditions nothing', () => {
    const warnings = planWarnings([slot('chapter 1', 'A car park')], [], [], ['The boardroom'])
    expect(warnings.some((w) => w.includes('no set named "A car park"'))).toBe(true)
  })

  it('notes an unknown set even when the project holds no sets at all', () => {
    // The loudest case of a brief conditioning nothing, and the one the plan
    // screen most needs to say out loud.
    const warnings = planWarnings([slot('chapter 1', 'A car park')], [], [], [])
    expect(warnings.some((w) => w.includes('no set named "A car park"'))).toBe(true)
  })

  it('says nothing when no slot names a set', () => {
    expect(planWarnings([slot('chapter 1')], [], [], ['The boardroom'])).toEqual([])
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

describe('planWarnings reads past the era lock, and lets a sentence justify its room (decision 271)', () => {
  const pasted = (shotSize: 'wide' | 'close'): ShotBrief => ({
    ...still(
      shotSize,
      'A desk at dusk. 2019 to 2024: flat-panel LCD monitors, rack-mounted blade servers',
    ),
  })
  const motifs = ['a glowing blue server blade in a darkened rack']
  const eraLocks = ['flat-panel LCD monitors, rack-mounted blade servers']

  // The Stability AI plan: every still pasted the era lock, and the era lock
  // says "rack-mounted", so the motif noun "rack" was found in all of them.
  it('does not count a motif noun that is only inside the pasted era lock', () => {
    const slots = [{ brief: pasted('wide') }, { brief: pasted('close') }]
    expect(planWarnings(slots, [], motifs, [], eraLocks)).toEqual([])
    expect(planWarnings(slots, [], motifs)).toEqual([
      expect.stringContaining(
        'motif "a glowing blue server blade in a darkened rack" appears in 2 of 2',
      ),
      expect.stringContaining('appears in two adjacent slots'),
    ])
  })

  const inRoom = (coversText: string, shotSize: 'wide' | 'close'): ShotBrief => ({
    type: 'still',
    coversText,
    description: 'x',
    motion: { kind: 'static' },
    transition: 'cut',
    prompt: 'x',
    shotSize,
    set: 'Venture Capital Boardroom',
  })

  it('does not call two adjacent shots in one room a run when the sentence is set there', () => {
    const justified = [
      { brief: inRoom('Inside the boardroom.', 'wide') },
      { brief: inRoom('Back in the boardroom, they argued.', 'close') },
    ]
    expect(planWarnings(justified, [], [], ['Venture Capital Boardroom'])).not.toContainEqual(
      expect.stringContaining('fills two adjacent slots'),
    )
    const unjustified = [
      { brief: inRoom('Inside the boardroom.', 'wide') },
      { brief: inRoom('The money was gone.', 'close') },
    ]
    expect(planWarnings(unjustified, [], [], ['Venture Capital Boardroom'])).toContainEqual(
      expect.stringContaining('fills two adjacent slots'),
    )
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
  ...over,
})

describe('craftFindings (decision 271)', () => {
  it('flags the third shot of one size in a row, then counts again from there', () => {
    const slots = Array.from({ length: 6 }, () => at({ type: 'still', shotSize: 'wide' }))
    expect(craftFindings(slots, ctx()).map((f) => [f.kind, f.slotIndex, f.repair])).toEqual([
      ['size-run', 2, 'auto'],
      ['size-run', 5, 'auto'],
    ])
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

  it('reads motifs and era-lock rules from the book', () => {
    expect(
      findingContext({
        direction: { motifs: ['m'], eraLocks: [{ span: 's', rules: 'r' }] },
        cast: [],
        sets: [{ name: 'Lobby' }],
      }),
    ).toEqual({ motifs: ['m'], eraLocks: ['r'], cast: [], sets: ['Lobby'] })
    expect(findingContext({ direction: null, cast: [], sets: [] })).toEqual({
      motifs: [],
      eraLocks: [],
      cast: [],
      sets: [],
    })
  })
})
