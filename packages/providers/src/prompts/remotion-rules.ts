/**
 * Remotion's own rules for the designer's prompt (decision 301): house-edited
 * excerpts of two files under `.agents/skills/remotion-markup/`, vendored
 * from `remotion-dev/skills` and pinned by hash in `skills-lock.json`.
 * `timing.md` for interpolate over explicit ranges, clamping, keyframes and
 * perceptual scale; `sequencing.md` for Sequence windows, `layout="none"`,
 * the local frame inside a Sequence and nesting. Not `transitions.md` or
 * `text-highlights.md`, which rest on packages the sandbox does not expose,
 * and not `Series`, which the sandbox scope lacks.
 *
 * A vendored line is Remotion's text; a house line is ours, marked so
 * `remotion-rules.test.ts` can pin every vendored line to its file. The
 * house's edits: Remotion's `Easing.spring({damping: 200})` advice and its
 * keyframe easings are replaced by the tokens, since a design may not name
 * `Easing`; and the examples that pass no easing get `motion.ease.enter`,
 * since the scan refuses an interpolate without one.
 */

export interface RuleLine {
  text: string
  /** The house's own line, not Remotion's. */
  house?: true
}

export interface RemotionRuleExcerpt {
  file: 'timing.md' | 'sequencing.md'
  lines: readonly RuleLine[]
}

const v = (text: string): RuleLine => ({ text })
const h = (text: string): RuleLine => ({ text, house: true })

export const REMOTION_RULE_EXCERPTS: readonly RemotionRuleExcerpt[] = [
  {
    file: 'timing.md',
    lines: [
      v('Drive motion with `interpolate()` over an explicit frame range.'),
      h(
        'In this sandbox the curve is a token: every interpolate carries easing: motion.ease.<name>, written inside the call, and the range comes from the tokens, [from, from + motion.frames(motion.ms.enter, fps)].',
      ),
      v('By default, the values are not clamped, so the value can go outside the range [0, 1].'),
      v('Here is how they can be clamped:'),
      v('const opacity = interpolate(frame, [0, 0.3 * fps], [0, 1], {'),
      h('  easing: motion.ease.enter,'),
      v('  extrapolateRight: "clamp",'),
      v('  extrapolateLeft: "clamp",'),
      v('});'),
      h(
        "A push with no bounce is motion.spring.settle through Remotion.spring, or motion.ease.enter; Remotion's Easing is not available here.",
      ),
      v('## Multiple keyframes'),
      v(
        'Add as many keyframes as you want. For multiple easings, pass an array with `n - 1` items:',
      ),
      v('const scale = interpolate(frame, [0, 1 * fps, 9 * fps, 10 * fps], [0, 1, 1, 0], {'),
      h('  easing: [motion.ease.enter, motion.ease.linear, motion.ease.exit],'),
      v('  extrapolateLeft: "clamp",'),
      v('  extrapolateRight: "clamp",'),
      v("  output: 'perceptual-scale' // <- Add this to scale animations"),
      v('});'),
      v('## Animating scale'),
      v(
        'When animating scale, if the output is linear, the perceived scale would be smaller the larger the scale gets.',
      ),
      v('Use this option to compensate:'),
      h("Pass output: 'perceptual-scale' to any interpolate that drives a scale."),
    ],
  },
  {
    file: 'sequencing.md',
    lines: [
      v('Use `<Sequence>` to delay when an element appears in the timeline.'),
      v('This will by default wrap the component in an absolute fill element.'),
      v('If the items should not be wrapped, use the `layout` prop:'),
      v('<Sequence layout="none">'),
      v('  <Title />'),
      v('</Sequence>'),
      h(
        'Here <Title /> stands for the elements a helper returns: write <Remotion.Sequence from={at} durationInFrames={length} layout="none">{title(frame - at, fps)}</Remotion.Sequence>, with at and length whole numbers and length at least 1.',
      ),
      v('## Frame References Inside Sequences'),
      v('Inside a Sequence, `useCurrentFrame()` returns the local frame (starting from 0):'),
      h(
        "You read useCurrentFrame() once, at the top of Graphic, so hand a helper inside a Sequence that frame less the Sequence's from, as above.",
      ),
      v('## Nested Sequences'),
      v('Sequences can be nested for complex timing:'),
      v('<Sequence from={0} durationInFrames={120}>'),
      v('  <Background />'),
      v('  <Sequence from={15} durationInFrames={90} layout="none">'),
      v('    <Title />'),
      v('  </Sequence>'),
      v('  <Sequence from={45} durationInFrames={60} layout="none">'),
      v('    <Subtitle />'),
      v('  </Sequence>'),
      v('</Sequence>'),
    ],
  },
]

/** The block the system prompt carries. */
export const REMOTION_RULES =
  "Remotion's own rules, from its agent skills (vendored and pinned), with the house's edits where the sandbox differs:\n" +
  REMOTION_RULE_EXCERPTS.map(
    (excerpt) => `\n${excerpt.file}:\n${excerpt.lines.map((line) => line.text).join('\n')}`,
  ).join('\n')
