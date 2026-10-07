import { describe, expect, it } from 'vitest'
import { newId } from './ids'
import {
  ChartBriefSchema,
  GraphicBriefSchema,
  HeadlineBriefSchema,
  HERO_SLOTS_ENABLED,
  PlannedBriefSchema,
  REUSABLE_SLOT_TYPES,
  SHOT_SLOT_TYPES,
  ShotBriefSchema,
  SlotCandidateSchema,
  SlotDraftStateSchema,
  SlotJobSchema,
  SocialBriefSchema,
  StillBriefSchema,
  VisualsJobSchema,
  claimCarriesArticle,
  convertBrief,
  mapClaimRefs,
  graphicIntentOf,
  graphicSceneClaimIds,
  keepGraphicDesign,
  plannedBriefRejection,
  resolvePlannedScene,
  toPlannedScene,
  resolvePlannedBrief,
  visualsApprovalBlockedReason,
  visualsCoverage,
} from './visuals'
import type { SlotRef } from './visuals'

const CLAIM_A = '01HQ00000000000000000000AA'
const CLAIM_B = '01HQ00000000000000000000AB'
const CLAIM_C = '01HQ00000000000000000000AC'

const common = {
  coversText: 'By June, the auditors could not find the money.',
  description: 'Deserted open-plan office at dusk, cool blue grade, no faces.',
  motion: { kind: 'kenburns', direction: 'in', speed: 'slow' } as const,
  transition: 'cut' as const,
}

describe('ShotBriefSchema', () => {
  it('accepts a full stock brief', () => {
    const brief = ShotBriefSchema.parse({
      type: 'stock',
      ...common,
      query: 'empty office dusk',
      rejectionCriteria: ['no watermarks', 'no modern laptops'],
    })
    expect(brief.type).toBe('stock')
  })

  it('accepts an archival brief with an era range', () => {
    const brief = ShotBriefSchema.parse({
      type: 'archival',
      ...common,
      query: 'Wirecard headquarters',
      mustShow: 'the Aschheim headquarters building',
      eraRange: '2015-2020',
    })
    expect(brief.type).toBe('archival')
  })

  it('accepts a still brief with a negative prompt', () => {
    const brief = ShotBriefSchema.parse({
      type: 'still',
      ...common,
      prompt: '1995 trading floor, CRT monitors, film grain, muted teal-and-amber grade',
      negativePrompt: 'modern flat screens, smartphones',
    })
    expect(brief.type).toBe('still')
  })

  it('accepts a map brief and bounds its coordinates', () => {
    const brief = ShotBriefSchema.parse({
      type: 'map',
      ...common,
      locations: [
        { label: 'Munich', lat: 48.1, lon: 11.6 },
        { label: 'Manila', lat: 14.6, lon: 121.0 },
      ],
      route: true,
    })
    expect(brief.type).toBe('map')

    expect(() =>
      ShotBriefSchema.parse({
        type: 'map',
        ...common,
        locations: [{ label: 'Nowhere', lat: 91, lon: 0 }],
        route: false,
      }),
    ).toThrow()
  })

  it('types hero briefs even while the feature flag is off', () => {
    // The flag gates the ADAPTER and the prompt, not the schema: a hero slot
    // in the database must still parse, or flipping the flag on would strand
    // every row written while testing it.
    expect(HERO_SLOTS_ENABLED).toBe(false)
    const brief = ShotBriefSchema.parse({
      type: 'hero',
      ...common,
      prompt: 'slow aerial push over a rain-soaked financial district at night',
      cameraMovement: 'slow push-in',
      loop: true,
    })
    expect(brief.type).toBe('hero')
  })
})

describe('ChartBriefSchema — charts are sourced, never invented', () => {
  const chart = {
    type: 'chart',
    ...common,
    chartKind: 'line',
    series: [
      {
        label: 'Share price',
        unit: 'EUR',
        points: [
          { x: '2020-06-17', y: 104.5 },
          { x: '2020-06-26', y: 1.28 },
        ],
      },
    ],
    takeaway: 'Highlight the collapse from €104 to €1.28 in nine days.',
    reveal: 'draw-on',
  }

  it('accepts a chart that cites its claims', () => {
    const brief = ChartBriefSchema.parse({ ...chart, dataRefs: [CLAIM_A, CLAIM_B] })
    expect(brief.dataRefs).toHaveLength(2)
  })

  it('refuses a chart with no claim refs — by schema, not etiquette', () => {
    expect(() => ChartBriefSchema.parse({ ...chart, dataRefs: [] })).toThrow(/cite the claims/)
    expect(() => ChartBriefSchema.parse(chart)).toThrow()
  })

  it('refuses a single-point series', () => {
    expect(() =>
      ChartBriefSchema.parse({
        ...chart,
        dataRefs: [CLAIM_A],
        series: [{ label: 'Price', unit: 'EUR', points: [{ x: '2020', y: 1 }] }],
      }),
    ).toThrow(/two points/)
  })
})

