import {
  DEFAULT_MOTION_IDENTITY,
  figureDigitGroups,
  GRAPHIC_CONCEPT_MAX,
  GRAPHIC_SOURCE_MAX,
  GRAPHIC_STORYBOARD_LINE_MAX,
  GRAPHIC_STORYBOARD_MAX,
  GRAPHIC_TITLE_MAX,
  MECHANISM_KEYS,
  MECHANISMS,
  MECHANISMS_PER_DESIGN_MAX,
  mechanismName,
  motionNeverList,
  motionNumbers,
  PlannedGraphicCodeSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  BibleInUse,
  ChannelBible,
  ChartSeries,
  MotionIdentity,
  PlannedGraphicCode,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { fillSlots, literalBibleText, noun } from './bible'
import { GRAPHIC_CODE_FIXTURE_SOURCE } from './graphic-code-fixture'
import { REMOTION_RULES } from './remotion-rules'
import { claimList, type ScriptClaim } from './script'
import type { Exemplar } from '../exemplars/index'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, dropItems, ignoreRepairs, trimField, type Note } from './repair'
import { outputBudget, type LLMTaskRequest, type MsgImage } from '../llm/types'

export { GRAPHIC_CODE_FIXTURE_SOURCE }

/**
 * The graphics designer (decision 289; it writes code since decision 295):
 * one call per graphic or chart slot, on its own route. The shot list
 * decides that a beat is a graphic and what it must get across; this call
 * writes the graphic, a React component the sandbox in
 * `packages/compositions` runs. The web server checks the answer
 * (`apps/web/lib/graphic-code/`) before it is kept.
 *
 * Three messages: the system rules and the film message are identical for
 * every graphic of a film, so the provider caches them and each graphic pays
 * for its own slot message only.
 */

/** A whole component, with room to think first; a cut-off is asked again at double (decision 292). */
export const GRAPHIC_ANSWER_TOKENS = 12_000

export interface SlotWord {
  text: string
  offsetMs: number
}

/** The design a redesign replaces, as `GraphicDesignInput.current` carries it. */
export type CurrentDesign = Pick<PlannedGraphicCode, 'source' | 'title'> & {
  /** The preamble version the stored design carries, absent on a design stored before decision 301. */
  motion?: number
}

export interface GraphicDesignInput {
  /** The channel bible the project froze. */
  bible: BibleInUse
  caseTitle: string
  /** The film's claims in prompt order: positions are the numbers cited. */
  claims: readonly ScriptClaim[]
  /** Titles the logo library holds. */
  logos: readonly string[]
  chapterTitle: string
  coversText: string
  /** The paragraph or paragraphs the slot sits in, for context. */
  paragraphText: string
  durationMs: number
  words: readonly SlotWord[]
  wordsEstimated: boolean
  intent: string
  intentRefs: readonly number[]
  /** A chart slot: its brief's series, takeaway and annotations, which the code reads as `props.data`. */
  data?: {
    series: ChartSeries[]
    takeaway: string
    annotations?: { atX: string; text: string }[]
  }
  /** A redesign: the source and title being replaced (ruling 9; its facts are not shown). */
  current?: CurrentDesign
  guidance?: string
  /** A passing design of the slot's technique, shown in the slot message (decision 305). */
  exemplar?: Exemplar
  /** Why the previous answer to this same slot was refused. */
  rejection?: string
  /** The channel's motion identity (spec 2026-11-04); the house identity when absent. */
  motion?: MotionIdentity
}

/** A millisecond count as the prompt says it: "1.5 seconds", "6 seconds", "900 ms". */
const secondsWord = (ms: number) => {
  const s = ms / 1000
  return `${Number.isInteger(s) ? s : s.toFixed(1)} seconds`
}

/**
 * The craft lines a channel sets (spec 2026-11-04, section 8.2): each is a
 * function of the identity, and at the house identity reads as it always did.
 */
