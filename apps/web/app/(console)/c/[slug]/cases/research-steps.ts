// Plain module (no React, no server actions) so server and client code can share the labels.

/** What the researcher is doing, by the step id it reports; an unknown id reads as plain Researching. */
const STEP_LABELS: Record<string, string> = {
  load: 'Starting',
  'keywords-terms': 'Finding search terms',
  'keywords-format': 'Finding search terms for the format',
  'keywords-filter': 'Keeping the terms about the subject',
  fit: 'Checking the subject fits the channel',
  'keywords-questions': 'Finding the questions people search',
  outliers: 'Finding the winning videos',
  'outlier-details': 'Reading the winning videos',
  winners: 'Studying the winning titles',
  angles: 'Drafting angle options',
  'rate-angles': 'Ranking the angles',
  'save-brief': 'Saving the brief',
}

export function researchStepLabel(step: string | null): string {
  const label = step !== null && Object.hasOwn(STEP_LABELS, step) ? STEP_LABELS[step] : undefined
  return label ?? 'Researching'
}