describe('SlotCandidateSchema', () => {
  it('requires a licence on every candidate', () => {
    const candidate = {
      id: '123456',
      provider: 'pexels',
      kind: 'image',
      sourceUrl: 'https://images.pexels.com/photos/123456/office.jpeg',
      licence: 'Pexels License',
    }
    expect(SlotCandidateSchema.parse(candidate).licence).toBe('Pexels License')
    expect(() => SlotCandidateSchema.parse({ ...candidate, licence: '' })).toThrow()
  })

  it('carries where a copy came from, and is fine without it (decision 261)', () => {
    const candidate = {
      id: '123456',
      provider: 'pexels',
      kind: 'image',
      sourceUrl: 'https://images.pexels.com/photos/123456/office.jpeg',
      licence: 'Pexels License',
    }
    expect(SlotCandidateSchema.parse(candidate).reusedFrom).toBeUndefined()
    expect(
      SlotCandidateSchema.parse({
        ...candidate,
        reusedFrom: { slotId: '01J000000000000000000000AA', depicts: ['Markus Braun'] },
      }).reusedFrom,
    ).toEqual({ slotId: '01J000000000000000000000AA', depicts: ['Markus Braun'] })
    expect(() =>
      SlotCandidateSchema.parse({ ...candidate, reusedFrom: { slotId: 'nope' } }),
    ).toThrow()
  })
})

describe('mapClaimRefs', () => {
  const ids = [CLAIM_A, CLAIM_B]

  it('maps 1-based claim numbers to ids and dedupes', () => {
    expect(mapClaimRefs([1, 2, 1], ids)).toEqual([CLAIM_A, CLAIM_B])
  })

  it('returns null when a number points outside the claim list', () => {
    expect(mapClaimRefs([3], ids)).toBeNull()
    expect(mapClaimRefs([0], ids)).toBeNull()
    expect(mapClaimRefs([1, 99], ids)).toBeNull()
  })
})

describe('PlannedBriefSchema', () => {
  const archival = {
    type: 'archival' as const,
    ...common,
    query: 'Carillion headquarters',
    mustShow: 'the Wolverhampton headquarters building',
  }

  it('joins an era range the model wrote as an array', () => {
    // Live Haiku writes ["1919", "2008"] about as often as "1919–2008"
    // whatever the prompt says; the first real board burned five paid retries
    // on exactly this. The wire accepts the array, the stored shape stays one
    // string.
    const brief = PlannedBriefSchema.parse({ ...archival, eraRange: ['1919', '2008'] })
    if (brief.type === 'archival') expect(brief.eraRange).toBe('1919–2008')
    expect(ShotBriefSchema.parse(brief)).toBeTruthy()
  })

  it('keeps a plain-string era range as written, and stays optional', () => {
    const brief = PlannedBriefSchema.parse({ ...archival, eraRange: 'pre-war' })
    if (brief.type === 'archival') expect(brief.eraRange).toBe('pre-war')

    const bare = PlannedBriefSchema.parse(archival)
    if (bare.type === 'archival') expect(bare.eraRange).toBeUndefined()
  })
})

