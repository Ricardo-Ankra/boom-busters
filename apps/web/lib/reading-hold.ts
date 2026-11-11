import { FIGURE_HOLD_MS, READING_HOLD_MS } from '@boom-busters/schemas'
import type { GraphicCode } from '@boom-busters/schemas'

/**
 * How long a graphic holds after its last word so it can be read. A chart,
 * or a graphic that cites a figure (a fact with a digit in it), needs longer
 * to take in. The brief carries no technique, so a cited figure is the proxy
 * for a chart or a counter.
 */
export function holdMsFor(type: 'chart' | 'graphic', code: Pick<GraphicCode, 'facts'>): number {
  if (type === 'chart') return FIGURE_HOLD_MS
  return code.facts.some((fact) => /\d/.test(fact.text)) ? FIGURE_HOLD_MS : READING_HOLD_MS
}
