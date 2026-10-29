import type {
  ArchivalBrief,
  BibleInUse,
  CaseBrief,
  DirectorsBook,
  Outline,
  Scene,
  ShotBrief,
  SlotCandidate,
  StockBrief,
  StillBrief,
} from '@boom-busters/schemas'
import { exemplarFor, exemplars } from '../../exemplars/index'
import type { LLMTaskRequest } from '../../llm/types'
import { buildCastIdentityRequest } from '../cast-identity'
import { buildDigestRequest } from '../digest'
import type { DigestLine } from '../digest'
import { buildDirectorsBookRequest } from '../direction'
import {
  buildAnswersRequest,
  buildBriefRequest,
  buildClaimsRequest,
  buildScenesRequest,
} from '../dossier'
import { buildGraphicRequest } from '../graphics'
import type { GraphicDesignInput } from '../graphics'
import { buildDescriptionRequest, buildTitlesRequest } from '../metadata'
import { buildRebriefRequest } from '../rebrief'
import { buildRedirectRequest } from '../redirect'
import { buildRetypeRequest } from '../retype'
import { buildScoringRequest } from '../scoring'
import {
  buildChapterRequest,
  buildOutlineRequest,
  buildRegenerateRequest,
  buildSelfCheckRequest,
  buildShortsRequest,
  buildTeaserRequest,
} from '../script'
import type { ScriptClaim } from '../script'
import { buildShotListRequest, buildShotRepairRequest } from '../shotlist'
import { buildStretchRequest } from '../stretch'
import { buildNameSubjectRequest } from '../subject'

/**
 * Every prompt builder the channel bible lift touches, called with fixed
 * literal inputs, so what each one sends today is captured once and any later
 * change to it shows as a fixture diff. `build` takes the bible and ignores it
 * for now; the lift tasks pass it through and set `bibleAware` as each builder
 * learns to read it. `buildSuggestCasesRequest` and `buildScoreNamedCasesRequest`
 * are left out: the Suggest cases are not parameterised by the bible.
 */
export interface LiftCase {
  name: string
  build: (bible: BibleInUse) => LLMTaskRequest
  bibleAware: boolean
}

const lift = (name: string, build: (bible: BibleInUse) => LLMTaskRequest): LiftCase => ({
  name,
  build,
  bibleAware: false,
})

/** A case whose builder reads the bible: the psychology test holds it to a second channel. */
const liftAware = (name: string, build: (bible: BibleInUse) => LLMTaskRequest): LiftCase => ({
  name,
  build,
  bibleAware: true,
})

// ---------------------------------------------------------------------------
// Shared inputs
// ---------------------------------------------------------------------------

const ID_1 = '01HQ00000000000000000000AA'
const ID_2 = '01HQ00000000000000000000AB'
const ID_3 = '01HQ00000000000000000000AC'
const ID_4 = '01HQ00000000000000000000AD'

/** One of each mark the claim list can carry: adjudicated, unverified, a news article, an X post. */
const CLAIMS: ScriptClaim[] = [
  {
    id: ID_1,
    text: 'Wirecard reported 1.9 billion euros held in trust accounts in the Philippines.',
    sourceUrl: 'https://www.ft.com/content/wirecard-missing-cash',
    confidence: 'sourced',
    adjudicated: false,
    sourceType: 'major_outlet',
  },
  {
    id: ID_2,
    text: 'Markus Braun was chief executive of Wirecard from 2002 to June 2020.',
    sourceUrl: 'https://example.com/braun',
    confidence: 'sourced',
    adjudicated: true,
    sourceType: 'court',
  },
  {
    id: ID_3,
    text: 'A short seller alleged in 2016 that the accounts were inflated.',
    sourceUrl: 'https://x.com/zatarra/status/1234567890123456789',
    confidence: 'unverified',
    adjudicated: false,
    sourceType: 'social',
  },
]

const CLAIMS_FOUR: ScriptClaim[] = [
  ...CLAIMS,
  {
    id: ID_4,
    text: 'The share price fell from 104.5 euros to 1.28 euros in nine days.',
    sourceUrl: null,
    confidence: 'sourced',
  },
]