describe('resolvePlannedBrief', () => {
  const ids = [{ id: CLAIM_A }, { id: CLAIM_B }]

  it('passes briefs that cite nothing through untouched', () => {
    const stock = {
      type: 'stock' as const,
      ...common,
      query: 'empty office dusk',
      rejectionCriteria: [],
    }
    expect(resolvePlannedBrief(stock, ids)).toEqual(stock)
  })

  it('swaps chart claim numbers for ids, or refuses', () => {
    const chart = {
      type: 'chart' as const,
      ...common,
      chartKind: 'line' as const,
      series: [
        {
          label: 'Share price',
          unit: 'EUR',
          points: [
            { x: '2020-06-17', y: 104.5 },
            { x: '2020-06-26', y: 1.28 },
          ],
        },
      ],
      dataRefs: [2, 1],
      takeaway: 'The nine-day collapse.',
      reveal: 'draw-on' as const,
    }

    const resolved = resolvePlannedBrief(chart, ids)
    expect(resolved).not.toBeNull()
    if (resolved?.type === 'chart') expect(resolved.dataRefs).toEqual([CLAIM_B, CLAIM_A])

    expect(resolvePlannedBrief({ ...chart, dataRefs: [7] }, ids)).toBeNull()
  })

  describe('headline briefs (decision 257)', () => {
    const news = [
      { id: CLAIM_A, sourceType: 'court', sourceUrl: 'https://courts.example/judgment' },
      { id: CLAIM_B, sourceType: 'major_outlet', sourceUrl: 'https://news.example/story' },
      { id: CLAIM_C, sourceType: 'major_outlet', sourceUrl: null },
    ]
    const headline = { type: 'headline' as const, ...common, sourceRef: 2 }

    it('swaps the claim number for the id of the claim it cites', () => {
      const resolved = resolvePlannedBrief(headline, news)
      expect(resolved).not.toBeNull()
      if (resolved?.type === 'headline') expect(resolved.sourceClaimId).toBe(CLAIM_B)
      // Nothing the model could have written about the article survives: the
      // brief names a claim, and the app reads the article itself.
      expect(resolved && 'sourceRef' in resolved).toBe(false)
    })

    it('refuses a claim number outside the list', () => {
      expect(resolvePlannedBrief({ ...headline, sourceRef: 9 }, news)).toBeNull()
      expect(plannedBriefRejection({ ...headline, sourceRef: 9 }, news)).toBe(
        'headline cited a claim number outside the claim list',
      )
    })

    it('refuses a claim no news outlet published', () => {
      expect(resolvePlannedBrief({ ...headline, sourceRef: 1 }, news)).toBeNull()
      expect(plannedBriefRejection({ ...headline, sourceRef: 1 }, news)).toBe(
        'headline cited a claim that is not a news report',
      )
    })

    it('refuses a news claim whose source URL did not survive research', () => {
      expect(resolvePlannedBrief({ ...headline, sourceRef: 3 }, news)).toBeNull()
      expect(plannedBriefRejection({ ...headline, sourceRef: 3 }, news)).toBe(
        'headline cited a news claim with no source URL to read',
      )
    })

    it('says nothing about a brief it accepts', () => {
      expect(plannedBriefRejection(headline, news)).toBeNull()
    })
  })

  describe('social briefs (decision 284)', () => {
    const posts = [
      { id: CLAIM_A, sourceType: 'major_outlet', sourceUrl: 'https://news.example/story' },
      {
        id: CLAIM_B,
        sourceType: 'major_outlet',
        sourceUrl: 'https://x.com/nytimes/status/1234567890123456789',
      },
      { id: CLAIM_C, sourceType: 'major_outlet', sourceUrl: null },
    ]
    const social = { type: 'social' as const, ...common, sourceRef: 2 }

    it('is a slot type before hero', () => {
      expect(SHOT_SLOT_TYPES.indexOf('social')).toBe(SHOT_SLOT_TYPES.indexOf('hero') - 1)
    })

    it('swaps the claim number for the id it cites and normalises the post address', () => {
      const resolved = resolvePlannedBrief(social, posts)
      expect(resolved).not.toBeNull()
      if (resolved?.type === 'social') {
        expect(resolved.sourceClaimId).toBe(CLAIM_B)
        expect(resolved.postUrl).toBe('https://x.com/i/status/1234567890123456789')
      }
      // Nothing the model wrote about the claim number survives.
      expect(resolved && 'sourceRef' in resolved).toBe(false)
    })

    it('refuses a claim number outside the list', () => {
      expect(resolvePlannedBrief({ ...social, sourceRef: 9 }, posts)).toBeNull()
      expect(plannedBriefRejection({ ...social, sourceRef: 9 }, posts)).toBe(
        'social cited a claim number outside the claim list',
      )
    })

    it('refuses an article claim with no post behind it', () => {
      expect(resolvePlannedBrief({ ...social, sourceRef: 1 }, posts)).toBeNull()
      expect(plannedBriefRejection({ ...social, sourceRef: 1 }, posts)).toBe(
        'claim 1 has no X post behind it',
      )
    })

    it('refuses a claim with no source URL at all', () => {
      expect(resolvePlannedBrief({ ...social, sourceRef: 3 }, posts)).toBeNull()
      expect(plannedBriefRejection({ ...social, sourceRef: 3 }, posts)).toBe(
        'claim 3 has no X post behind it',
      )
    })

    it('says nothing about a brief it accepts', () => {
      expect(plannedBriefRejection(social, posts)).toBeNull()
    })
  })
})

const CLAIMS = [
  { id: '01HQ00000000000000000000A1', text: 'The company raised $4 billion in 2022.' },
  { id: '01HQ00000000000000000000A2', text: 'Some 94 percent of deposits left.' },
]
// The brief's fixture id ended "...L1"; Crockford base32 (UlidSchema) excludes
// the letter L, so that string cannot validate as an assetId. Corrected here.
const LOGOS = [{ id: '01HQ00000000000000000000M1', title: 'Stability AI' }]

