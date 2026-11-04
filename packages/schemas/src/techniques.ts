/**
 * The graphic technique catalogue (decision 305): one key per technique the
 * exemplar corpus holds. It lives here, below the providers package, so a
 * channel's settings can name the techniques it uses (spec 2026-11-04,
 * section 8.1) without the schemas depending on the corpus.
 */
export const TECHNIQUES = [
  'stat-counter',
  'kpi-counter',
  'bar-chart',
  'line-chart',
  'racing-chart',
  'comparison-chart',
  'donut-chart',
  'progress-bars',
  'progress-steps',
  'kinetic-word-stack',
  'typewriter',
  'text-highlight',
  'quote-card',
  'animated-list',
  'lower-third',
  'chapter-title',
  'logo-reveal',
  'split-screen',
] as const
export type Technique = (typeof TECHNIQUES)[number]

/**
 * The two techniques every channel keeps: the rules' last resort for a
 * graphic and for a chart, so a slot always has an exemplar (spec 8.3).
 */
export const LAST_RESORT_TECHNIQUES = ['kinetic-word-stack', 'bar-chart'] as const