const OUTLINE: Outline = {
  centralQuestion: 'How did 1.9 billion euros never exist?',
  storylines: ['the money', 'the auditors', 'the courts'],
  close: {
    answer: 'It never existed, and the people paid to check stopped asking.',
    echo: 'the empty trust account',
    openThread: 'Where Jan Marsalek is.',
  },
  chapters: [
    {
      title: 'The glass box',
      storyline: 'the money',
      beat: 'A glimpse of the day the money was missing.',
      claims: [1],
      question: 'Where was the cash?',
      withhold: 'That the accounts were never audited by anyone who visited.',
      stakes: 'Five thousand employees and a place in the DAX.',
      constraints: 'The cash is alleged missing, never stated as stolen.',
      targetWords: 600,
    },
    {
      title: 'The short seller',
      storyline: 'the auditors',
      beat: 'The first public attack, and how the company answered it.',
      claims: [2],
      question: 'Who was telling the truth?',
      reveals: 'That the accounts were never audited by anyone who visited.',
      stakes: 'A reputation, and a share price built on it.',
      constraints: 'The short seller is a party with a position, named as one.',
      targetWords: 900,
    },
    {
      title: 'Nine days',
      storyline: 'the courts',
      beat: 'The collapse, day by day.',
      claims: [3],
      stakes: 'Every shareholder, and the regulator that approved the listing.',
      targetWords: 800,
    },
  ],
}

/** An outline planned before the tension fields, storylines or claim homes existed. */
const OUTLINE_BARE: Outline = {
  chapters: [
    { title: 'The glass box', beat: 'The company as it looked.', targetWords: 600 },
    { title: 'Nine days', beat: 'The collapse.', targetWords: 700 },
  ],
}

const CHAPTER_ONE = {
  title: 'The glass box',
  contentMd:
    'On the nineteenth of June, a company worth billions admitted something. [pause] ' +
    'It could not find the money.',
}
const CHAPTER_TWO = {
  title: 'The short seller',
  contentMd: 'Years earlier, one man had said exactly that. Nobody wanted to listen.',
}