const plannedScene = (elements: unknown[]) => ({ elements }) as never
const cell = { col: 0, row: 0, colSpan: 6, rowSpan: 3 }

describe('graphic scenes (decision 268, Plan B)', () => {
  it('is a slot type before social and hero', () => {
    expect(SHOT_SLOT_TYPES.indexOf('graphic')).toBeLessThan(SHOT_SLOT_TYPES.indexOf('social'))
    expect(SHOT_SLOT_TYPES.indexOf('social')).toBeLessThan(SHOT_SLOT_TYPES.indexOf('hero'))
  })

  it('resolves claim numbers to ids and entities to library assets', () => {
    const resolved = resolvePlannedScene(
      plannedScene([
        { kind: 'figure', id: 'f1', cell, value: '$4bn', claimRef: 1, color: 'accent' },
        {
          kind: 'logo',
          id: 'l1',
          cell: { ...cell, col: 6 },
          entity: 'Stability AI, the image company',
        },
      ]),
      CLAIMS,
      LOGOS,
    )
    expect('scene' in resolved).toBe(true)
    if (!('scene' in resolved)) return
    expect(resolved.scene.elements[0]).toMatchObject({ claimRef: CLAIMS[0]!.id })
    expect(resolved.scene.elements[1]).toMatchObject({
      entity: 'Stability AI, the image company',
      assetId: LOGOS[0]!.id,
    })
  })

  it('leaves a logo without a mark unresolved rather than refusing the scene', () => {
    const resolved = resolvePlannedScene(
      plannedScene([{ kind: 'logo', id: 'l1', cell, entity: 'Acme Capital' }]),
      CLAIMS,
      LOGOS,
    )
    expect('scene' in resolved).toBe(true)
    if (!('scene' in resolved)) return
    expect(resolved.scene.elements[0]).toEqual(
      expect.not.objectContaining({ assetId: expect.anything() }),
    )
  })

  it('refuses a claim number outside the list, and a figure the claim does not carry, in words', () => {
    const outside = plannedScene([
      { kind: 'figure', id: 'f1', cell, value: '$4bn', claimRef: 9, color: 'accent' },
    ])
    expect(resolvePlannedScene(outside, CLAIMS, LOGOS)).toEqual({
      issue: expect.stringMatching(/outside the claim list/),
    })

    const wrong = plannedScene([
      { kind: 'figure', id: 'f1', cell, value: '$4.5bn', claimRef: 1, color: 'accent' },
    ])
    expect(resolvePlannedScene(wrong, CLAIMS, LOGOS)).toEqual({
      issue: expect.stringMatching(/\$4\.5bn.*claim 1/),
    })
  })

  it('checks every bar the same way', () => {
    const bars = (secondDisplay: string, secondValue: number) =>
      plannedScene([
        {
          kind: 'bars',
          id: 'b1',
          cell: { col: 0, row: 0, colSpan: 12, rowSpan: 4 },
          color: 'accent',
          items: [
            { label: 'raised', value: 4, display: '$4bn', claimRef: 1 },
            { label: 'left', value: secondValue, display: secondDisplay, claimRef: 2 },
          ],
        },
      ])
    expect('scene' in resolvePlannedScene(bars('94%', 94), CLAIMS, LOGOS)).toBe(true)
    expect('issue' in resolvePlannedScene(bars('95%', 95), CLAIMS, LOGOS)).toBe(true)
  })
})

describe('a planned graphic is an intent (decision 289)', () => {
  const planned = {
    type: 'graphic' as const,
    coversText: 'It raised four billion.',
    description: 'The figure.',
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
    intent: 'Four billion is the story.',
    intentRefs: [1],
  }

  it('resolves to a graphic with intent claim ids and no scene', () => {
    const stored = resolvePlannedBrief(planned, [{ id: CLAIM_A, text: '4 billion' }])
    expect(stored).toEqual({
      type: 'graphic',
      coversText: planned.coversText,
      description: planned.description,
      motion: planned.motion,
      transition: planned.transition,
      intent: planned.intent,
      intentClaimIds: [CLAIM_A],
    })
  })

  it('accepts a graphic that rests on no claim', () => {
    const bare = { ...planned, intentRefs: [] }
    expect(resolvePlannedBrief(bare, [{ id: CLAIM_A }])).toMatchObject({ intentClaimIds: [] })
    expect(plannedBriefRejection(bare, [{ id: CLAIM_A }])).toBeNull()
  })

  it('refuses a claim number outside the list, in words', () => {
    const bad = { ...planned, intentRefs: [3] }
    expect(resolvePlannedBrief(bad, [{ id: CLAIM_A }])).toBeNull()
    expect(plannedBriefRejection(bad, [{ id: CLAIM_A }])).toBe(
      'graphic named a claim number outside the claim list',
    )
  })

  it('no longer accepts a scene from the planner', () => {
    expect(
      PlannedBriefSchema.safeParse({ ...planned, intent: undefined, scene: { elements: [] } })
        .success,
    ).toBe(false)
  })
})

