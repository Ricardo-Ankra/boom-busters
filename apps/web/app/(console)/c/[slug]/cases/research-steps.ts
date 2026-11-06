// Plain module (no React, no server actions) so server and client code can share the labels.

/** What the researcher is doing, by the step id it reports; an unknown id reads as plain Researching. */
const STEP_LABELS: Record<string, string> = {
  load: 'Starting',
  'keywords-terms': 'Finding search terms',
  'keywords-format': 'Finding search terms for the format',
  'keywords-people': 'Finding what people search for the people',
  'keywords-understand': 'Understanding what searchers want',
  fit: 'Checking the subject fits the channel',
  'keywords-questions': 'Finding the questions people search',
  field: 'Checking who ranks now',
  comments: 'Reading what viewers asked for',
  'comment-themes': 'Reading what viewers asked for',
  niche: 'Testing the angle against the niche',
  outliers: 'Finding the winning videos',
  'outlier-details': 'Reading the winning videos',
  winners: 'Studying the winning titles',
  angles: 'Drafting angle options',
  'rate-angles': 'Ranking the angles',
  'save-brief': 'Saving the brief',
}

/** A repeated step carries its position (`field-1`) or a phase (`niche-wait`); the label is for the family. */
function family(step: string): string {
  return step.replace(/-\d+$/, '').replace(/^niche-.*$/, 'niche')
}

export function researchStepLabel(step: string | null): string {
  const key = step === null ? null : Object.hasOwn(STEP_LABELS, step) ? step : family(step)
  const label = key !== null && Object.hasOwn(STEP_LABELS, key) ? STEP_LABELS[key] : undefined
  return label ?? 'Researching'
}