const BOOK: DirectorsBook = {
  visualThesis: 'A company that looked solid from the street and hollow from inside.',
  eraLocks: [{ span: '2011 to 2020', rules: 'flat screens, glass offices, smartphones' }],
  palette: { accent: '#c9a227', temperature: 'cold', note: 'gold only on money and signatures' },
  motifs: ['reflections in dark glass', 'a lanyard on a desk', 'printed pages under lamplight'],
  anchorObject: 'a bound annual report',
  neverShow: ['cash in bags', 'handcuffs'],
  principals: [
    {
      name: 'Markus Braun',
      role: 'chief executive',
      depiction: 'likeness',
      identityString:
        'Markus Braun, chief executive, man in his late forties, shaved head, rimless glasses, black turtleneck',
      guardrail: 'never handling cash; never mocked or caricatured',
    },
  ],
  locations: [
    { name: 'Aschheim headquarters', look: 'glass box on a business park, grey sky' },
    { name: 'The boardroom', look: 'long table, blinds half drawn' },
  ],
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

const SETS = [
  {
    name: 'The boardroom',
    look: 'long table, blinds half drawn',
    layout: 'North wall: the blinds.\nEast wall: a whiteboard.\n\nSouth wall: the door.',
  },
  { name: 'The trading floor', look: 'rows of screens, no people at them' },
]

const PARAGRAPHS = [
  {
    index: 0,
    text: 'On the nineteenth of June, a company worth billions admitted something. [pause] It could not find the money.',
    seconds: 9.4,
  },
  { index: 1, text: 'Nine days later it was insolvent.', seconds: 3.6 },
]

const STILL: StillBrief = {
  type: 'still',
  coversText: 'Braun took the stage.',
  description: 'The chief executive at the results presentation.',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt: 'Markus Braun at a podium, 50mm, one spotlight.',
  depicts: ['Markus Braun'],
  shotSize: 'medium',
}

const STOCK: StockBrief = {
  type: 'stock',
  coversText: 'By June, the auditors could not find the money.',
  description: 'Deserted open-plan office at dusk, cool blue grade.',
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'empty office dusk',
  rejectionCriteria: ['no watermarks', 'no modern laptops'],
}

const ARCHIVAL: ArchivalBrief = {
  type: 'archival',
  coversText: 'The headquarters in Aschheim.',
  description: 'The glass building as it stood in 2019.',
  motion: { kind: 'kenburns', direction: 'in', speed: 'slow' },
  transition: 'dissolve',
  query: 'Wirecard headquarters Aschheim 2019',
  mustShow: 'the Wirecard sign on the building',
  eraRange: '2018 to 2020',
}

const CHART: ShotBrief = {
  type: 'chart',
  coversText: 'The share price fell from 104.5 euros to 1.28 euros.',
  description: 'The share price through June 2020.',
  motion: { kind: 'static' },
  transition: 'cut',
  chartKind: 'line',
  series: [
    {
      label: 'Share price',
      unit: 'EUR',
      points: [
        { x: '2018', y: 104.5 },
        { x: '2020', y: 1.28 },
      ],
    },
  ],
  dataRefs: [ID_4],
  takeaway: 'The fall',
  reveal: 'draw-on',
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const HOOK =
  'On the nineteenth of June, a company worth billions admitted it could not find the money.'
const SHORT_TEXT =
  'In 2016 one anonymous account said the accounts were inflated. [pause] ' +
  'The company called it a lie, and the regulator agreed.'
/** Over the 600-character excerpt cut, with a narration tag that is stripped. */
const LONG_NARRATION =
  'The money was meant to sit in two trust accounts in Manila. [long pause] ' +
  'The auditors were told it did. The bank was told nothing. ' +
  'For years the numbers on the page were the only proof, and the page was written by the people it protected. '.repeat(
    5,
  )

const CHAPTERS_META = [
  {
    title: 'The glass box',
    text: 'On the nineteenth of June, a company admitted it could not find the money.',
  },
  { title: 'The short seller', text: LONG_NARRATION },
]

const metadataCases: LiftCase[] = [
  lift('metadata-titles-master', () =>
    buildTitlesRequest({
      caseTitle: 'Wirecard',
      hook: HOOK,
      target: 'master',
      workingTitle: 'How Wirecard Lost 1.9 Billion Euros',
      claims: CLAIMS,
      centralQuestion: 'How did 1.9 billion euros never exist?',
    }),
  ),
  lift('metadata-titles-master-bare', () =>
    buildTitlesRequest({
      caseTitle: 'Wirecard',
      hook: HOOK,
      target: 'master',
      workingTitle: 'How Wirecard Lost 1.9 Billion Euros',
    }),
  ),
  lift('metadata-titles-short', () =>
    buildTitlesRequest({
      caseTitle: 'Wirecard',
      hook: HOOK,
      target: 'short',
      workingTitle: 'How Wirecard Lost 1.9 Billion Euros',
      claims: CLAIMS,
      centralQuestion: 'How did 1.9 billion euros never exist?',
    }),
  ),
  lift('metadata-titles-short-clip', () =>
    buildTitlesRequest({
      caseTitle: 'Wirecard',
      hook: HOOK,
      target: 'short',
      workingTitle: 'How Wirecard Lost 1.9 Billion Euros',
      claims: CLAIMS,
      centralQuestion: 'How did 1.9 billion euros never exist?',
      shortText: SHORT_TEXT,
    }),
  ),
  lift('metadata-titles-short-clip-long', () =>
    buildTitlesRequest({
      caseTitle: 'Wirecard',
      hook: HOOK,
      target: 'short',
      workingTitle: 'How Wirecard Lost 1.9 Billion Euros',
      shortText: LONG_NARRATION,
    }),
  ),
  // A shortText on a master is ignored: the clip is for a Short only.
  lift('metadata-titles-master-ignores-short-text', () =>
    buildTitlesRequest({
      caseTitle: 'Wirecard',
      hook: HOOK,
      target: 'master',
      workingTitle: 'How Wirecard Lost 1.9 Billion Euros',
      claims: CLAIMS,
      shortText: SHORT_TEXT,
    }),
  ),
  lift('metadata-description-master', () =>
    buildDescriptionRequest({
      target: 'master',
      claims: CLAIMS,
      centralQuestion: 'How did 1.9 billion euros never exist?',
      chapters: CHAPTERS_META,
    }),
  ),
  lift('metadata-description-master-bare', () =>
    buildDescriptionRequest({ target: 'master', claims: CLAIMS, chapters: [] }),
  ),
  lift('metadata-description-master-question-only', () =>
    buildDescriptionRequest({
      target: 'master',
      claims: CLAIMS,
      centralQuestion: 'How did 1.9 billion euros never exist?',
      chapters: [],
    }),
  ),
  lift('metadata-description-master-chapters-only', () =>
    buildDescriptionRequest({ target: 'master', claims: CLAIMS, chapters: CHAPTERS_META }),
  ),
  lift('metadata-description-short', () =>
    buildDescriptionRequest({ target: 'short', claims: CLAIMS, chapters: [] }),
  ),
  lift('metadata-description-short-clip', () =>
    buildDescriptionRequest({
      target: 'short',
      claims: CLAIMS,
      chapters: [],
      shortText: SHORT_TEXT,
    }),
  ),
]

// ---------------------------------------------------------------------------
// Shot list, repair and stretch
// ---------------------------------------------------------------------------

const shotListMinimal = () =>
  buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The glass box',
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
  })

