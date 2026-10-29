import type { ChannelBible } from './channels'

/**
 * One worked example a prompt takes from the channel's bible. The slot
 * registry is the list of every such place; a channel's bible carries one
 * entry per slot, and a bible with a slot unfilled is incomplete.
 */
export interface ExampleSlot {
  /** Kebab-case, prefixed with its source: `script-`, `direction-` and so on. */
  id: string
  /** Where the prompt that takes it lives. */
  source: string
  /** What the example is there to teach the model. */
  teaches: string
  kind: 'line' | 'passage' | 'worked'
  maxLength: number
}

/** The slots the lifted prompts read, in the order of the tasks that swap them. */
export const EXAMPLE_SLOTS: readonly ExampleSlot[] = [
  {
    id: 'script-channel-subject',
    source: 'script.ts',
    teaches:
      'The kinds of story the channel tells, as a plain phrase that follows "a documentary channel about".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-elegant-variation',
    source: 'script.ts',
    teaches:
      'Three vague stand-in phrases for the one subject, each in quotes and separated by commas, that a narrator must not rotate between.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'script-storyline-examples',
    source: 'script.ts',
    teaches: 'Three storylines a film of this kind might run in parallel, as a comma list.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-subject-with-article',
    source: 'script-craft.md',
    teaches:
      'One instance of the channel\'s subject with its article ("a company"), as it reads after "a person," and before "or a figure".',
    kind: 'line',
    maxLength: 60,
  },
  {
    id: 'script-close-hedge',
    source: 'script-craft.md',
    teaches: "How the film's closing answer is qualified where the record is uncertain.",
    kind: 'line',
    maxLength: 120,
  },
  {
    id: 'script-opening-collapse',
    source: 'script-craft.md',
    teaches:
      'What size the viewer must feel before the mechanics are explained, as a noun phrase after "the size of".',
    kind: 'line',
    maxLength: 120,
  },
  {
    id: 'script-concrete-figure',
    source: 'script-craft.md',
    teaches:
      'A concrete quantity and the vague phrase it replaces, in the form "specific figure", never "vague phrase".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-implicit-question',
    source: 'script-craft.md',
    teaches: 'Two short sentences that raise a question without asking it.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-foreshadow',
    source: 'script-craft.md',
    teaches: 'One legitimate foreshadowing line that points at a later, claim-supported fact.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-middle-turn',
    source: 'script-craft.md',
    teaches: "Who the middle turn's stakes reach beyond the usual victims.",
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-legal-care',
    source: 'script-craft.md',
    teaches:
      'How caution is carried inline, which caveat sentences are never written, and the one plain sentence the film may spend. Keep the clause "Never narrate the caveat as a sentence of its own:" word for word; it is the craft rule between the two example runs.',
    kind: 'passage',
    maxLength: 1000,
  },
  {
    id: 'dossier-channel-subject',
    source: 'dossier.ts',
    teaches: 'The kinds of story the channel researches, after "You research".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'dossier-wanted-example',
    source: 'dossier.ts',
    teaches: 'What a person in a story wanted, in one sentence, not a job title.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'dossier-scene-examples',
    source: 'dossier.ts',
    teaches: 'A comma list of moments a documentary can show, each a thing said or done at a time.',
    kind: 'line',
    maxLength: 400,
  },
  {
    id: 'dossier-claims-focus',
    source: 'dossier.ts',
    teaches: 'The three things to extract as facts, as a comma list after "it:".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'direction-abstract-example',
    source: 'direction-craft.md',
    teaches:
      'An abstract narration sentence, in quotes, and the concrete staging of its people that answers it.',
    kind: 'passage',
    maxLength: 600,
  },
  {
    id: 'direction-subject-marks',
    source: 'direction-craft.md',
    teaches:
      "How the subject's own marks and signage may appear in frame, and why a generated wordmark is never asked for.",
    kind: 'passage',
    maxLength: 600,
  },
  {
    id: 'direction-background-people',
    source: 'direction-craft.md',
    teaches:
      "The kind of unnamed person who fills the background of this channel's films, in the plural.",
    kind: 'line',
    maxLength: 60,
  },
  {
    id: 'direction-identity-example',
    source: 'direction-craft.md',
    teaches: 'A full name and role as an identity string begins.',
    kind: 'line',
    maxLength: 120,
  },
  {
    id: 'direction-worked-example',
    source: 'direction-craft.md',
    teaches:
      'A right prompt for a photographed person, and the physical description that is the mistake, each in quotes. Keep the words " is right; adding " between them; the sentence that follows ("after it is the mistake") is craft.',
    kind: 'worked',
    maxLength: 500,
  },
  {
    id: 'direction-never-acts',
    source: 'direction-craft.md',
    teaches:
      'Acts a film must never show a named person committing, as a comma list of "no ..." phrases.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'direction-guardrail-rule',
    source: 'direction-craft.md',
    teaches:
      'The example guardrail line, the ordinary settings it never fences a person from, the example phrase an image model would misread, and the example negative-prompt nouns, from the first example to the last. The sentences between the examples ("The guardrail governs what the planner writes; it is never pasted into the image prompt. Image models read negation as suggestion, so") are craft: keep them word for word.',
    kind: 'passage',
    maxLength: 900,
  },
  {
    id: 'direction-preflight-settings',
    source: 'direction-craft.md',
    teaches:
      'Ordinary settings a guardrail must not keep a principal out of, as a comma list with articles.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'direction-premise',
    source: 'direction.ts',
    teaches: 'What each film is about, with its article, after "a documentary about".',
    kind: 'line',
    maxLength: 60,
  },
  {
    id: 'direction-motif-generic',
    source: 'direction.ts',
    teaches: 'The generic form of the channel\'s subject, after "could belong to".',
    kind: 'line',
    maxLength: 60,
  },
  {
    id: 'direction-never-show-examples',
    source: 'direction.ts',
    teaches: 'Factual dishonesties a film must never show, as a comma list.',
    kind: 'line',
    maxLength: 400,
  },
  {
    id: 'direction-guardrail-book',
    source: 'direction.ts',
    teaches:
      "The specific acts a principal's guardrail lists, and the ordinary settings it must never keep them from.",
    kind: 'line',
    maxLength: 500,
  },
  {
    id: 'shotlist-two-units',
    source: 'shotlist.ts',
    teaches:
      'Two measures in different units that need two axes, in the form "a X in A against a Y in B".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'shotlist-headline-cue',
    source: 'shotlist.ts',
    teaches: 'Three ways a narrator cites a publication, each in quotes.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'shotlist-guardrail-negation',
    source: 'shotlist.ts',
    teaches: 'A guardrail phrase in quotes and why an image model reads it as a request.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'shotlist-map-route-example',
    source: 'retype.ts',
    teaches: 'Two real routes a story of this kind moves along between places, as a comma list.',
    kind: 'line',
    maxLength: 120,
  },
  {
    id: 'direction-default-guardrail',
    source: 'cast-identity.ts',
    teaches: "The default starting guardrail's first clauses, separated by a semicolon.",
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'direction-cast-settings',
    source: 'cast-identity.ts',
    teaches:
      "Ordinary settings a cast member's guardrail must not exclude, with the line break the source has.",
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'graphics-worked-beat',
    source: 'graphics.ts',
    teaches:
      'A full worked example of a text-only graphic beat: the slot and its words, the claim, the answer, then the component.',
    kind: 'worked',
    maxLength: 6000,
  },
  {
    id: 'graphics-worked-chart',
    source: 'graphics.ts',
    teaches: 'A full worked example of a chart slot: timing, data, the answer, then the component.',
    kind: 'worked',
    maxLength: 6000,
  },
  {
    id: 'metadata-channel-subject',
    source: 'metadata.ts',
    teaches: 'The kinds of story the channel publishes, after "a documentary channel about".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'metadata-title-mechanisms',
    source: 'metadata.ts',
    teaches: 'The ways a title can hook, as a comma list with one quoted example.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'metadata-description-opening',
    source: 'metadata.ts',
    teaches: 'What the description\'s first sentence names, after "names".',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'metadata-tag-kinds',
    source: 'metadata.ts',
    teaches: 'The kinds of search tag to list, as a comma list with articles.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'digest-channel-subject',
    source: 'digest.ts',
    teaches: 'The channel\'s subject, after "channel about".',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'script-read-aloud-numbers',
    source: 'script.ts',
    teaches: 'A written figure and its spoken form, and an abbreviation that is read as written.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'script-hedge-kind',
    source: 'script-craft.md',
    teaches: 'What kind of hedges the hard rules require, as a noun phrase before "hedges".',
    kind: 'line',
    maxLength: 60,
  },
  {
    id: 'direction-era-objects',
    source: 'direction-craft.md',
    teaches: 'Period-correct objects named specifically, as a comma list.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'direction-emotion-body',
    source: 'direction-craft.md',
    teaches: 'An emotion named without a body, and the same beat written with one, each in quotes.',
    kind: 'line',
    maxLength: 200,
  },
  {
    id: 'direction-recreated-scenes',
    source: 'direction-craft.md',
    teaches: 'Settings where a re-created scene of a principal may be set, as a comma list.',
    kind: 'line',
    maxLength: 300,
  },
  {
    id: 'dossier-status-subject',
    source: 'dossier.ts',
    teaches: 'Who and what the current-status note says things stand with, after "happened to".',
    kind: 'line',
    maxLength: 120,
  },
]

export const EXAMPLE_SLOT_IDS: readonly string[] = EXAMPLE_SLOTS.map((slot) => slot.id)

export const MAX_EXAMPLE_SLOTS = 46

/** A bible together with the slot ids it is to be judged against. */
export interface BibleInUse {
  bible: ChannelBible
  slotIds: readonly string[]
}
