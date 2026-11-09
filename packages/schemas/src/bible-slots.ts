import type { ChannelBible } from './channels'

/**
 * One worked example a prompt takes from the channel's bible. The slot
 * registry is the list of every such place; a channel's bible carries one
 * entry per slot, and a bible with a slot unfilled is incomplete.
 */
export interface ExampleSlot {
  /** Kebab-case, prefixed with its source: `script-`, `direction-` and so on. */
  id: string
  /** A short human name for the slot, shown in the Bible tab. */
  title: string
  /** Where the prompt that takes it lives. */
  source: string
  /** What the example is there to teach the model. */
  teaches: string
  kind: 'line' | 'passage'
  maxLength: number
}

/**
 * Slots that left the registry. Saved versions keep the slot ids they were
 * stamped with, so a stored bible may still hold these keys; nothing reads them.
 */
export const RETIRED_SLOT_IDS = ['graphics-worked-beat', 'graphics-worked-chart'] as const

/** The slots the lifted prompts read, in the order of the tasks that swap them. */
export const EXAMPLE_SLOTS: readonly ExampleSlot[] = [
  {
    id: 'script-channel-subject',
    title: 'What the channel is about',
    source: 'script.ts',
    teaches:
      'The kinds of story the channel tells, as a plain phrase that follows "a documentary channel about".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-elegant-variation',
    title: 'Stand-in names to avoid',
    source: 'script.ts',
    teaches:
      'Three vague stand-in phrases for the one subject, each in quotes and separated by commas, that a narrator must not rotate between.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'script-storyline-examples',
    title: 'Storylines a film runs in parallel',
    source: 'script.ts',
    teaches: 'Three storylines a film of this kind might run in parallel, as a comma list.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-subject-with-article',
    title: 'One subject, with its article',
    source: 'script-craft.md',
    teaches:
      'One instance of the channel\'s subject with its article ("a company"), as it reads after "a person," and before "or a figure".',
    kind: 'line',
    maxLength: 60,
  },
  {
    id: 'script-close-hedge',
    title: 'How the ending is qualified',
    source: 'script-craft.md',
    teaches: "How the film's closing answer is qualified where the record is uncertain.",
    kind: 'line',
    maxLength: 120,
  },
  {
    id: 'script-opening-collapse',
    title: 'What the opening makes the viewer feel',
    source: 'script-craft.md',
    teaches:
      'What size the viewer must feel before the mechanics are explained, as a noun phrase after "the size of".',
    kind: 'line',
    maxLength: 120,
  },
  {
    id: 'script-concrete-figure',
    title: 'A concrete figure, not a vague phrase',
    source: 'script-craft.md',
    teaches:
      'A concrete quantity and the vague phrase it replaces, in the form "specific figure", never "vague phrase".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-implicit-question',
    title: 'A question raised without asking it',
    source: 'script-craft.md',
    teaches: 'Two short sentences that raise a question without asking it.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-foreshadow',
    title: 'A foreshadowing line',
    source: 'script-craft.md',
    teaches: 'One legitimate foreshadowing line that points at a later, claim-supported fact.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-middle-turn',
    title: 'Who the middle turn reaches',
    source: 'script-craft.md',
    teaches: "Who the middle turn's stakes reach beyond the usual victims.",
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-legal-care',
    title: 'How legal care is carried',
    source: 'script-craft.md',
    teaches:
      'How caution is carried inline, which caveat sentences are never written, and the one plain sentence the film may spend. Keep the clause "Never narrate the caveat as a sentence of its own:" word for word; it is the craft rule between the two example runs.',
    kind: 'passage',
    maxLength: 1000,
  },
  {
    id: 'dossier-channel-subject',
    title: 'What the researcher looks for',
    source: 'dossier-profiles.ts',
    teaches: 'The kinds of story the channel researches, after "You research".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'dossier-wanted-example',
    title: 'What a person in the story wanted',
    source: 'dossier.ts',
    teaches: 'What a person in a story wanted, in one sentence, not a job title.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'dossier-scene-examples',
    title: 'Moments a film can show',
    source: 'dossier.ts',
    teaches: 'A comma list of moments a documentary can show, each a thing said or done at a time.',
    kind: 'line',
    maxLength: 400,
  },
  {
    id: 'dossier-claims-focus',
    title: 'The facts to pull out',
    source: 'dossier.ts',
    teaches: 'The three things to extract as facts, as a comma list after "it:".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'direction-abstract-example',
    title: 'An abstract line, staged concretely',
    source: 'direction-craft.md',
    teaches:
      'An abstract narration sentence, in quotes, and the concrete staging of its people that answers it.',
    kind: 'passage',
    maxLength: 600,
  },
  {
    id: 'direction-subject-marks',
    title: "The subject's own logos and signs",
    source: 'direction-craft.md',
    teaches:
      "How the subject's own marks and signage may appear in frame, and why a generated wordmark is never asked for.",
    kind: 'passage',
    maxLength: 600,
  },
  {
    id: 'direction-background-people',
    title: 'Who fills the background',
    source: 'direction-craft.md',
    teaches:
      "The kind of unnamed person who fills the background of this channel's films, in the plural.",
    kind: 'line',
    maxLength: 60,
  },
  {
    id: 'direction-identity-example',
    title: 'A name and role',
    source: 'direction-craft.md',
    teaches: 'A full name and role as an identity string begins.',
    kind: 'line',
    maxLength: 120,
  },
  {
    id: 'direction-worked-example',
    title: 'A right prompt and the mistake',
    source: 'direction-craft.md',
    teaches:
      'A right prompt for a photographed person, and the physical description that is the mistake, each in quotes. Keep the words " is right; adding " between them; the sentence that follows ("after it is the mistake") is craft.',
    kind: 'passage',
    maxLength: 500,
  },
  {
    id: 'direction-never-acts',
    title: 'Acts a real person is never shown doing',
    source: 'direction-craft.md',
    teaches:
      'Acts a film must never show a named person committing, as a comma list of "no ..." phrases.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'direction-guardrail-rule',
    title: 'How a guardrail is written',
    source: 'direction-craft.md',
    teaches:
      'The example guardrail line, the ordinary settings it never fences a person from, the example phrase an image model would misread, and the example negative-prompt nouns, from the first example to the last. The sentences between the examples ("The guardrail governs what the planner writes; it is never pasted into the image prompt. Image models read negation as suggestion, so") are craft: keep them word for word.',
    kind: 'passage',
    maxLength: 900,
  },
  {
    id: 'direction-preflight-settings',
    title: 'Settings a guardrail never rules out',
    source: 'direction-craft.md',
    teaches:
      'Ordinary settings a guardrail must not keep a principal out of, as a comma list with articles.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'direction-premise',
    title: 'What each film is about',
    source: 'direction.ts',
    teaches: 'What each film is about, with its article, after "a documentary about".',
    kind: 'line',
    maxLength: 60,
  },
  {
    id: 'direction-motif-generic',
    title: 'The subject in general terms',
    source: 'direction.ts',
    teaches: 'The generic form of the channel\'s subject, after "could belong to".',
    kind: 'line',
    maxLength: 60,
  },
  {
    id: 'direction-never-show-examples',
    title: 'Dishonesties never shown',
    source: 'direction.ts',
    teaches: 'Factual dishonesties a film must never show, as a comma list.',
    kind: 'line',
    maxLength: 400,
  },
  {
    id: 'direction-guardrail-book',
    title: 'What a guardrail lists',
    source: 'direction.ts',
    teaches:
      "The specific acts a principal's guardrail lists, and the ordinary settings it must never keep them from.",
    kind: 'line',
    maxLength: 500,
  },
  {
    id: 'shotlist-two-units',
    title: 'Two measures that need two axes',
    source: 'shotlist.ts',
    teaches:
      'Two measures in different units that need two axes, in the form "a X in A against a Y in B".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'shotlist-headline-cue',
    title: 'How the narrator cites a publication',
    source: 'shotlist.ts',
    teaches: 'Three ways a narrator cites a publication, each in quotes.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'shotlist-guardrail-negation',
    title: 'A guardrail phrase an image model misreads',
    source: 'shotlist.ts',
    teaches: 'A guardrail phrase in quotes and why an image model reads it as a request.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'shotlist-map-route-example',
    title: 'Routes a story moves along',
    source: 'retype.ts',
    teaches: 'Two real routes a story of this kind moves along between places, as a comma list.',
    kind: 'line',
    maxLength: 120,
  },
  {
    id: 'direction-default-guardrail',
    title: 'The starting guardrail',
    source: 'cast-identity.ts',
    teaches: "The default starting guardrail's first clauses, separated by a semicolon.",
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'direction-cast-settings',
    title: 'Settings a cast member keeps',
    source: 'cast-identity.ts',
    teaches:
      "Ordinary settings a cast member's guardrail must not exclude, with the line break the source has.",
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'metadata-channel-subject',
    title: 'What the channel publishes',
    source: 'metadata.ts',
    teaches: 'The kinds of story the channel publishes, after "a documentary channel about".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'metadata-title-mechanisms',
    title: 'Ways a title hooks',
    source: 'metadata.ts',
    teaches: 'The ways a title can hook, as a comma list with one quoted example.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'metadata-description-opening',
    title: 'What a description opens with',
    source: 'metadata.ts',
    teaches: 'What the description\'s first sentence names, after "names".',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'metadata-tag-kinds',
    title: 'Kinds of search tag',
    source: 'metadata.ts',
    teaches: 'The kinds of search tag to list, as a comma list with articles.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'digest-channel-subject',
    title: 'The subject, for research digests',
    source: 'digest.ts',
    teaches: 'The channel\'s subject, after "channel about".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-read-aloud-numbers',
    title: 'Numbers as they are read aloud',
    source: 'script.ts',
    teaches: 'A written figure and its spoken form, and an abbreviation that is read as written.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'script-hedge-kind',
    title: 'The kind of hedges the rules require',
    source: 'script-craft.md',
    teaches: 'What kind of hedges the hard rules require, as a noun phrase before "hedges".',
    kind: 'line',
    maxLength: 60,
  },
  {
    id: 'direction-era-objects',
    title: 'Objects of the period',
    source: 'direction-craft.md',
    teaches: 'Period-correct objects named specifically, as a comma list.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'direction-emotion-body',
    title: 'An emotion shown through the body',
    source: 'direction-craft.md',
    teaches: 'An emotion named without a body, and the same beat written with one, each in quotes.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'direction-recreated-scenes',
    title: 'Where re-created scenes are set',
    source: 'direction-craft.md',
    teaches: 'Settings where a re-created scene of a principal may be set, as a comma list.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'dossier-status-subject',
    title: 'Who the status note follows',
    source: 'dossier.ts',
    teaches: 'Who and what the current-status note says things stand with, after "happened to".',
    kind: 'line',
    maxLength: 120,
  },
]