const shotListCases: LiftCase[] = [
  lift('shotlist-no-sets-minimal', shotListMinimal),
  lift('shotlist-no-sets-empty-claims', () =>
    buildShotListRequest({
      caseTitle: 'Wirecard',
      chapterTitle: 'The glass box',
      paragraphs: PARAGRAPHS,
      claims: [],
    }),
  ),
  lift('shotlist-no-sets-full', () =>
    buildShotListRequest({
      caseTitle: 'Wirecard',
      chapterTitle: 'The glass box',
      chapterNumber: 1,
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      direction: BOOK,
      photographed: ['Markus Braun', '  '],
      logos: ['Wirecard AG', ' '],
    }),
  ),
  lift('shotlist-direction-without-chapter-number', () =>
    buildShotListRequest({
      caseTitle: 'Wirecard',
      chapterTitle: 'The glass box',
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      direction: BOOK,
    }),
  ),
  lift('shotlist-sets', () =>
    buildShotListRequest({
      caseTitle: 'Wirecard',
      chapterTitle: 'The glass box',
      chapterNumber: 2,
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      direction: BOOK,
      photographed: ['Markus Braun'],
      sets: SETS,
      logos: ['Wirecard AG'],
    }),
  ),
  lift('shotlist-sets-only', () =>
    buildShotListRequest({
      caseTitle: 'Wirecard',
      chapterTitle: 'The glass box',
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      sets: SETS,
    }),
  ),
  lift('shotlist-photographed-only', () =>
    buildShotListRequest({
      caseTitle: 'Wirecard',
      chapterTitle: 'The glass box',
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      photographed: ['Markus Braun'],
    }),
  ),
  lift('shot-repair-single', () =>
    buildShotRepairRequest(
      shotListMinimal(),
      [
        {
          brief: STILL,
          problems: ['It names a person but lists no one in "depicts".'],
        },
      ],
      { allowStockToStill: false },
    ),
  ),
  lift('shot-repair-plural-stock-to-still', () =>
    buildShotRepairRequest(
      shotListMinimal(),
      [
        { brief: STOCK, problems: ['It names a set, so it should be a still.'] },
        {
          brief: STILL,
          problems: ['The prompt places the camera.', 'The prompt describes the room.'],
        },
      ],
      { allowStockToStill: true },
    ),
  ),
  lift('stretch-minimal', () =>
    buildStretchRequest(
      { ...shotListMinimal(), cacheablePrefixMessages: 1 },
      {
        pieces: [{ paragraphIndex: 1, text: 'Nine days later it was insolvent.', seconds: 3.6 }],
        opening: 'Nine days later',
        before: null,
        after: null,
        headlineAllowed: true,
      },
    ),
  ),
  lift('stretch-full', () =>
    buildStretchRequest(
      { ...shotListMinimal(), cacheablePrefixMessages: 1 },
      {
        pieces: [
          { paragraphIndex: 0, text: PARAGRAPHS[0]!.text, seconds: 9.4 },
          { paragraphIndex: 1, text: PARAGRAPHS[1]!.text, seconds: 3.6 },
        ],
        opening: 'On the nineteenth of June,',
        before: { type: 'stock', coversText: 'Before.' },
        after: { type: 'stock', coversText: 'After.' },
        headlineAllowed: false,
        note: 'keep the headline card up through the FT line',
        reason: 'Two shots in a row ran under four seconds.',
      },
    ),
  ),
]

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

