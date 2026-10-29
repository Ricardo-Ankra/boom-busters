import type { ChannelBible } from '@boom-busters/schemas'

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
    'graphics-worked-beat':
      'Example 1, a text-only beat. The slot is 5.0 s; its words are "Only" 0.0 s, "four" 0.4 s, "in" 0.8 s, "ten" 1.1 s, "volunteers" 1.4 s, "refused." 2.4 s. Claim 2 reads "Four in ten volunteers refused to continue the task." The answer is {"title": "Four in ten refused", "facts": [{"text": "Four in ten", "claim": 2}], "source": this component as a JSON string}:\n\n// Kinetic type: the line builds word by word as it is spoken, the figure\n// springs in on "Four in ten" with the hero preset, and the finished frame\n// holds to the end.\n// Every length and every curve is a token; positions follow the narration.\nconst FIGURE_AT_MS = 800\n\n// A helper, called directly: an arrival, 0 to 1 over motion.ms.enter from atMs, held at 1.\nfunction arrive(frame, fps, atMs) {\n  return Remotion.interpolate(\n    frame, [motion.frames(atMs, fps), motion.frames(atMs + motion.ms.enter, fps)], [0, 1],\n    { easing: motion.ease.enter, extrapolateLeft: \'clamp\', extrapolateRight: \'clamp\' },\n  )\n}\n\nfunction Graphic(props) {\n  const frame = Remotion.useCurrentFrame()\n  const { width, height, fps } = Remotion.useVideoConfig()\n  const { colors, fonts } = props.brand\n  const inset = props.safeArea\n  const unit = Math.min(width, height) / 1080\n  const pop = Remotion.spring({\n    frame, fps, delay: motion.frames(FIGURE_AT_MS, fps), config: motion.spring.hero,\n  })\n  const closing = arrive(frame, fps, 2400)\n\n  return (\n    <Remotion.AbsoluteFill\n      style={{\n        paddingTop: inset.top, paddingRight: inset.right,\n        paddingBottom: inset.bottom, paddingLeft: inset.left,\n        justifyContent: \'center\', gap: 28 * unit,\n      }}\n    >\n      <div\n        style={{\n          fontFamily: fonts.numbers, fontSize: 200 * unit, lineHeight: 1,\n          color: colors.accent, opacity: Math.min(1, pop),\n          transform: \'scale(\' + (motion.scale.enter + (1 - motion.scale.enter) * pop) + \')\',\n        }}\n      >\n        Four in ten\n      </div>\n      <div\n        style={{\n          fontFamily: fonts.title, fontSize: 56 * unit, color: colors.textPrimary,\n          opacity: closing, transform: \'translateY(\' + (1 - closing) * motion.px.rise * unit + \'px)\',\n        }}\n      >\n        refused to continue.\n      </div>\n    </Remotion.AbsoluteFill>\n  )\n}',
    'graphics-worked-chart':
      'Example 2, a chart slot. The slot is 6.0 s; "2018" is said at 1.0 s, "2019" at 2.0 s and "2020" at 3.0 s. Its data is\n{"series":[{"label":"Volunteers who refused","unit":"%","points":[{"x":"2018","y":10},{"x":"2019","y":25},{"x":"2020","y":40}]}],"takeaway":"Refusals rose every year","annotations":[{"atX":"2020","text":"Study halted"}]}\nClaims 5 to 7 hold the three years\' figures. The answer is {"title": "Refusals, year by year", "facts": [{"text": "2020", "claim": 7}, {"text": "40", "claim": 7}], "source": this component as a JSON string}. The facts cite the point the story lands on; the other points\' digits come off props.data and need no entry:\n\n// A chart from props.data: one bar per point draws on as its year is spoken,\n// the annotation lands on the last bar, and the finished chart holds to the end.\n// Every length and every curve is a token; positions follow the narration.\nfunction spokenAt(point, index, words) {\n  const said = words.find((word) => word.text.indexOf(point.x) === 0)\n  return said ? said.atMs : 1000 * (index + 1)\n}\n\nfunction Graphic(props) {\n  const frame = Remotion.useCurrentFrame()\n  const { width, height, fps } = Remotion.useVideoConfig()\n  const { colors, fonts } = props.brand\n  const inset = props.safeArea\n  const unit = Math.min(width, height) / 1080\n  const points = props.data.series[0].points\n  const top = Math.max(...points.map((point) => point.y))\n\n  return (\n    <Remotion.AbsoluteFill\n      style={{\n        paddingTop: inset.top, paddingRight: inset.right,\n        paddingBottom: inset.bottom, paddingLeft: inset.left,\n        flexDirection: \'row\', alignItems: \'flex-end\', gap: 24 * unit,\n      }}\n    >\n      {points.map((point, index) => {\n        const at = spokenAt(point, index, props.words)\n        const grow = Remotion.interpolate(\n          frame, [motion.frames(at, fps), motion.frames(at + motion.ms.draw, fps)], [0, 1],\n          { easing: motion.ease.enter, extrapolateLeft: \'clamp\', extrapolateRight: \'clamp\' },\n        )\n        return (\n          <div key={point.x} style={{ flex: 1, textAlign: \'center\' }}>\n            <div\n              style={{\n                width: \'60%\', margin: \'0 auto\', backgroundColor: colors.chartSeries[0],\n                height: (point.y / top) * grow * 0.4 * height,\n              }}\n            />\n            <div style={{ fontFamily: fonts.numbers, fontSize: 34 * unit, color: colors.textPrimary }}>\n              {point.x}\n            </div>\n          </div>\n        )\n      })}\n    </Remotion.AbsoluteFill>\n  )\n}',
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
  keywordContext: 'psychology',
  channelTags: [],
  titleStyle: 'Curious, plain, specific',
  ctaLine: 'The full story is on the channel',
  disclaimer: 'This film is for general interest and is not medical or clinical advice.',
  youtubeCategoryId: null,
  auditionLine:
    'In the autumn of 1961, a researcher asked ordinary volunteers to keep going when every instinct said stop. Four in ten refused.',
  caseCategories: [
    { key: 'experiment', label: 'Experiment' },
    { key: 'bias', label: 'Bias' },
    { key: 'replication', label: 'Replication' },
  ],
  scriptRulesMd: '',
  directionRulesMd: '',
}