describe('HeadlineBriefSchema', () => {
  it('needs the claim it cites', () => {
    const brief = { type: 'headline' as const, ...common, sourceClaimId: CLAIM_A }
    expect(HeadlineBriefSchema.parse(brief).sourceClaimId).toBe(CLAIM_A)

    const { sourceClaimId, ...withoutClaim } = brief
    expect(sourceClaimId).toBe(CLAIM_A)
    expect(HeadlineBriefSchema.safeParse(withoutClaim).success).toBe(false)
  })

  it('has no field the model could write the article facts into', () => {
    const brief = HeadlineBriefSchema.parse({
      type: 'headline',
      ...common,
      sourceClaimId: CLAIM_A,
      outlet: 'The Financial Record',
      headline: 'Something nobody published',
    })
    expect('outlet' in brief).toBe(false)
    expect('headline' in brief).toBe(false)
  })

  it('converts to a text type through the description, but never back', () => {
    const brief = HeadlineBriefSchema.parse({
      type: 'headline',
      ...common,
      sourceClaimId: CLAIM_A,
    })
    expect(convertBrief(brief, 'stock')?.type).toBe('stock')
    expect(
      convertBrief(
        { type: 'stock', ...common, query: 'empty office', rejectionCriteria: [] },
        'headline',
      ),
    ).toBeNull()
  })
})

describe('SocialBriefSchema', () => {
  it('needs a post address', () => {
    const brief = {
      type: 'social' as const,
      ...common,
      sourceClaimId: CLAIM_A,
      postUrl: 'https://x.com/i/status/1234567890123456789',
    }
    expect(SocialBriefSchema.parse(brief).postUrl).toBe(
      'https://x.com/i/status/1234567890123456789',
    )

    const { postUrl, ...withoutPostUrl } = brief
    expect(postUrl).toBeTruthy()
    expect(SocialBriefSchema.safeParse(withoutPostUrl).success).toBe(false)
  })
})

describe('the visuals gate', () => {
  const slot = (status: SlotRef['status']): SlotRef => ({ status })

  it('counts coverage', () => {
    expect(
      visualsCoverage([
        slot('resolved'),
        slot('resolved'),
        slot('placeholder'),
        slot('unresolved'),
      ]),
    ).toEqual({ slots: 4, resolved: 2, placeholder: 1, unresolved: 1 })
  })

  it('refuses an empty board', () => {
    expect(visualsApprovalBlockedReason([])).toMatch(/no shot list/)
  })

  it('blocks while any slot is unresolved', () => {
    expect(visualsApprovalBlockedReason([slot('resolved'), slot('unresolved')])).toMatch(
      /1 slot is still unresolved/,
    )
  })

  it('blocks placeholders unless the approval names their exact count', () => {
    const slots = [slot('resolved'), slot('placeholder'), slot('placeholder')]

    // No acknowledgement, or a stale one from before the board changed.
    expect(visualsApprovalBlockedReason(slots)).toMatch(/approve with placeholders/)
    expect(visualsApprovalBlockedReason(slots, 1)).toMatch(/approve with placeholders/)

    // The button the user clicked said "approve with 2 placeholders".
    expect(visualsApprovalBlockedReason(slots, 2)).toBeUndefined()
  })

  it('approves a fully resolved board with no ceremony', () => {
    expect(visualsApprovalBlockedReason([slot('resolved'), slot('resolved')])).toBeUndefined()
  })
})

describe('SlotDraftStateSchema — what the card can honestly say', () => {
  it('accepts drafting and refused, and a refusal must carry its reason', () => {
    expect(SlotDraftStateSchema.parse({ state: 'drafting', target: 'chart' })).toEqual({
      state: 'drafting',
      target: 'chart',
    })
    expect(
      SlotDraftStateSchema.parse({ state: 'refused', target: 'map', reason: 'No real places.' }),
    ).toMatchObject({ state: 'refused' })
    expect(() =>
      SlotDraftStateSchema.parse({ state: 'refused', target: 'map', reason: '' }),
    ).toThrow()
    expect(() => SlotDraftStateSchema.parse({ state: 'done', target: 'map' })).toThrow()
  })
})