const scriptCases: LiftCase[] = [
  liftAware('script-outline', (bible) =>
    buildOutlineRequest({
      bible,
      caseTitle: 'Wirecard',
      dossierMd: '# Wirecard\n\nA payments company that reported money it did not have.',
      claims: CLAIMS,
      targetRuntimeMin: 12,
    }),
  ),
  liftAware('script-outline-no-claims', (bible) =>
    buildOutlineRequest({
      bible,
      caseTitle: 'Wirecard',
      dossierMd: '# Wirecard\n\nA payments company that reported money it did not have.',
      claims: [],
      targetRuntimeMin: 8,
    }),
  ),
  liftAware('script-chapter-first', (bible) =>
    buildChapterRequest({
      bible,
      caseTitle: 'Wirecard',
      outline: OUTLINE,
      chapterIndex: 0,
      previousChapters: [],
      claims: CLAIMS,
    }),
  ),
  liftAware('script-chapter-middle', (bible) =>
    buildChapterRequest({
      bible,
      caseTitle: 'Wirecard',
      outline: OUTLINE,
      chapterIndex: 1,
      previousChapters: [CHAPTER_ONE],
      claims: CLAIMS_FOUR,
    }),
  ),
  liftAware('script-chapter-last', (bible) =>
    buildChapterRequest({
      bible,
      caseTitle: 'Wirecard',
      outline: OUTLINE,
      chapterIndex: 2,
      previousChapters: [CHAPTER_ONE, CHAPTER_TWO],
      claims: CLAIMS,
    }),
  ),
  // An outline planned before storylines, tension fields and claim homes.
  liftAware('script-chapter-bare-outline', (bible) =>
    buildChapterRequest({
      bible,
      caseTitle: 'Wirecard',
      outline: OUTLINE_BARE,
      chapterIndex: 1,
      previousChapters: [CHAPTER_ONE],
      claims: CLAIMS,
    }),
  ),
  // The final chapter's close, each field alone and none at all.
  ...(
    [
      ['partial-close', { answer: 'It never existed, and nobody checked.' }],
      ['close-echo-only', { echo: 'the empty trust account' }],
      ['close-open-thread-only', { openThread: 'Where Jan Marsalek is.' }],
      ['empty-close', {}],
    ] as const
  ).map(([suffix, close]) =>
    liftAware(`script-chapter-${suffix}`, (bible) =>
      buildChapterRequest({
        bible,
        caseTitle: 'Wirecard',
        outline: { ...OUTLINE, close },
        chapterIndex: 2,
        previousChapters: [CHAPTER_ONE, CHAPTER_TWO],
        claims: CLAIMS,
      }),
    ),
  ),
  liftAware('script-self-check', (bible) =>
    buildSelfCheckRequest({
      bible,
      chapterTitle: 'The glass box',
      contentMd: CHAPTER_ONE.contentMd,
      claims: CLAIMS,
    }),
  ),
  liftAware('script-shorts', (bible) =>
    buildShortsRequest({
      bible,
      chapters: [
        { index: 0, ...CHAPTER_ONE },
        { index: 1, ...CHAPTER_TWO },
      ],
    }),
  ),
  liftAware('script-shorts-tension', (bible) =>
    buildShortsRequest({
      bible,
      chapters: [
        { index: 0, ...CHAPTER_ONE },
        { index: 1, ...CHAPTER_TWO },
        { index: 2, title: 'Nine days', contentMd: 'Nine days later it was insolvent.' },
      ],
      tension: {
        centralQuestion: 'How did 1.9 billion euros never exist?',
        chapters: [
          { index: 0, question: 'Where was the cash?', withhold: 'That nobody visited.' },
          { index: 1, question: 'Who was telling the truth?' },
          { index: 2 },
        ],
      },
    }),
  ),
  liftAware('script-shorts-tension-no-question', (bible) =>
    buildShortsRequest({
      bible,
      chapters: [
        { index: 0, ...CHAPTER_ONE },
        { index: 1, ...CHAPTER_TWO },
      ],
      tension: {
        chapters: [{ index: 0, withhold: 'That nobody visited.' }, { index: 1 }],
      },
    }),
  ),
  liftAware('script-shorts-tension-empty', (bible) =>
    buildShortsRequest({
      bible,
      chapters: [
        { index: 0, ...CHAPTER_ONE },
        { index: 1, ...CHAPTER_TWO },
      ],
      tension: { chapters: [{ index: 0 }, { index: 1 }] },
    }),
  ),
  liftAware('script-teaser', (bible) =>
    buildTeaserRequest({
      bible,
      caseTitle: 'Wirecard',
      chapters: [
        { index: 0, ...CHAPTER_ONE },
        { index: 1, ...CHAPTER_TWO },
      ],
    }),
  ),
  liftAware('script-teaser-tension', (bible) =>
    buildTeaserRequest({
      bible,
      caseTitle: 'Wirecard',
      chapters: [
        { index: 0, ...CHAPTER_ONE },
        { index: 1, ...CHAPTER_TWO },
        { index: 2, title: 'Nine days', contentMd: 'Nine days later it was insolvent.' },
      ],
      tension: {
        centralQuestion: 'How did 1.9 billion euros never exist?',
        chapters: [{ index: 0, withhold: 'That nobody visited.' }, { index: 1 }, { index: 2 }],
      },
    }),
  ),
  liftAware('script-teaser-tension-no-question', (bible) =>
    buildTeaserRequest({
      bible,
      caseTitle: 'Wirecard',
      chapters: [
        { index: 0, ...CHAPTER_ONE },
        { index: 1, ...CHAPTER_TWO },
      ],
      tension: {
        chapters: [{ index: 0, withhold: 'That nobody visited.' }, { index: 1 }],
      },
    }),
  ),
  liftAware('script-teaser-tension-empty', (bible) =>
    buildTeaserRequest({
      bible,
      caseTitle: 'Wirecard',
      chapters: [
        { index: 0, ...CHAPTER_ONE },
        { index: 1, ...CHAPTER_TWO },
      ],
      tension: { chapters: [{ index: 0 }, { index: 1 }] },
    }),
  ),
  liftAware('script-regenerate', (bible) =>
    buildRegenerateRequest({
      bible,
      chapterTitle: 'The glass box',
      contentMd: CHAPTER_ONE.contentMd,
      selection: 'It could not find the money.',
      note: 'Make it plainer, and shorter.',
      claims: CLAIMS,
    }),
  ),
]

// ---------------------------------------------------------------------------
// Direction, redirect, rebrief, retype, cast identity
// ---------------------------------------------------------------------------

