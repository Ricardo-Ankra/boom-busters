import { BIBLE_SECTIONS, defaultFormat, EXAMPLE_SLOTS } from '@boom-busters/schemas'
import type {
  BibleDraftInputs,
  BibleDraftUnit,
  BibleExampleEntry,
  BibleResearchDigest,
  ChannelBible,
  ResearchSource,
} from '@boom-busters/schemas'
import channelVideos from '../vidiq/fixtures/channel_videos.json' with { type: 'json' }
import outliers from '../vidiq/fixtures/outliers.json' with { type: 'json' }
import { parseChannelVideos, parseOutliers } from '../vidiq/shapes'

/** Words that must never appear in a non-finance channel's bible. Matched case-insensitively. */
export const FINANCE_WORDS = [
  'compan',
  'pension',
  'fraud',
  'share price',
  'financial advice',
  'wirecard',
  'stability ai',
  'investor',
  'regulator',
  'bankrupt',
]

/**
 * A complete bible for an imagined psychology channel, used to prove that the
 * prompts carry no Boom & Busters wording once a second channel's bible is
 * read. Every example is written to its slot's `teaches` line.
 */
export const PSYCHOLOGY_TEST_BIBLE: ChannelBible = {
  subject: 'how minds work, from landmark experiments to everyday biases',
  whatACaseIs:
    'A good case has: a published paper or a recorded session, a clear turn where the story changes, and consequences that can be shown rather than described. A bad case is one where the only sources are other videos, or where the interesting part is speculation about what a researcher was thinking.',
  subjectKind: "the idea's common name as the textbooks title it",
  subjectNoun: { singular: 'idea', plural: 'ideas' },
  audience: 'curious adults who like long-form explanations of why people act as they do',
  researchProfile: 'investigation',
  narrationRegister: 'warm, precise, unhurried',
  voiceDos: [],
  voiceDonts: [],
  hedgingRules: `The hard rules:
- Assert nothing the claim list does not support.
- Where a finding is NOT replicated, write "reportedly", "according to" or
  "suggests", and never state it as settled fact.
- Never invent figures, dates, quotes or names.
- Care with the evidence is inline: "suggests", "reportedly", "according to".
  Never a sentence of its own saying that nothing was proven. The one
  exception is the film's single such sentence, where a chapter's
  constraints ask for it.`,
  visualRegister:
    'the quiet science documentary. Warm, patient, photographic realism. The people, in the rooms where it happened: researchers at the bench, volunteers at the table, a lecturer at the lectern, re-created with restraint. Empty rooms, papers and apparatus are punctuation between them, not the film.',
  examples: {
    'script-channel-subject': 'how minds work, from landmark experiments to everyday biases',
    'script-elegant-variation':
      '"the\n  famous experiment", "the infamous study", "the Yale-based project"',
    'script-storyline-examples': 'the experiment, the replication, the public reaction',
    'script-subject-with-article': 'an idea',
    'script-close-hedge': 'hedged where the evidence needs it',
    'script-opening-collapse': 'the size of the finding',
    'script-concrete-figure': '"Four in ten\n  volunteers", never "many participants"',
    'script-implicit-question': '"The volunteers agreed. The result was never repeated."',
    'script-foreshadow': '"That questionnaire would be the\n  last one the lab ever ran"',
    'script-middle-turn': 'the stakes reaching people who are not\n  participants',
    'script-legal-care':
      'Care with the evidence is carried by the inline hedges: reportedly, according to,\n  suggests. Never narrate the caveat as a sentence of its own: no "the science\n  is not settled", no "that is one reading", no "the data show the order\n  of events and nothing more". Once in the whole film, where a listener would\n  otherwise assume the finding is proven, the outline\'s constraints may ask for one plain\n  sentence that it has not been replicated',
    'dossier-channel-subject': 'psychology experiments, biases and the ideas that outlived them',
    'dossier-wanted-example': 'to prove that a quiet room\n  could change a mind',
    'dossier-scene-examples':
      "A lecture, a first volunteer walking in, a debrief,\n  a replication attempt, a retraction, a journal editor's letter landing",
    'dossier-claims-focus': 'what the data showed, who said what, what the numbers show over time',
    'direction-abstract-example':
      '"Pressure to conform and disagreement inside\n  the room" is the volunteers at the table, mid-argument',
    'direction-subject-marks':
      "A real institution's own marks belong in frame when the film is about that\n  institution: the sign above the lab door, the crest on a lab coat, the lanyard\n  on the desk. Name the institution and let the shot hold what is really\n  there.",
    'direction-background-people': 'volunteers',
    'direction-identity-example': 'Ana Ruiz, lead researcher at\n  the Hollis Lab',
    'direction-worked-example':
      '"Ana Ruiz, lead researcher at the Hollis Lab, sitting at a desk" is right; adding "woman in her 40s, short grey hair, round glasses"',
    'direction-never-acts':
      'no\n  data being altered, no hidden camera, no coaching whisper, no locked door',
    'direction-guardrail-rule':
      'never altering data or coaching a volunteer; never in a locked\n  room; never mocked"). It never fences a person away from ordinary\n  settings such as desks, papers, laboratories or lecture halls. The guardrail\n  governs what the planner writes; it is never pasted into the image\n  prompt. Image models read negation as suggestion, so "never in a\n  locked room" in a prompt invites a locked room. Its concrete nouns may become\n  the negative prompt ("no clipboard, no locked door, no hidden camera',
    'direction-preflight-settings': 'a desk, a\n  paper, a laboratory or a seminar',
    'direction-premise': 'a landmark experiment',
    'direction-motif-generic': 'any landmark experiment',
    'direction-never-show-examples':
      'fabricated charts\n  presented as real results, generated images passed off as real\n  photographs, a figure sourced to a paper that does not exist, an invented\n  confession',
    'direction-guardrail-book':
      'specific acts the claims do not establish (altering data, coaching a\n  volunteer, a hidden recording), plus caricature, malice, humiliation. It\n  never keeps them away from desks, papers, laboratories, seminars,\n  interviews or lecterns',
    'shotlist-two-units': 'a sample size in thousands against an\neffect size in decimals',
    'shotlist-headline-cue': '"the journal reported", "the paper found", "when the study came out"',
    'shotlist-guardrail-negation': '"never in a locked room" as a request for a locked room',
    'shotlist-map-route-example':
      "a volunteer's journey from home to the lab, a lab's moves between universities",
    'direction-default-guardrail':
      'never altering data or coaching a volunteer; never in a locked room',
    'direction-cast-settings': 'desks, papers, laboratories or\n  seminars',
    'metadata-channel-subject': 'psychology experiments, biases and ideas',
    'metadata-title-mechanisms':
      'a question, a number, a short test\n  ("Ten minutes"), a contradiction, a consequence',
    'metadata-description-opening': 'the idea, its\n  best-known experiment and what happened',
    'metadata-tag-kinds': 'the\n  idea, the experiment, the people, the findings, the topic',
    'digest-channel-subject': 'psychology and how minds work',
    'script-read-aloud-numbers':
      '"1,900 volunteers", not "1.9K"; "the I Q test" is wrong, "the IQ test"\n  is read correctly',
    'script-hedge-kind': 'evidence hedges',
    'direction-era-objects':
      'reel-to-reel tape recorders, a one-way mirror, punch cards, paper questionnaires',
    'direction-emotion-body':
      '"a\n  nervous volunteer"; "a volunteer, shoulders hunched, both hands flat on the\n  table"',
    'direction-recreated-scenes':
      'a researcher at a desk with\n  papers, in a lecture hall, in a corridor, at a lectern, in a car, in an\n  interview, reading a phone',
    'dossier-status-subject': 'the people and the idea',
  },
  hooks: [],
  openings: [],
  titles: [],
  language: 'en',
  country: 'US',
  channelTags: [],
  channelHashtag: '',
  channelFooter: '',
  formats: [defaultFormat('Psychology')],
  titleStyle: 'Curious, plain, specific',
  ctaLine: 'The full story is on the channel',
  disclaimer: 'This film is for general interest and is not medical or clinical advice.',
  youtubeCategoryId: null,
  auditionLine:
    'In the autumn of 1961, a researcher asked ordinary volunteers to keep going when every instinct said stop. Four in ten refused.',
  caseCategories: [
    { key: 'experiment', label: 'Experiment', keywords: [] },
    { key: 'bias', label: 'Bias', keywords: [] },
    { key: 'replication', label: 'Replication', keywords: [] },
  ],
  scriptRulesMd: '',
  directionRulesMd: '',
}