describe('convertBrief — re-typing a slot (staged-visuals design)', () => {
  const still = ShotBriefSchema.parse({
    type: 'still',
    ...common,
    prompt: 'Deserted office, dusk, painterly. Muted palette, film grain.',
  })

  it('derives a stock query from the description, not the tuned prompt', () => {
    const converted = convertBrief(still, 'stock')
    expect(converted).toMatchObject({
      type: 'stock',
      query: common.description,
      rejectionCriteria: [],
      coversText: common.coversText,
      motion: common.motion,
    })
    // The result is a VALID brief, not merely a similar shape.
    expect(ShotBriefSchema.parse(converted)).toBeTruthy()
  })

  it('carries the description alone into a still; the assembler adds the rest (decision 287)', () => {
    const stock = convertBrief(still, 'stock')!
    const back = convertBrief(stock, 'still')
    expect(back).toMatchObject({ type: 'still' })
    expect((back as { prompt: string }).prompt).toBe(common.description)
    expect(ShotBriefSchema.parse(back)).toBeTruthy()
  })

  it('fills archival mustShow so the converted brief stands on its own', () => {
    const archival = convertBrief(still, 'archival')
    expect(archival).toMatchObject({ type: 'archival', mustShow: common.description })
    expect(ShotBriefSchema.parse(archival)).toBeTruthy()
  })

  it('returns the brief unchanged when the target is its own type', () => {
    expect(convertBrief(still, 'still')).toBe(still)
  })

  it('refuses the structured types — those need a model, not a template', () => {
    expect(convertBrief(still, 'chart')).toBeNull()
    expect(convertBrief(still, 'map')).toBeNull()
    expect(convertBrief(still, 'hero')).toBeNull()
  })

  it('converts INTO a headline only once the article has been picked', () => {
    // Nothing in the old brief says WHICH article, and no model may choose
    // one (decision 257). So the conversion is null until a claim arrives
    // with it — that null is what sends the board to its chooser.
    expect(convertBrief(still, 'headline')).toBeNull()

    const headline = convertBrief(still, 'headline', { headlineClaimId: CLAIM_A })
    expect(headline).toMatchObject({
      type: 'headline',
      sourceClaimId: CLAIM_A,
      coversText: common.coversText,
      description: common.description,
    })
    expect(ShotBriefSchema.parse(headline)).toBeTruthy()
  })

  it('re-points a headline at another article, keeping how the card is drawn', () => {
    const headline = ShotBriefSchema.parse({
      type: 'headline',
      ...common,
      sourceClaimId: CLAIM_A,
      emphasis: 'could not find the money',
      showDeck: true,
    })

    const moved = convertBrief(headline, 'headline', { headlineClaimId: CLAIM_B })
    // The type has not moved but the card has, so the same-type short circuit
    // must not hand back the old brief still citing the old claim.
    expect(moved).toMatchObject({ sourceClaimId: CLAIM_B, showDeck: true })
    // The marker quoted words the OLD headline printed, so it does not travel.
    expect(moved).not.toHaveProperty('emphasis')
    expect(ShotBriefSchema.parse(moved)).toBeTruthy()

    // With no claim to move to, it is still the same brief, untouched.
    expect(convertBrief(headline, 'headline')).toBe(headline)
  })

  it('converts INTO a social card only once the post has been picked', () => {
    expect(convertBrief(still, 'social')).toBeNull()

    const socialClaim = { id: CLAIM_A, sourceUrl: 'https://x.com/i/status/1234567890123456789' }
    const social = convertBrief(still, 'social', { socialClaim })
    expect(social).toMatchObject({
      type: 'social',
      sourceClaimId: CLAIM_A,
      postUrl: 'https://x.com/i/status/1234567890123456789',
      coversText: common.coversText,
      description: common.description,
    })
    expect(ShotBriefSchema.parse(social)).toBeTruthy()
  })

  it('repoints a social card to another claim’s post, dropping what it chose against the old one', () => {
    const social = ShotBriefSchema.parse({
      type: 'social',
      ...common,
      sourceClaimId: CLAIM_A,
      postUrl: 'https://x.com/i/status/1234567890123456789',
      excerpt: 'the old post’s words',
      emphasis: 'old post',
      avatarAssetId: CLAIM_A,
      mediaAssetId: CLAIM_A,
    })
    const other = { id: CLAIM_B, sourceUrl: 'https://x.com/Someone/status/9876543210987654321' }

    const moved = convertBrief(social, 'social', { socialClaim: other })
    // The type has not moved but the card has, so the same-type short circuit
    // must not hand back the old brief still showing the old post.
    expect(moved).not.toBe(social)
    expect(moved).toMatchObject({
      type: 'social',
      sourceClaimId: CLAIM_B,
      postUrl: 'https://x.com/i/status/9876543210987654321',
    })
    expect(moved).not.toHaveProperty('excerpt')
    expect(moved).not.toHaveProperty('emphasis')
    expect(moved).not.toHaveProperty('avatarAssetId')
    expect(moved).not.toHaveProperty('mediaAssetId')
    expect(ShotBriefSchema.parse(moved)).toBeTruthy()

    // With no post to move to, it is still the same brief, untouched.
    expect(convertBrief(social, 'social')).toBe(social)
  })

  it('converts a social brief to a text type through the description', () => {
    const social = ShotBriefSchema.parse({
      type: 'social',
      ...common,
      sourceClaimId: CLAIM_A,
      postUrl: 'https://x.com/i/status/1234567890123456789',
    })
    expect(convertBrief(social, 'stock')).toMatchObject({
      type: 'stock',
      query: common.description,
    })
  })
})