const directionCases: LiftCase[] = [
  lift('direction-book-minimal', () =>
    buildDirectorsBookRequest({
      caseTitle: 'Wirecard',
      chapters: [
        { title: 'The glass box', paragraphs: ['A company that looked solid.'] },
        { title: 'Nine days', paragraphs: ['By June, the auditors could not find the money.'] },
      ],
      claims: CLAIMS,
    }),
  ),
  lift('direction-book-full', () =>
    buildDirectorsBookRequest({
      caseTitle: 'Wirecard',
      centralQuestion: 'How did 1.9 billion euros never exist?',
      chapters: [
        {
          title: 'The glass box',
          paragraphs: ['A company that looked solid.', 'Then it did not.'],
          question: 'Where was the cash?',
          withhold: 'The Manila trustee',
        },
        {
          title: 'Nine days',
          paragraphs: ['By June, the auditors could not find the money.'],
          question: 'Who knew?',
        },
        {
          title: 'The reckoning',
          paragraphs: ['The courts took years.'],
          withhold: 'The verdict',
        },
      ],
      claims: CLAIMS,
      cast: [
        {
          name: 'Markus Braun',
          role: 'chief executive',
          identityString: 'Markus Braun, late forties, shaved head, rimless glasses',
        },
        { name: 'Jan Marsalek', role: 'chief operating officer', identityString: '' },
      ],
    }),
  ),
  lift('redirect-with-direction', () =>
    buildRedirectRequest({
      caseTitle: 'Wirecard',
      brief: STILL,
      reason: 'google: SAFETY',
      direction: BOOK,
    }),
  ),
  lift('redirect-no-direction', () =>
    buildRedirectRequest({
      caseTitle: 'Wirecard',
      brief: STILL,
      reason: 'google: SAFETY',
      direction: null,
    }),
  ),
  // Sets and photographed names are read for a still only: a stock brief ignores them.
  lift('rebrief-stock', () =>
    buildRebriefRequest({
      caseTitle: 'Wirecard',
      brief: STOCK,
      guidance: 'Something less empty, more people.',
      direction: BOOK,
      photographed: ['Markus Braun'],
      sets: SETS,
    }),
  ),
  lift('rebrief-archival', () =>
    buildRebriefRequest({ caseTitle: 'Wirecard', brief: ARCHIVAL, direction: null }),
  ),
  lift('rebrief-still-minimal', () =>
    buildRebriefRequest({ caseTitle: 'Wirecard', brief: STILL, direction: null }),
  ),
  lift('rebrief-still-no-sets', () =>
    buildRebriefRequest({
      caseTitle: 'Wirecard',
      brief: STILL,
      guidance: 'Markus Braun walking out of the building.',
      direction: BOOK,
      photographed: ['Markus Braun'],
    }),
  ),
  lift('rebrief-still-sets', () =>
    buildRebriefRequest({
      caseTitle: 'Wirecard',
      brief: STILL,
      guidance: 'Markus Braun in the boardroom.',
      direction: BOOK,
      photographed: ['Markus Braun', ' '],
      sets: SETS,
    }),
  ),
  lift('retype-chart-from-still', () =>
    buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: STILL,
      targetType: 'chart',
      claims: CLAIMS_FOUR,
    }),
  ),
  lift('retype-chart-different', () =>
    buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: CHART,
      targetType: 'chart',
      claims: CLAIMS_FOUR,
      guidance: 'Show the whole decade, not just the collapse.',
    }),
  ),
  lift('retype-map-from-still', () =>
    buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: STILL,
      targetType: 'map',
      claims: CLAIMS,
    }),
  ),
  lift('retype-graphic-from-still', () =>
    buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: STILL,
      targetType: 'graphic',
      claims: CLAIMS,
    }),
  ),
  lift('retype-graphic-logos-steer', () =>
    buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: STILL,
      targetType: 'graphic',
      claims: CLAIMS,
      logos: ['Wirecard AG', ' '],
      guidance: 'A timeline of the nine days.',
    }),
  ),
  lift('cast-identity-one-photo', () =>
    buildCastIdentityRequest({
      name: 'Markus Braun',
      role: 'chief executive of Wirecard',
      photos: [{ mimeType: 'image/jpeg', data: 'QUJD' }],
    }),
  ),
  lift('cast-identity-two-photos', () =>
    buildCastIdentityRequest({
      name: 'Markus Braun',
      role: 'chief executive of Wirecard',
      photos: [
        { mimeType: 'image/jpeg', data: 'QUJD' },
        { mimeType: 'image/png', data: 'REVG' },
      ],
    }),
  ),
]

// ---------------------------------------------------------------------------
// Graphics
// ---------------------------------------------------------------------------