// ---------------------------------------------------------------------------
// Mock answers for MOCK_PROVIDERS=1: the drafting task and the research digest
// ---------------------------------------------------------------------------

const OWN_CHANNEL = 'Boom & Busters'

function fixtureSources(): ResearchSource[] {
  const others = parseOutliers(outliers).map((v) => ({ ...v, own: false }))
  const own = parseChannelVideos(channelVideos).map((v) => ({ ...v, own: true }))
  return [...others, ...own].map((v) => ({
    videoId: v.videoId,
    channel: v.channel ?? OWN_CHANNEL,
    title: v.title,
    own: v.own,
  }))
}

/** Looks a fixture video up by its id; the mock digest and the mock hooks agree on these. */
function source(videoId: string): ResearchSource {
  const found = fixtureSources().find((s) => s.videoId === videoId)
  if (!found) throw new Error(`no fixture video ${videoId}`)
  return found
}

const GM_VIDEO = 'TZIC1sL9XTk'
const AIWA_VIDEO = 'JH89RGzulEE'
const DOC_VIDEO = 'In8GehBC25c'
const OWN_VIDEO = 'oFynN_TDx0o'

function entry(text: string, note: string, videoIds: string[]): BibleExampleEntry {
  return { text, note, drawnFrom: videoIds.map(source) }
}