describe('REUSABLE_SLOT_TYPES', () => {
  it('is pictures, never data (decision 261)', () => {
    expect(REUSABLE_SLOT_TYPES).toEqual(['stock', 'still', 'archival'])
  })
})

describe('a still brief may name a set', () => {
  const base = {
    type: 'still' as const,
    coversText: 'x',
    description: 'x',
    shotSize: 'medium' as const,
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
    prompt: 'p',
  }

  it('accepts a set name and leaves it off when absent', () => {
    expect(StillBriefSchema.parse({ ...base, set: 'Venture Capital Boardroom' }).set).toBe(
      'Venture Capital Boardroom',
    )
    expect(StillBriefSchema.parse(base).set).toBeUndefined()
  })

  it('refuses an empty set name, which would join to nothing', () => {
    expect(StillBriefSchema.safeParse({ ...base, set: '' }).success).toBe(false)
  })
})

describe('StillBriefSchema camera (decision 275)', () => {
  const still = {
    type: 'still',
    coversText: 'The board met.',
    description: 'The board at the table.',
    shotSize: 'wide',
    motion: { kind: 'static' },
    transition: 'cut',
    prompt: 'The board at the table.',
    set: 'The boardroom',
  }

  it('keeps a well-formed camera', () => {
    const camera = { facing: 'south', position: 'the north windows, seated height', lens: '35mm' }
    expect(StillBriefSchema.parse({ ...still, camera }).camera).toEqual(camera)
  })

  it('drops a malformed camera and keeps the brief', () => {
    const parsed = StillBriefSchema.parse({ ...still, camera: { facing: 'up', position: '' } })
    expect(parsed.camera).toBeUndefined()
    expect(parsed.prompt).toBe(still.prompt)
  })
})

// Decision 280: a front page is no article to quote.
describe('claimCarriesArticle', () => {
  const ID = '01HQ00000000000000000000AA'
  const outlet = (sourceUrl: string | null) => ({ id: ID, sourceType: 'major_outlet', sourceUrl })

  it("takes an outlet's article, and a topic page, but never a front page", () => {
    expect(claimCarriesArticle(outlet('https://www.semafor.com/article/10/2023/cash'))).toBe(true)
    expect(claimCarriesArticle(outlet('https://www.ft.com/wirecard'))).toBe(true)
    expect(claimCarriesArticle(outlet('https://www.semafor.com'))).toBe(false)
    expect(claimCarriesArticle(outlet('https://www.reuters.com/'))).toBe(false)
  })

  it('still refuses what it always refused', () => {
    expect(
      claimCarriesArticle({
        id: ID,
        sourceType: 'court',
        sourceUrl: 'https://court.example/ruling',
      }),
    ).toBe(false)
    expect(claimCarriesArticle(outlet(null))).toBe(false)
    expect(claimCarriesArticle(undefined)).toBe(false)
  })
})

describe('job stamps (decision 286)', () => {
  const startedAt = '2026-09-30T10:00:00.000Z'

  it('takes a refetch or redirect stamp on a slot, and nothing else', () => {
    const jobId = newId()
    expect(SlotJobSchema.safeParse({ kind: 'refetch', jobId, startedAt }).success).toBe(true)
    expect(SlotJobSchema.safeParse({ kind: 'redirect', jobId, startedAt }).success).toBe(true)
    expect(SlotJobSchema.safeParse({ kind: 'retype', jobId, startedAt }).success).toBe(false)
    expect(
      SlotJobSchema.safeParse({ kind: 'refetch', jobId, startedAt: 'yesterday' }).success,
    ).toBe(false)
  })

  it('names the project ops the re-plan event already uses, plus fetch', () => {
    for (const op of ['shots', 'repair', 'direction', 'fetch']) {
      expect(VisualsJobSchema.safeParse({ op, jobId: newId(), startedAt }).success).toBe(true)
    }
    expect(VisualsJobSchema.safeParse({ op: 'replan', jobId: newId(), startedAt }).success).toBe(
      false,
    )
  })
})

