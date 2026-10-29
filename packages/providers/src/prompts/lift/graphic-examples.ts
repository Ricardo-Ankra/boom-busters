import { FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import type { GraphicDesignInput } from '../graphics'

/**
 * The two worked examples are bible slots (a worked example is a channel's
 * own story), so their code lives in the first channel's bible. These three
 * read it back, for tests only (the `test-helpers` entry, never production
 * code), so a test can run the examples through the web app's checks: an example that crashes or crops teaches the model to be refused. The beat
 * is a text-only graphic written on the tokens, with the one hero spring of a
 * beat; the chart is a bar chart read off `props.data`. A slot is its prose,
 * a blank line, then the component.
 */
const afterProse = (slot: string): string => slot.slice(slot.indexOf('\n\n') + 2)
const WORKED_CHART = FIRST_CHANNEL_BIBLE.examples['graphics-worked-chart']!

export const GRAPHIC_EXAMPLE_TYPE = afterProse(
  FIRST_CHANNEL_BIBLE.examples['graphics-worked-beat']!,
)

/** The second worked example's data, as the slot message would carry it. */
export const GRAPHIC_EXAMPLE_CHART_DATA = JSON.parse(
  WORKED_CHART.split('\n').find((line) => line.startsWith('{"series"'))!,
) as NonNullable<GraphicDesignInput['data']>

/** The second worked example's component. */
export const GRAPHIC_EXAMPLE_CHART = afterProse(WORKED_CHART)