/**
 * Mock examples worded apart from Boom & Busters' own, so a mock run on a second
 * channel trips no overlap flag. They replace the psychology bible's text for
 * the slots whose craft wording that bible kept (it must stay as it is: the
 * lift tests read it). Each stays within its slot's limit.
 */
const MOCK_EXAMPLE_REWRITES: Record<string, string> = {
  'direction-guardrail-book':
    'falsified results, a volunteer being coached, a secret recording, and any caricature, malice or humiliation. Everyday rooms stay open to them: lecterns, interviews, seminars, laboratories',
  'direction-guardrail-rule':
    'never falsifying data or coaching a volunteer; never in a locked room; never mocked"). A person is never kept out of everyday places such as lecture halls, laboratories, desks or papers. The guardrail governs what the planner writes; it is never pasted into the image prompt. Image models read negation as suggestion, so "never in a locked room" in a prompt invites a locked room. The concrete nouns it names can seed a negative prompt ("no clipboard, no locked door, no hidden camera',
  'direction-never-show-examples':
    'invented charts dressed up as results, synthetic pictures sold as photographs, a figure credited to a paper nobody wrote, a confession that never happened',
  'direction-recreated-scenes':
    'a researcher bent over papers, a lecture hall, a corridor, someone at a lectern, the back seat of a car, an interview room, a person reading a phone',
  'direction-subject-marks':
    'When a film is about an institution, its own signage may appear in shot: the nameplate by the lab door, a crest on a coat, a lanyard left on a desk. Say which institution, then let the frame hold what was truly there.',
  'dossier-claims-focus':
    'the results as measured, who stated what, and how the figures moved across the years',
  'script-legal-care':
    'Caution lives in the verbs: reportedly, according to, suggests. Never narrate the caveat as a sentence of its own: no "the science is unsettled", no "this is only one view", no "all we can say is what came first". Just once in the film, if a listener might take the finding as proven, the outline may ask for a single plain sentence saying it was never replicated',
}