const graphicInput = (over: Partial<GraphicDesignInput> = {}): GraphicDesignInput => ({
  caseTitle: 'Wirecard',
  claims: CLAIMS_FOUR,
  logos: ['Wirecard AG'],
  chapterTitle: 'Nine days',
  coversText: 'The share price fell from 104.5 euros to 1.28 euros.',
  paragraphText:
    'In June the share price fell from 104.5 euros to 1.28 euros. Nobody could stop it.',
  durationMs: 6000,
  words: [
    { text: 'The', offsetMs: 0 },
    { text: 'share', offsetMs: 300 },
    { text: 'price', offsetMs: 700 },
    { text: 'fell', offsetMs: 1100 },
  ],
  wordsEstimated: false,
  intent: 'The fall from 104.5 to 1.28 euros in nine days is the story.',
  intentRefs: [4],
  ...over,
})

const CHART_DATA: NonNullable<GraphicDesignInput['data']> = {
  series: [
    {
      label: 'Share price',
      unit: 'EUR',
      points: [
        { x: '2018', y: 104.5 },
        { x: '2020', y: 1.28 },
      ],
    },
  ],
  takeaway: 'The fall',
  annotations: [{ atX: '2020', text: 'Insolvency' }],
}

const graphicsCases: LiftCase[] = [
  lift('graphics-graphic-minimal', () =>
    buildGraphicRequest(graphicInput({ logos: [], intentRefs: [] })),
  ),
  lift('graphics-graphic-logos-estimated-words', () =>
    buildGraphicRequest(graphicInput({ logos: ['Wirecard AG', ' '], wordsEstimated: true })),
  ),
  lift('graphics-chart-data', () => buildGraphicRequest(graphicInput({ data: CHART_DATA }))),
  lift('graphics-redesign', () =>
    buildGraphicRequest(
      graphicInput({
        current: {
          title: 'The fall',
          source: 'function Graphic(props) {\n  return null\n}',
          motion: 1,
        },
        guidance: 'Slower, and bigger type.',
      }),
    ),
  ),
  lift('graphics-redesign-pre-token', () =>
    buildGraphicRequest(
      graphicInput({
        current: { title: 'The fall', source: 'function Graphic(props) {\n  return null\n}' },
      }),
    ),
  ),
  lift('graphics-retry-after-refusal', () =>
    buildGraphicRequest(
      graphicInput({ rejection: 'the source used Easing, which the scan refuses' }),
    ),
  ),
  // One case per stored exemplar: the slot message carries the technique's
  // own design, chart techniques with their data.
  ...exemplars().map((entry) =>
    lift(`graphics-exemplar-${entry.technique}`, () => {
      const exemplar = exemplarFor(entry.technique)
      if (!exemplar) throw new Error(`No stored design for ${entry.technique}`)
      return buildGraphicRequest(
        graphicInput({
          durationMs: entry.slot.durationMs,
          words: entry.slot.words.map((word) => ({ text: word.text, offsetMs: word.atMs })),
          intent: entry.slot.intent,
          ...(entry.slot.data ? { data: entry.slot.data } : {}),
          exemplar,
        }),
      )
    }),
  ),
]

// ---------------------------------------------------------------------------
// Dossier
// ---------------------------------------------------------------------------

const CORPUS =
  '[D1] reporting · Financial Times · 2020 · https://www.ft.com/x\nText of the article.'

const CASE_BARE = {
  title: 'Wirecard',
  category: 'collapse',
  angle: null,
  demandNotes: null,
}
const CASE_FULL = {
  title: 'Wirecard: the missing billion',
  category: 'collapse',
  angle: 'The auditors, not the traders.',
  demandNotes: 'Viewers ask what happened to Marsalek.',
  subject: 'Wirecard',
  people: ['Markus Braun', 'Jan Marsalek'],
}

const DOSSIER_BRIEF: CaseBrief = {
  currentStatus: {
    asOf: '2024-01',
    text: 'Braun is on trial in Munich; Marsalek is still at large.',
  },
  summary:
    'A payments company reported 1.9 billion euros it did not have, and the people paid to check stopped asking.',
  turningPoint: 'The June 2020 admission that the money could not be found.',
  cast: [
    {
      name: 'Markus Braun',
      role: 'chief executive',
      wanted: 'To make every quarter look like growth.',
      scene: { doc: 1, quote: 'Braun told investors the cash was safe' },
    },
  ],
  toldAlready: [{ beat: 'The short seller attack of 2016.', doc: 1, quote: 'inflated' }],
  openQuestions: [
    'What did the board know in 2018?',
    'Who signed off the trust accounts?',
    'Where is Jan Marsalek now?',
  ],
}

const DOSSIER_SCENES: Scene[] = [
  {
    when: 'June 2020',
    who: 'Markus Braun',
    what: 'Resigned as chief executive after the auditors could not find the money.',
    why: 'The first public crack in the story.',
    doc: 1,
    quote: 'Braun resigned',
  },
]

