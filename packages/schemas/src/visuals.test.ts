import { describe, expect, it } from 'vitest'
import {
  ChartBriefSchema,
  HeadlineBriefSchema,
  HERO_SLOTS_ENABLED,
  PlannedBriefSchema,
  ShotBriefSchema,
  SlotCandidateSchema,
  SlotDraftStateSchema,
  convertBrief,
  mapClaimRefs,
  plannedBriefRejection,
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

  it('appends the style anchors when converting INTO a still', () => {
    const stock = convertBrief(still, 'stock')!
    const back = convertBrief(stock, 'still', { stillStyleAnchors: 'Muted palette, 35mm grain' })
    expect(back).toMatchObject({ type: 'still' })
    expect((back as { prompt: string }).prompt).toBe(
      `${common.description}. Muted palette, 35mm grain`,
    )
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
})