describe('an undesigned graphic (decision 289)', () => {
  const graphicCommon = {
    coversText: 'It raised four billion.',
    description: 'The figure, large.',
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
  }
  const SCENE_CELL = { col: 0, row: 0, colSpan: 6, rowSpan: 3 }
  const STORED_SCENE = {
    elements: [
      {
        kind: 'figure' as const,
        id: 'f1',
        cell: SCENE_CELL,
        value: '$4bn',
        claimRef: CLAIM_A,
        color: 'accent' as const,
        enter: { kind: 'fade' as const, atMs: 0 },
      },
    ],
  }

  it('parses with an intent and no scene', () => {
    const parsed = ShotBriefSchema.parse({
      type: 'graphic',
      ...graphicCommon,
      intent: 'Four billion in one round is the story.',
      intentClaimIds: [CLAIM_A],
    })
    expect(parsed.type === 'graphic' && parsed.scene).toBeUndefined()
  })

  it('still parses a graphic stored before intents existed', () => {
    const parsed = ShotBriefSchema.parse({
      type: 'graphic',
      ...graphicCommon,
      scene: STORED_SCENE,
    })
    expect(parsed.type === 'graphic' && parsed.intent).toBeUndefined()
  })

  it('reads the description as the intent of a graphic stored before intents', () => {
    const brief = GraphicBriefSchema.parse({
      type: 'graphic',
      ...graphicCommon,
      scene: STORED_SCENE,
    })
    expect(graphicIntentOf(brief)).toEqual({
      intent: 'The figure, large.',
      claimIds: graphicSceneClaimIds(STORED_SCENE),
    })
  })

  it('resolves a planned scene to claim ids, and refuses a number the claim lacks', () => {
    const claims = [
      { id: CLAIM_A, text: 'It raised 4 billion dollars.' },
      { id: CLAIM_B, text: 'It employs 1,200 people.' },
    ]
    const ok = resolvePlannedScene(
      {
        elements: [
          {
            kind: 'figure',
            id: 'f',
            cell: SCENE_CELL,
            value: '$4bn',
            claimRef: 1,
            color: 'accent',
            enter: { kind: 'count', atMs: 0 },
          },
        ],
      },
      claims,
    )
    expect('scene' in ok && ok.scene.elements[0]).toMatchObject({ claimRef: CLAIM_A })
    const bad = resolvePlannedScene(
      {
        elements: [
          {
            kind: 'figure',
            id: 'f',
            cell: SCENE_CELL,
            value: '$5bn',
            claimRef: 1,
            color: 'accent',
            enter: { kind: 'fade', atMs: 0 },
          },
        ],
      },
      claims,
    )
    expect(bad).toEqual({
      issue: 'graphic showed a number the cited claim does not contain: $5bn against claim 1',
    })
  })

  it('turns a stored scene back into claim numbers for a redesign', () => {
    const planned = toPlannedScene(STORED_SCENE, [CLAIM_B, CLAIM_A])
    // STORED_SCENE's figure cites CLAIM_A, which is number 2 in this list.
    expect(planned.elements.find((e) => e.kind === 'figure')).toMatchObject({ claimRef: 2 })
  })

  it('numbers a claim that left the list as 0 and drops a logo asset id', () => {
    const planned = toPlannedScene(
      {
        elements: [
          ...STORED_SCENE.elements,
          {
            kind: 'logo',
            id: 'l1',
            cell: { ...SCENE_CELL, col: 6 },
            entity: 'Stability AI',
            assetId: '01HQ00000000000000000000M1',
            enter: { kind: 'fade', atMs: 0 },
          },
        ],
      },
      [CLAIM_B],
    )
    expect(planned.elements[0]).toMatchObject({ claimRef: 0 })
    expect(planned.elements[1]).not.toHaveProperty('assetId')
  })

  describe('keepGraphicDesign (decision 289)', () => {
    const common = {
      coversText: 'c',
      description: 'd',
      motion: { kind: 'static' as const },
      transition: 'cut' as const,
    }

    it('keeps a designed scene when a rewrite returns an intent-only graphic', () => {
      const previous = { type: 'graphic' as const, ...common, intent: 'old', scene: STORED_SCENE }
      const next = { type: 'graphic' as const, ...common, intent: 'new', intentClaimIds: [] }
      expect(keepGraphicDesign(previous, next)).toEqual({ ...next, scene: STORED_SCENE })
    })

    it('leaves every other rewrite alone', () => {
      const still = { type: 'still' as const, ...common, prompt: 'p' }
      const next = { type: 'graphic' as const, ...common, intent: 'new' }
      expect(keepGraphicDesign(still as never, next)).toBe(next)
      const undesigned = { type: 'graphic' as const, ...common, intent: 'old' }
      expect(keepGraphicDesign(undesigned, next)).toBe(next)
    })
  })
})