const CRAFT_THREE_D: Record<MotionIdentity['threeD'], string> = {
  never: '- No 3D: no perspective, rotateX or rotateY; depth comes from scale and order.',
  whenMeaningful:
    '- 3D when it carries meaning: perspective with rotateX or rotateY for a drum, a turn or a\n  card, never a spin for its own sake.',
  welcome:
    '- 3D is welcome where it reads: perspective with rotateX or rotateY for a drum, a turn, a\n  card or a reveal, never a spin for its own sake.',
}

function craftFromIdentity(motion: MotionIdentity): string {
  const never = motionNeverList(motion)
  return [
    `- Something changes about every ${secondsWord(motion.changeEveryMs)}, and the camera ${motion.cameraRule}.`,
    motion.blurFollowsSpeed
      ? '- Blur follows speed: an element moving fast takes a filter: blur() worked out from how far\n  it moved since the frame before (compute its place at frame - 1), and none at rest.'
      : null,
    CRAFT_THREE_D[motion.threeD],
    motion.chartsConventional
      ? '- Charts stay honest and conventional: bars rise out of the baseline, lines draw on, a ring\n  sweeps; no gridlines or minor ticks, and no bar that travels or morphs from one value to\n  the next. The invention goes into the type, the framing and the hand-offs, never the data\n  marks.'
      : null,
    never.length > 0 ? `- Never: ${never.join(', ')}.` : null,
    motion.allow.length > 0 ? `- Allowed on this channel: ${motion.allow.join(', ')}.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

const EASE_WORDS: Record<MotionIdentity['signatureEase'], string> = {
  soft: 'soft (arrivals settle long, moves ease both ways)',
  crisp: 'crisp (arrivals snap in, moves ease hard both ways)',
  gentle: 'gentle (sine curves, nothing abrupt)',
}
/** The craft's overshoot sentence, after "in the house motion below. "; the house one at hair. */
const OVERSHOOT_CRAFT: Record<MotionIdentity['overshoot'], string> = {
  none: 'Nothing passes its mark: the hero spring settles without overshoot, and nothing\n  spins.',
  hair: "Nothing\n  passes its mark except the one hero spring of a beat and snap's hair of overshoot on\n  small things; nothing spins.",
  welcome:
    'The hero and snap springs are loose and pass their marks; a figure or a title may\n  overshoot once a beat; nothing spins.',
}
/** The house-motion spring sentence, after "and\n  nothing else: "; the house one at hair. */
const OVERSHOOT_SPRING: Record<MotionIdentity['overshoot'], string> = {
  none: 'settle by default, hero at most once per beat for the figure the beat is about (on\n  this channel it settles without overshoot), snap for small things only (a tick, a dot,\n  a badge), never a figure or a title.',
  hair: 'settle by default (no overshoot), hero at most once per beat (one small\n  overshoot, for the figure the beat is about), snap for small things only (a tick, a dot,\n  a badge), never a figure or a title.',
  welcome:
    'settle by default, hero at most once per beat (a clear overshoot, for the figure the\n  beat is about), snap for small things (a tick, a dot, a badge) and, on this channel, a\n  figure or a title too.',
}

/**
 * The channel's block after the craft: its constants in words and its style
 * guide. Empty at the house identity, so the house prompt reads as it did.
 */
function channelMotion(motion: MotionIdentity): string {
  const lines: string[] = []
  if (motion.signatureEase !== DEFAULT_MOTION_IDENTITY.signatureEase) {
    lines.push(`- The curves are ${EASE_WORDS[motion.signatureEase]}.`)
  }
  if (motion.entrance !== DEFAULT_MOTION_IDENTITY.entrance) {
    lines.push(
      `- Things arrive by ${motion.entrance}: motion.px.rise and motion.scale.enter are set for it.`,
    )
  }
  const lengths = Object.entries(motion.ms).filter(([, value]) => value !== undefined)
  if (lengths.length > 0) {
    const named: Record<string, string> = {
      enter: 'entrances take',
      exit: 'exits take',
      reveal: 'wipes take',
      draw: 'bars and lines draw on over',
      count: 'counts run',
      move: 'moves take',
      gap: 'the gap between an exit and its replacement is',
    }
    lines.push(
      `- Lengths: ${lengths.map(([key, value]) => `${named[key]} ${value} ms`).join('; ')}; motion.ms holds them.`,
    )
  }
  const guide = motion.styleGuideMd.trim()
  if (guide.length > 0) lines.push(guide)
  if (lines.length === 0) return ''
  return `\n\nThis channel's motion:\n${lines.join('\n')}`
}

/**
 * The identity said whole, house values included (spec 2026-11-04, section
 * 10.4): for a prompt with no craft section of its own, the critic's, so it
 * judges against the channel's taste and not its own. The designer's prompt
 * says the house values in its craft section and takes `channelMotion`.
 */
export function motionIdentityBlock(motion: MotionIdentity): string {
  const numbers = motionNumbers(motion)
  const lengths = Object.entries(numbers.ms)
    .map(([key, value]) => `${key} ${value}`)
    .join(', ')
  const lines = [
    `- The curves are ${EASE_WORDS[motion.signatureEase]}.`,
    `- Things arrive by ${motion.entrance}; overshoot: ${motion.overshoot}.`,
    `- Lengths in milliseconds: ${lengths}.`,
    craftFromIdentity(motion),
    `- Nothing may stay still longer than ${secondsWord(motion.stillMaxMs)}.`,
  ]
  const guide = motion.styleGuideMd.trim()
  if (guide.length > 0) lines.push(guide)
  return `This channel's motion:\n${lines.join('\n')}`
}

const systemTemplate = (
  bible: ChannelBible,
  motion: MotionIdentity,
  numbers = motionNumbers(motion),
): string => `You write ONE motion graphic for a documentary about [[example:direction-premise]], as a React
component. The narration is recorded; your graphic plays over it in the 16:9 film and in
the 9:16 Short, and it lands the beat the narrator is speaking.

You get the case and its numbered claims, the logos the producer holds, and then this
slot: its chapter, the paragraph it sits in, the words it covers, its length, every
spoken word with its time from the slot's start, the intent (what the viewer must take
away) and the claims it rests on. A chart slot also carries its data.

Answer with JSON only, its keys in this order, so the concept and the storyboard are settled
before the code is written:
{"concept": "...", "storyboard": ["...", "..."], "mechanisms": ["..."], "title": "...", "facts": [{"text": "...", "claim": 3}], "source": "..."}
- "concept": the one idea the graphic is made of, in one line of at most ${GRAPHIC_CONCEPT_MAX} characters:
  what the picture is and how it changes ("the sentence parts and the figure rises out of
  it"), found in this slot's own words.
- "storyboard": the graphic moment by moment on the slot's clock, one entry per change, each
  starting with its time (2.0 s, on "1.2bn": the figure rises out of the gap, pushing the
  lead-in up into its label), at most ${GRAPHIC_STORYBOARD_MAX} entries. Then write the code to it.
- "mechanisms": the moves the design is built on, as keys from the list below and no other,
  at most ${MECHANISMS_PER_DESIGN_MAX}; leave it out when none fits. The critic checks that each one is on the frames.
- "title": the slot card's name for the graphic, one line of at most ${GRAPHIC_TITLE_MAX} characters.
- "facts": every number and every quoted phrase the graphic shows, each with the NUMBER
  of the claim it comes from. A year is a number. At most 40 entries: more is refused, not
  cut. A chart's digits read off props.data need no entry.
- "source": the component, at most ${GRAPHIC_SOURCE_MAX} characters, as one JSON string. Escape
  its double quotes and line breaks as JSON requires.

The mechanisms, by key:
${MECHANISMS.map((m) => `- ${m.key}, ${mechanismName(m.key)}: ${m.definition}.`).join('\n')}

The sandbox your code runs in:
- Declare function Graphic(props) at the top level; helper functions and constants
  beside it are fine. Write no import and no export: the sandbox runs your code as the
  body of a function of (React, Remotion, props) and returns Graphic. JSX compiles to
  React.createElement. Call Remotion.useCurrentFrame(), Remotion.useVideoConfig() and
  React.useMemo only at the top of Graphic, never inside a helper or a condition; hand a
  helper the frame and fps as arguments. A helper is a plain
  function you call directly, row(label, value), never a React component rendered with
  createElement or JSX: that outer function is parsed once and run again for every frame,
  so a component declared inside it is a new component on each run and would remount its
  subtree on every frame.
- React: React itself, for elements, React.Fragment and React.useMemo.
- Remotion.useCurrentFrame(): the frame, from 0 at the slot's start, 30 to the second.
- Remotion.useVideoConfig(): {width, height, fps, durationInFrames}; the frame is 1920 by
  1080 or 1080 by 1920. Time your motion against props.durationMs and the words' atMs,
  not durationInFrames: in the film that is the length of the compiled slot, which can
  differ from the length you design for.
- Remotion.interpolate(value, inputRange, outputRange, {easing, extrapolateLeft,
  extrapolateRight, output}): inputRange strictly increasing; "clamp" holds the ends.
  output: 'perceptual-scale' on any interpolate that drives a scale.
- Remotion.spring({frame, fps, delay, config}): Remotion's spring, 0 to 1 from the delay;
  its config is always a token (below).
- motion: the house motion tokens, declared above your code and read-only. motion.ms
  {${Object.entries(numbers.ms)
    .map(([key, value]) => `${key} ${value}`)
    .join(', ')}},
  lengths in milliseconds. motion.frames(ms, fps), a length in whole frames, at least 1,
  and a time too: a word at 0 ms starts on frame 1. motion.ease {enter, exit, move,
  emphasis, linear}, the only curves. motion.spring {settle, hero, snap}, the only spring
  configs. motion.px.rise (${numbers.px.rise} at 1080p; multiply by your unit). motion.scale.enter (${numbers.scale.enter}).
  motion.stagger(index, fps), the frame offset of the index-th item of a group.
  motion.order ['frame', 'title', 'body', 'hero', 'note'], the entrance order.
- Remotion.Sequence {from, durationInFrames}: its children show only inside that window,
  and inside it useCurrentFrame() counts from 0. A Sequence's durationInFrames is at
  least 1 and its from a finite number, so wrap a length worked out from the words in
  Math.max(1, ...): anything else throws in the render, and the film shows only the
  title. Its children sit in a full-frame layer laid out as a flex row, unless
  layout="none".
- Remotion.AbsoluteFill {style}: a full-frame layer, laid out as a flex column.
- Remotion.Img {src, style}: an image, for a logo.
- Remotion.withAlpha(color, alpha): a brand colour at an opacity from 0 to 1.
- props.brand.colors: primary, accent, background, surface, textPrimary, textSecondary and
  captionHighlight; chartSeries, a list of colours for compared things; semantic.collapse
  and semantic.recovery.
- props.brand.fonts: heading, title, body, numbers and captions, family names for
  fontFamily. Figures are set in numbers.
- props.words: the narration, [{text, atMs}], atMs from the slot's start.
- props.durationMs: the slot's length.
- props.safeArea: {top, right, bottom, left}, insets in pixels for this frame size. The
  captions sit below the bottom inset.
- props.logos: {[title]: {src, width, height}} for the marks in the Logos list, under
  their exact titles. A mark can be missing: draw it only when props.logos holds it.
- props.data: on a chart slot, {series: [{label, unit, points: [{x, y}]}], takeaway,
  annotations?: [{atX, text}]}. Absent otherwise.
Never write import, require, window, document, fetch, setTimeout, setInterval,
requestAnimationFrame, Date, Math.random, eval, Function, globalThis, process, useState,
useEffect or useLayoutEffect, React.Suspense, React.lazy, a # colour, or rgb(), rgba(),
hsl() or hsla(); and assign to nothing under React or Remotion. A scan refuses them.
It also refuses constructor, prototype, __proto__, getPrototypeOf, Reflect, Proxy, self,
navigator, XMLHttpRequest, WebSocket, EventSource, localStorage, sessionStorage,
indexedDB, postMessage, importScripts, Worker and dangerouslySetInnerHTML; top, parent,
frames, opener and location read or called as the browser's (a style's top is fine); and
a script, iframe, object, embed, link, style, meta, base or form element.
It refuses Remotion.Easing in any form (the curves are motion.ease), an interpolate with no
easing: motion.ease.<name> written inside the call, a spring other than
Remotion.spring({ frame, fps, delay, config: motion.spring.<name> }), Remotion['...'],
React['...'] or motion['...'], an assignment to motion, a motion binding of your own, a
Remotion.spring or Remotion.interpolate read without being called, and a motion.ease or
motion.spring name that is not a token.
Format a number by hand ("1.9", "4,000,000"), never with toLocaleString or Intl: those
follow the viewer's locale, so the board and the film would show different figures.
Motion comes from the frame alone: no CSS transition, animation or @keyframes, which the
board plays between frames and the film never does.

The rules. Each one is checked, and a graphic that breaks one is refused:
1. Facts. Every number on screen comes from a claim, and its digits appear in that
   claim's text ("$4bn" from "4 billion dollars" is fine; "$4.2bn" is not). A number that
   stays on screen for a second must be in a claim your facts cite; a counter's passing
   values are not checked while they keep moving, so land a count on the claim's figure.
   Words on screen say only what the narration or the cited claims say. Never add a
   fact, a judgement, a qualifier or a source note of your own ("never audited", "widely
   cited", "allegedly"): this is a film about real ${literalBibleText(noun(bible, 'plural'))} and real people, and no
   check reads your words, only your numbers.
2. Brand. Colours come from props.brand.colors only, with Remotion.withAlpha for opacity;
   type comes from props.brand.fonts. The house paints the background behind your
   graphic.
3. A pure function of the frame. The same frame always draws the same picture: no clock,
   no randomness, no state, nothing that runs after the render.
4. Timing to the narration. Each new thing said gets its own change on screen, landing as
   it is said: a figure as its number is spoken, a name as it is named, a bar as its year
   is read. Dead air is the failure to avoid: a graphic in which nothing changes for
   more than ${secondsWord(motion.stillMaxMs)} is refused.
5. Both frames. Lay out from useVideoConfig()'s width and height: the 16:9 frame and the
   9:16 frame are both rendered and both checked.
6. Safe area. Everything sits inside props.safeArea at every frame, entrances included.
   Pad a full-frame layer by the insets, place anything absolutely positioned at or
   inside them, and bring an entrance in with opacity, scale or transform, never from
   outside the insets. Only a Remotion.AbsoluteFill spans the whole frame.
The code is run at every 250 ms of the slot in both frames before it is kept: a frame
that throws, or takes more than 2 seconds, is refused. The last second shows the
finished graphic, with words or figures on screen.

Craft. You are a motion designer, not a slide builder: the graphic is one idea that moves.
- A concept, not a layout. Find the picture in this slot's own words (a sentence that splits
  open to show its figure, a repeated word kept while what follows it changes, a door that
  opens on a name) and build the whole graphic out of it. A centred column of lines, each
  fading in under the last, is a template, not a design.
- Each moment is made out of the one before: an element arrives once and then changes role
  instead of leaving (a lead-in shrinks into the figure's label, a rule becomes the line a
  title drops from, a spoken word collapses into the divider it names, a figure docks into a
  row to make room for the next). What has landed stays unless the concept takes it away.
- A hook in the first half second: something on screen and moving before the first word
  lands, and it is part of the concept (the rule the figure will stand on, the mark the
  quote will open with), not decoration.
- Kinetic type, not paragraphs: a few words at a time, big, entering as they are spoken.
  A line can build word by word.
- One dominant idea with secondary detail: one thing is biggest, and the rest supports it.
- Motion keyed to the spoken words: each new thing said gets its own change, whether an
  entrance, a highlight, a bar growing or a line drawing across.
${craftFromIdentity(motion)}
- Entrances, exits and moves come from the tokens, in the house motion below. ${OVERSHOOT_CRAFT[motion.overshoot]}
- The ending holds. The last thing said lands as it is said; after it, the finished graphic holds, and the render gives it the time to be read. Nothing new enters, draws or moves into place once the last word's entrance has settled; only the camera push continues.
- Portrait is a first-class frame, not a squeeze: stack what sits side by side, and size
  type from Math.min(width, height).
- Colour carries meaning: semantic.collapse for loss and failure, semantic.recovery for
  gain, accent or captionHighlight for the one thing to look at, chartSeries to tell
  compared things apart, textPrimary and textSecondary for words.
- A logo earns its place when the ${literalBibleText(noun(bible, 'singular'))} or person is the subject, not because they
  are mentioned.
- A chart draws every point of props.data, labels each value as its claim states it, and
  says its takeaway.${channelMotion(motion)}

The house motion. The scan holds the curve and the spring config: every interpolate names
a motion.ease, every spring a motion.spring. Which curve, which preset, hero once per beat
and every length are judged on the board, not checked:
- Every interpolate carries easing: motion.ease.<name>, written inside the call: enter for
  arrivals, exit for departures, move for a reframe or the camera, emphasis for the one
  hero figure of the beat, linear for counters and progress only. For several keyframes
  pass an array of them, one fewer than the keyframes. Never pass the options through a
  variable: the check reads the call.
- A spring is Remotion.spring({ frame, fps, delay, config: motion.spring.<name> }) and
  nothing else: ${OVERSHOOT_SPRING[motion.overshoot]} A spring is for an arrival that should feel
  physical; ease everything else.
- Lengths come from motion.ms: an entrance is motion.ms.enter, an exit motion.ms.exit
  (exits are shorter than entrances), a wipe motion.ms.reveal, a bar or a line drawn on
  motion.ms.draw, a count motion.ms.count, a move motion.ms.move. A change within a beat
  transforms what is on screen (it moves, resizes, recolours or docks) rather than clearing
  it; when something must leave, it exits on motion.ms.exit and what replaces it enters a
  motion.ms.gap later. Convert with motion.frames(ms, fps).
- A fade rises motion.px.rise times your unit; a figure scales in from motion.scale.enter,
  never from 0; a wipe is a clip-path.
- A group of three or more elements staggers: the index-th item enters motion.stagger(index,
  fps) frames after the first. Anything keyed to the narration keeps its spoken time;
  stagger only what the narration does not time.
- The hero lands last, with only its note after it: entrances follow motion.order, frame,
  title, body, hero, note.
- A beat gets one kind of entrance. Emphasis on a word is a colour or weight change over
  motion.ms.micro, with interpolate.

${REMOTION_RULES}`

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export function buildGraphicRequest(input: GraphicDesignInput): LLMTaskRequest {
  const logos = input.logos.filter((title) => title.trim().length > 0)
  const film =
    `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` +
    (logos.length > 0
      ? `\n\nLogos (marks the producer holds):\n${logos.map((title) => `- ${title}`).join('\n')}`
      : '')

  const words = input.words.map((word) => `${seconds(word.offsetMs)}  ${word.text}`).join('\n')
  const slot =
    `Chapter: ${input.chapterTitle}\n\n` +
    `The paragraph: ${input.paragraphText}\n\n` +
    `This graphic covers: ${input.coversText}\n` +
    `Length: ${seconds(input.durationMs)}\n\n` +
    `Words spoken in it, from its start${input.wordsEstimated ? ' (estimated from the slot length; no recorded timings)' : ''}:\n${words}\n\n` +
    `Intent: ${input.intent}\n` +
    `Rests on claims: ${input.intentRefs.length > 0 ? input.intentRefs.join(', ') : 'none named'}` +
    (input.data
      ? `\n\nData (draw every point; values are verbatim from the claims):\n${JSON.stringify(input.data, null, 2)}`
      : '') +
    (input.exemplar ? `\n\n${exemplarBlock(input.exemplar)}` : '')

  return {
    task: 'graphics',
    system: fillSlots(
      systemTemplate(input.bible.bible, input.motion ?? DEFAULT_MOTION_IDENTITY),
      input.bible,
    ),
    messages: [
      { role: 'user', content: film },
      { role: 'user', content: slot },
      ...(input.current ? [{ role: 'user' as const, content: currentDesign(input.current) }] : []),
      ...(input.rejection
        ? [
            {
              role: 'user' as const,
              content: `Your previous answer for this slot was refused: ${input.rejection}. Answer again with that fixed.`,
            },
          ]
        : []),
      // Last, nearest the answer, and only when there is one.
      ...(input.guidance
        ? [{ role: 'user' as const, content: `The producer's steer: ${input.guidance}` }]
        : []),
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(GRAPHIC_ANSWER_TOKENS),
  }
}

/** One rendered rest frame the critic is shown (decision 389, spec 2026-11-04 section 10.4), and how the message names it. */
export interface ReviewFrame {
  label: string
  image: MsgImage
}

/**
 * The slot's exemplar (decision 305): one passing design of the technique
 * the brief calls for, in the sandbox and on the tokens. It is the only
 * design the designer is shown (decision 386), so the model patterns on the
 * technique and not on a fixed example. It sits in the slot message, after the data, so the cached film message and
 * the system prompt are untouched. Four backticks fence it, so a design that
 * holds three in a string cannot close the block early.
 */
function exemplarBlock(exemplar: Exemplar): string {
  return (
    `A passing design of this technique (${exemplar.technique}: ${exemplar.description}), in this ` +
    'sandbox and on the tokens, for its mechanics, its timing and its standard. ' +
    (exemplar.mechanisms.length > 0
      ? `It uses: ${exemplar.mechanisms.map(mechanismName).join(', ')}. `
      : '') +
    'Its concept came ' +
    "from its own narration: find this slot's own rather than reusing its layout. Its words and " +
    'figures are its own; yours come from this slot and its claims:\n' +
    '````jsx\n' +
    exemplar.source +
    '\n````'
  )
}

const PRE_TOKEN_DESIGN =
  '\nThis design was written before the motion tokens: move every curve onto motion.ease, every spring onto motion.spring, and every length onto motion.ms, keeping what the producer has not asked to change.'

/**
 * A redesign's starting point: the title, and the code fenced so its JSX reads
 * as code. A design stored before the motion tokens (no `motion`) is said to
 * be one, so the model moves it onto them rather than keeping `Easing`, which
 * the scan refuses (decision 301).
 */
function currentDesign(current: CurrentDesign): string {
  return (
    'The current design, which the producer wants changed:\n' +
    `Title: ${current.title}\n` +
    '```jsx\n' +
    current.source +
    '\n```' +
    (current.motion === undefined ? PRE_TOKEN_DESIGN : '')
  )
}

/**
 * The designer's answer, validated. The title, the concept and the
 * storyboard are free text, so one over its limit is trimmed with
 * `trimField` (a storyboard past `GRAPHIC_STORYBOARD_MAX` lines is capped)
 * and the repair reported through `note` (decisions 293 and 388). Nothing
 * else is repaired: a cut source would not compile, and a claim number or a
 * fact's text is a fact. A malformed answer is refused, and the retry is
 * told why (decision 292).
 */
export function parseGraphicCode(text: string, note: Note = ignoreRepairs): PlannedGraphicCode {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'graphic code')
  const storyboard = capList(
    raw['storyboard'],
    GRAPHIC_STORYBOARD_MAX,
    "the graphic's storyboard",
    note,
  )
  // A mechanism not in the list, or a label that is not a list at all, is
  // dropped, never refused: it is a label, not the design, and a refusal
  // would buy the whole design again.
  const listed = raw['mechanisms']
  if (listed !== undefined && !Array.isArray(listed)) {
    note({ action: 'dropped', field: "the design's mechanisms", reason: 'not a list' })
  }
  const mechanisms = capList(
    dropItems(
      Array.isArray(listed) ? listed : undefined,
      (item) =>
        typeof item === 'string' && (MECHANISM_KEYS as readonly string[]).includes(item)
          ? null
          : 'not a mechanism in the list',
      (item, index) => `mechanism ${index + 1} (${String(item)})`,
      note,
    ),
    MECHANISMS_PER_DESIGN_MAX,
    "the design's mechanisms",
    note,
  )
  const { mechanisms: _listed, ...rest } = raw
  const parsed = PlannedGraphicCodeSchema.safeParse({
    ...rest,
    ...(mechanisms === undefined ? {} : { mechanisms }),
    title: trimField(raw['title'], GRAPHIC_TITLE_MAX, "the graphic's title", note),
    concept: trimField(raw['concept'], GRAPHIC_CONCEPT_MAX, "the graphic's concept", note),
    ...(Array.isArray(storyboard)
      ? {
          storyboard: storyboard.map((line) =>
            trimField(line, GRAPHIC_STORYBOARD_LINE_MAX, 'a storyboard line', note),
          ),
        }
      : {}),
  })
  if (!parsed.success) {
    throw new ValidationError(`The graphic answer is malformed: ${formatIssues(parsed.error)}`, {
      field: 'graphic code',
    })
  }
  return parsed.data
}

/** The words spoken inside a slot, on the slot's own clock. */
export function wordsInSlot(
  words: readonly { text: string; startMs: number }[],
  startMs: number,
  durationMs: number,
): SlotWord[] {
  return words
    .filter((word) => word.startMs >= startMs && word.startMs < startMs + durationMs)
    .map((word) => ({ text: word.text, offsetMs: word.startMs - startMs }))
}

/** No recorded timings: the covered words spread evenly across the slot. */
export function estimatedWords(coversText: string, durationMs: number): SlotWord[] {
  const words = coversText.split(/\s+/).filter(Boolean)
  const step = words.length > 0 ? durationMs / words.length : 0
  return words.map((text, at) => ({ text, offsetMs: Math.round(at * step) }))
}

/**
 * The fixture's counting figure, which lands on "$4bn". The mock swaps the
 * whole expression for a literal figure built from a claim's own digits.
 */
const FIXTURE_FIGURE = "'$' + Math.round(count * 40) / 10 + 'bn'"

/**
 * Deterministic design for MOCK_PROVIDERS=1 (decision 295; ruling 11): the
 * fixture graphic, its figure swapped for `'$<digits>bn'`, where the digits
 * are the first digit group of the claim it cites (the first intent claim
 * with a digit, else the first claim with one), and its one fact that figure
 * on that claim. With no digit-bearing claim the figure is `''` and the
 * design cites nothing. Either way it passes the real checks on any seed.
 * Steered, the title says so, so a redesign proves something offline. The
 * fixture reads its frame and length from the sandbox: the slot's length and
 * a chart's data change nothing, and are taken so the mock is called as the
 * designer is.
 */
export function mockGraphicCode(input: {
  claimTexts: readonly string[]
  intentRefs: readonly number[]
  guidance?: string
  durationMs: number
  data?: GraphicDesignInput['data']
}): PlannedGraphicCode {
  const cited = mockFigure(input.claimTexts, input.intentRefs)
  const figure = cited?.text ?? ''
  return {
    title: input.guidance
      ? `[mock] Redesigned: ${input.guidance}`.slice(0, GRAPHIC_TITLE_MAX).trim()
      : '[mock] Raised in one round',
    facts: cited ? [cited] : [],
    // A replacer function, so the `$` in the figure is never read as a pattern.
    source: GRAPHIC_CODE_FIXTURE_SOURCE.replace(FIXTURE_FIGURE, () => `'${figure}'`),
  }
}

/** `'$<digits>bn'` on the claim it comes from, or null when no claim has a digit. */
function mockFigure(
  claimTexts: readonly string[],
  intentRefs: readonly number[],
): { text: string; claim: number } | null {
  const everyClaim = claimTexts.map((_, index) => index + 1)
  for (const claim of [...intentRefs, ...everyClaim]) {
    const digits = figureDigitGroups(claimTexts[claim - 1] ?? '')[0]
    if (digits !== undefined) return { text: `$${digits}bn`, claim }
  }
  return null
}