/** The psychology bible with the three lists a hooks unit asks for. */
const MOCK_BIBLE: ChannelBible = {
  ...PSYCHOLOGY_TEST_BIBLE,
  examples: { ...PSYCHOLOGY_TEST_BIBLE.examples, ...MOCK_EXAMPLE_REWRITES },
  hooks: [
    entry(
      'A volunteer in a quiet room is told to keep going. Nobody is forcing them. So why do most of them stay?',
      'A scene that puts a person in the room before the idea',
      [GM_VIDEO, AIWA_VIDEO],
    ),
    entry(
      'The finding reached the newspapers within a week. The replication took thirty years and said something else.',
      'Two timelines set against each other',
      [DOC_VIDEO],
    ),
  ],
  openings: [
    entry(
      'In the autumn of 1961 a lab on a university campus put an advertisement in the local paper.',
      'A dated, ordinary first fact',
      [DOC_VIDEO],
    ),
    entry(
      'Nobody asked the volunteers what they thought the experiment was for.',
      'An overlooked detail as the way in',
      [GM_VIDEO],
    ),
  ],
  titles: [
    entry('The Experiment That Said Nobody Is Immune to Pressure', 'A claim the film then tests', [
      AIWA_VIDEO,
    ]),
    entry('Why the Famous Study Could Not Be Repeated', 'A question about what followed', [
      OWN_VIDEO,
    ]),
  ],
}

function exampleSlots(unit: BibleDraftUnit) {
  return EXAMPLE_SLOTS.filter((slot) =>
    'slotId' in unit ? slot.id === unit.slotId : 'source' in unit && slot.source === unit.source,
  )
}

/** The mock bible's answer for one unit, shaped as `bibleUnitSchema(unit)` wants it. */
export function mockBibleUnit(unit: BibleDraftUnit): Partial<ChannelBible> {
  if (unit.section === 'examples') {
    const examples: Record<string, string> = {}
    for (const slot of exampleSlots(unit)) examples[slot.id] = MOCK_BIBLE.examples[slot.id] ?? ''
    return { examples }
  }
  const answer: Partial<ChannelBible> = {}
  for (const key of BIBLE_SECTIONS[unit.section]) {
    Object.assign(answer, { [key]: structuredClone(MOCK_BIBLE[key]) })
  }
  return answer
}

/**
 * A fixed digest whose sources are the recorded VidIQ videos, so a mock
 * drafting run has real ids to check an entry's `drawnFrom` against. Its
 * quotes share no eight-word run with the mock hooks, openings or titles.
 */
export function mockResearchDigest(_inputs: BibleDraftInputs): BibleResearchDigest {
  const sources = fixtureSources()
  const videos = parseOutliers(outliers)
    .map((v) => ({ ...v, own: false }))
    .concat(parseChannelVideos(channelVideos).map((v) => ({ ...v, own: true })))
    .map((v) => ({
      videoId: v.videoId,
      channel: v.channel ?? OWN_CHANNEL,
      title: v.title,
      views: v.views,
      own: v.own,
    }))
  return {
    patterns: [
      {
        kind: 'title',
        pattern: 'A large figure, then the thing that vanished',
        quote: 'The $3 Billion Sound Empire That Suddenly Disappeared',
        sources: [source(AIWA_VIDEO), source(GM_VIDEO)],
      },
      {
        kind: 'hook',
        pattern: 'A dated scene that shows the peak before the fall',
        quote: 'In the summer of 1995, one brand completely dominated the global audio market.',
        sources: [source(AIWA_VIDEO)],
      },
      {
        kind: 'opening',
        pattern: 'The first minute names the era and the stakes, then holds the answer back',
        quote: null,
        sources: [source(DOC_VIDEO), source(GM_VIDEO)],
      },
      {
        kind: 'audience',
        pattern: 'Viewers reward long, patient histories that tie one story to a wider cause',
        quote: null,
        sources: sources.slice(0, 3),
      },
    ],
    videos,
  }
}