const dossierCases: LiftCase[] = [
  liftAware('dossier-brief-bare', (bible) => buildBriefRequest(CASE_BARE, CORPUS, bible)),
  liftAware('dossier-brief-full-case', (bible) => buildBriefRequest(CASE_FULL, CORPUS, bible)),
  liftAware('dossier-scenes', (bible) =>
    buildScenesRequest(CASE_FULL, CORPUS, DOSSIER_BRIEF, bible),
  ),
  liftAware('dossier-claims-single-part', (bible) =>
    buildClaimsRequest(
      CASE_FULL,
      CORPUS,
      DOSSIER_BRIEF,
      DOSSIER_SCENES,
      {
        index: 1,
        of: 1,
        from: 1,
        to: 24,
      },
      bible,
    ),
  ),
  liftAware('dossier-claims-part', (bible) =>
    buildClaimsRequest(
      CASE_FULL,
      CORPUS,
      DOSSIER_BRIEF,
      DOSSIER_SCENES,
      {
        index: 2,
        of: 2,
        from: 13,
        to: 24,
      },
      bible,
    ),
  ),
  liftAware('dossier-answers-single-part', (bible) =>
    buildAnswersRequest(
      CASE_FULL,
      CORPUS,
      DOSSIER_BRIEF,
      DOSSIER_SCENES,
      {
        index: 1,
        of: 1,
        from: 1,
        to: 3,
      },
      bible,
    ),
  ),
  liftAware('dossier-answers-part', (bible) =>
    buildAnswersRequest(
      CASE_FULL,
      CORPUS,
      DOSSIER_BRIEF,
      DOSSIER_SCENES,
      {
        index: 2,
        of: 2,
        from: 3,
        to: 3,
      },
      bible,
    ),
  ),
]

// ---------------------------------------------------------------------------
// Subject, scoring and digest
// ---------------------------------------------------------------------------

const CANDIDATES: SlotCandidate[] = [
  {
    id: 'a1',
    provider: 'pexels',
    kind: 'image',
    sourceUrl: 'https://images.pexels.com/a1.jpg',
    licence: 'Pexels License',
    summary: 'Empty office with rows of desks at dusk',
    width: 5184,
    height: 3456,
  },
  {
    id: 'b2',
    provider: 'pixabay',
    kind: 'video',
    sourceUrl: 'https://cdn.pixabay.com/b2.mp4',
    licence: 'Pixabay Content License',
    durationMs: 16000,
  },
]

const DIGEST_LINES: DigestLine[] = [
  {
    label: 'The Wirecard collapse',
    targetType: 'master',
    views: 48210,
    viewsDelta: 5120,
    avgViewDurationSec: 412,
    topSource: 'YouTube search',
    worstDropPct: 18,
  },
  {
    label: 'Nine days (Short)',
    targetType: 'short',
    views: null,
    viewsDelta: null,
    avgViewDurationSec: null,
    topSource: null,
    worstDropPct: null,
  },
]

const otherCases: LiftCase[] = [
  liftAware('subject-name-with-angle', (bible) =>
    buildNameSubjectRequest({
      bible,
      title: 'Wirecard and the missing billion',
      angle: 'The auditor sign-offs are the story.',
      category: 'con',
    }),
  ),
  liftAware('subject-name-no-angle', (bible) =>
    buildNameSubjectRequest({ bible, title: 'Enron', angle: null, category: 'collapse' }),
  ),
  liftAware('subject-name-blank-angle', (bible) =>
    buildNameSubjectRequest({ bible, title: 'Enron', angle: '   ', category: 'collapse' }),
  ),
  lift('scoring-stock-criteria', () =>
    buildScoringRequest({ brief: STOCK, candidates: CANDIDATES }),
  ),
  lift('scoring-stock-no-criteria', () =>
    buildScoringRequest({ brief: { ...STOCK, rejectionCriteria: [] }, candidates: CANDIDATES }),
  ),
  lift('scoring-archival-era', () =>
    buildScoringRequest({ brief: ARCHIVAL, candidates: CANDIDATES }),
  ),
  lift('scoring-archival-no-era', () => {
    const { eraRange: _eraRange, ...rest } = ARCHIVAL
    return buildScoringRequest({ brief: rest, candidates: CANDIDATES.slice(0, 1) })
  }),
  lift('digest-full', () => buildDigestRequest({ weekOf: '2026-10-26', lines: DIGEST_LINES })),
  lift('digest-no-lines', () => buildDigestRequest({ weekOf: '2026-10-26', lines: [] })),
]

export const LIFT_CASES: readonly LiftCase[] = [
  ...metadataCases,
  ...shotListCases,
  ...scriptCases,
  ...directionCases,
  ...graphicsCases,
  ...dossierCases,
  ...otherCases,
]
