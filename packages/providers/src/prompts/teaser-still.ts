/**
 * The teaser studio's still prompt (decision 252): the beat's own words plus
 * the house anchors and a vertical framing clause, appended once. The teaser
 * is 9:16 with a hook overlay at the top and a caption band at the bottom, so
 * a still framed for 16:9 puts its subject under the text.
 */

export const TEASER_VERTICAL_CLAUSE =
  'Vertical 9:16 frame: subject in the centre third, headroom above for the hook text, ' +
  'nothing important in the bottom quarter where captions sit.'

export function teaserStillPrompt(prompt: string, styleAnchors: string): string {
  const trimmed = prompt.trim()
  if (trimmed.includes(TEASER_VERTICAL_CLAUSE)) return trimmed
  return `${trimmed} ${TEASER_VERTICAL_CLAUSE} ${styleAnchors.trim()}`.trim()
}