export const EXAMPLE_SLOT_IDS: readonly string[] = EXAMPLE_SLOTS.map((slot) => slot.id)

export const MAX_EXAMPLE_SLOTS = 46

/** The pipeline stage a slot belongs to, in the order the Bible tab lists them. */
export type SlotStage = 'script' | 'research' | 'direction' | 'shotlist' | 'metadata'

export const SLOT_STAGES: readonly SlotStage[] = [
  'script',
  'research',
  'direction',
  'shotlist',
  'metadata',
]

export const SLOT_STAGE_LABELS: Record<SlotStage, string> = {
  script: 'Script',
  research: 'Research',
  direction: 'Direction',
  shotlist: 'Shot list',
  metadata: 'Titles and descriptions',
}

/** The stage a slot belongs to, read from its id prefix. */
export function slotStage(slot: ExampleSlot): SlotStage {
  const { id } = slot
  if (id.startsWith('script-')) return 'script'
  if (id.startsWith('dossier-') || id.startsWith('digest-')) return 'research'
  if (id.startsWith('direction-')) return 'direction'
  if (id.startsWith('shotlist-')) return 'shotlist'
  if (id.startsWith('metadata-')) return 'metadata'
  throw new Error(`Bible slot "${id}" has no known stage prefix`)
}

/** How many registered slots have non-blank text. Keys that are not slots do not count. */
export function examplesWritten(examples: Record<string, string>): number {
  return EXAMPLE_SLOTS.filter((slot) => (examples[slot.id] ?? '').trim() !== '').length
}

/** A bible together with the slot ids it is to be judged against. */
export interface BibleInUse {
  bible: ChannelBible
  slotIds: readonly string[]
}
