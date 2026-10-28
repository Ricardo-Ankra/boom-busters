import type { ChannelBible } from '@boom-busters/schemas'

/** The bible's text fields, in the order the Channel tab shows them. */
export const BIBLE_TEXT_FIELDS = [
  {
    key: 'subject',
    label: 'Subject',
    hint: 'What the channel covers, in a phrase the prompts can finish a sentence with.',
    required: true,
  },
  {
    key: 'whatACaseIs',
    label: 'What a case is',
    hint: 'What makes a story worth a film here, and what rules one out.',
    required: true,
  },
  {
    key: 'subjectKind',
    label: 'How a subject is named',
    hint: 'The name the research looks up, such as the company as Wikipedia titles it.',
    required: true,
  },
  { key: 'audience', label: 'Audience', hint: 'Who watches.', required: true },
  {
    key: 'narrationRegister',
    label: 'Narration register',
    hint: 'How the narrator sounds.',
    required: true,
  },
  {
    key: 'visualRegister',
    label: 'Visual register',
    hint: 'How the film looks, in the terms an image model can follow.',
    required: true,
  },
  {
    key: 'titleStyle',
    label: 'Title style',
    hint: 'How titles are written.',
    required: true,
  },
  {
    key: 'ctaLine',
    label: 'Call to action',
    hint: 'The line the film closes on. Optional.',
    required: false,
  },
  {
    key: 'scriptRulesMd',
    label: 'Script rules',
    hint: 'Extra rules for the writer, in Markdown. Optional.',
    required: false,
  },
  {
    key: 'directionRulesMd',
    label: 'Direction rules',
    hint: 'Extra rules for the director, in Markdown. Optional.',
    required: false,
  },
] as const satisfies readonly {
  key: keyof ChannelBible
  label: string
  hint: string
  required: boolean
}[]

/** The labels of what still stops the bible being complete, in screen order. */
export function missingBibleFields(bible: ChannelBible): string[] {
  const missing: string[] = BIBLE_TEXT_FIELDS.filter(
    (field) => field.required && bible[field.key].trim().length === 0,
  ).map((field) => field.label)
  if (bible.caseCategories.length < 2) missing.push('Case categories (at least two)')
  return missing
}
