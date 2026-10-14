# Motion tokens, Remotion's rules and the checks that hold them (decision 296)

Status: design approved in conversation 2026-10-14, section by section; this
document is for the owner's review before an implementation plan is written.

## 1. The problem

Decision 295 made the designer write each graphic as a React component. Its
first designs looked better than the form-filled ones, and the owner found
one thing wrong at once: bouncy entrances, which came from the model choosing
its own spring configs (damping 9 and 12). A follow-up on 2026-10-12 removed
spring and prescribed an eased vocabulary in prose.

Prose is advice. The research the owner commissioned on 2026-10-14 (a
reference library for a Remotion motion engine) reaches the same conclusion
from the other side: the "AI look" is mostly a timing and choreography
problem, and timing is a set of numbers. A rule written in a prompt is
followed some of the time; a token the code must use is followed every time.
Its recommended stack, in order: a motion specification as typed tokens
(durations, easings, spring presets, stagger, entrance order); Remotion's
own agent rules, vendored and pinned, injected into the prompt; a corpus of
MIT-licensed exemplars retrieved per request; Lottie assets. It warns off
video references as engine input, and off the Envato, Motion Array and
LottieGPT material on licence grounds.

### 1.1 The decision

Owner's rulings in the conversation, 2026-10-14:

- Sub-project 1 (this document): the token module, the vendored rules in the
  prompt, and the static checks. Sub-project 2, its own spec after this
  ships: the exemplar corpus and its retrieval. Lottie is deferred until a
  film needs illustrative assets.
- Tokens only: the design never writes an easing curve or a spring config of
  its own. The scan refuses direct use of `Remotion.Easing` and any spring
  without a token preset.
- Approach 1: the tokens are baked into each design. The check step prepends
  the token preamble to the compiled code, so a stored design carries the
  values the dry run checked it with, whatever the tokens become later.
- Spring returns as a token family with three presets, to be judged against
  eased entrances on the board.

## 2. The token module

`packages/compositions/src/lib/motion-tokens.ts` owns the house motion in two
forms a test holds equal:

- `MOTION`, a typed object house code can import.
- `MOTION_PREAMBLE`, JavaScript text that declares the same object as a frozen
  `motion` constant. It is evaluated inside the sandbox function body, so it
  may reference `Remotion.Easing`, and nothing else.

Values, scaled from the Carbon and Material ratios to video and in line with
the vocabulary of 2026-10-12. Each is one number in one file; the owner tunes
them on the board.

| Token | Value | Use |
| --- | --- | --- |
| `motion.ms.micro` | 120 | a colour shift, a tick |
| `motion.ms.enter` | 450 | a fade with rise |
| `motion.ms.exit` | 300 | exits are shorter than entrances |
| `motion.ms.reveal` | 550 | a wipe |
| `motion.ms.draw` | 700 | bars and lines drawn on |
| `motion.ms.count` | 1000 | a counter |
| `motion.ms.move` | 900 | a reframe, the camera |
| `motion.ms.gap` | 120 | between an exit and the entrance that replaces it |
| `motion.frames(ms, fps)` | `Math.max(1, Math.round(ms * fps / 1000))` | milliseconds to whole frames |
| `motion.ease.enter` | `Easing.out(Easing.poly(4))` | arrivals |
| `motion.ease.exit` | `Easing.in(Easing.cubic)` | departures |
| `motion.ease.move` | `Easing.inOut(Easing.cubic)` | moves and the camera |
| `motion.ease.emphasis` | `Easing.out(Easing.exp)` | the one hero figure in a beat |
| `motion.ease.linear` | `Easing.linear` | counters and progress only |
| `motion.spring.settle` | `{ damping: 200 }` | critically damped, no overshoot; the default spring |
| `motion.spring.hero` | `{ damping: 14, stiffness: 120 }` | one small overshoot, about 7%, settling under a second; once per beat |
| `motion.spring.snap` | `{ damping: 20, stiffness: 200 }` | quick, a hair of overshoot; small things |
| `motion.px.rise` | 20 | the rise under a fade, at 1080p; scaled by `frameScale` |
| `motion.scale.enter` | 0.96 | a figure's scale-in, never from zero |
| `motion.stagger(index, fps)` | 75 ms per item, the whole group within 600 ms | lists and groups; words on the narration keep their spoken times |
| `motion.order` | `['frame', 'title', 'body', 'hero', 'note']` | entrance order; the hero finishes last |

`Object.freeze` is applied to the object and to each nested object, so a
design cannot reassign a token (strict mode makes the attempt throw, which
the dry run reports as a refusal).

### 2.1 How a design gets the tokens

`graphicCodeIssue` (apps/web/lib/graphic-code/check.ts) compiles the source,
scans the compiled code, then prepends `MOTION_PREAMBLE` and stores the
result as `code.compiled`. The dry run, the board's still, the Player and
Lambda run the stored code as they do now. The sandbox contract (`React`,
`Remotion`, `props`) does not change, so no Remotion or broker deploy is
needed. A design stored before this change has no preamble and keeps
rendering; Redesign brings it onto the tokens.

`GraphicCodeSchema` gains `motion: z.number().int().positive().optional()`,
the preamble version a design carries (1 now). Nothing reads it yet; it is
there so a later token change can tell old designs from new.

## 3. The prompt

`packages/providers/src/prompts/graphics.ts` assembles the system prompt from
parts, each with one source:

1. The brief and the sandbox contract, as today, plus `motion`: the fields of
   section 2 listed by name, each with its use.
2. The house motion rules, replacing the vocabulary prose of 2026-10-12:
   entrances, exits and moves use the tokens and nothing else;
   `Remotion.Easing` is not available to a design; every `interpolate`
   carries `easing: motion.ease.<name>`; a spring is `Remotion.spring({ frame,
   fps, delay, config: motion.spring.<name> })` and nothing else, `settle` by
   default, `hero` at most once per beat; a group of three or more elements
   staggers with `motion.stagger`; the hero finishes last (`motion.order`);
   exits are shorter than entrances; a beat gets one kind of entrance; springs
   for arrivals that should feel physical, eased interpolation for everything
   else.
3. Remotion's own rules: house-edited excerpts of two vendored files under
   `.agents/skills/remotion-markup/`: `timing.md` (interpolate over explicit
   ranges, clamping, multiple keyframes) and `sequencing.md` (Sequence
   windows and offsets, `Series` for one scene after another). About 50
   lines. They live in `packages/providers/src/prompts/remotion-rules.ts` as
   string constants with a header naming the source file and the one edit:
   Remotion's `Easing.spring({damping: 200})` advice is replaced by the
   tokens. A test pins every excerpt line (after that edit) to the vendored
   file, so a future `npx skills` upgrade fails the test rather than
   drifting the prompt.

   `transitions.md` and `text-highlights.md` are not excerpted: the first is
   built on `@remotion/transitions` and the second on
   `@remotion/rough-notation`, neither of which the sandbox exposes, and
   exposing them would change the sandbox contract and need a Lambda
   redeploy. A graphic is one beat; the cut to the next slot is the
   timeline's. The two rules a design needs from them are written in the
   house rules of part 2 instead: a change within a beat is an exit on
   `motion.ms.exit`, a `motion.ms.gap` pause, then an entrance; emphasis on a
   word is a colour or weight change on `motion.ms.micro`, drawn with
   `interpolate`, never a package.
4. The two worked examples, rewritten on the tokens; the test of decision 295
   keeps running both through `graphicCodeIssue`.

The prompt grows by about 2,500 characters, all in the cached system
message; a design still pays for its slot message only.

## 4. The checks

On the model's compiled code, before the preamble is added
(apps/web/lib/graphic-code/scan.ts):

- `Remotion.Easing` and any `Easing.` member: refused ("the design uses
  Easing.cubic; curves come from motion.ease only").
- Every `interpolate(` call must carry an `easing:` option whose value starts
  with `motion.ease.`; a call without one is refused, naming the call ("an
  interpolate without motion.ease: a transform or opacity animated on a
  straight line is the first thing that reads as generated").
  `motion.ease.linear` is a token and passes.
- `Remotion.spring(` is allowed only with `config: motion.spring.<name>`; a
  spring with a literal config, or with none (Remotion's default bounces), is
  refused. `Easing.spring`, `Easing.elastic`, `Easing.bounce` and
  `Easing.back` stay refused.
- An assignment to `motion.*`, or a declaration of a `motion` binding of its
  own (`const motion`, `let motion`, `function motion`, a `motion` parameter),
  is refused: the preamble's constant is the house's.

The dry run is unchanged; the preamble is part of the compiled code it runs.

Not checked, and said so: the "everything starts on the same frame" tell is
handled by `motion.stagger` and the prompt rule, since markup sampled every
250 ms cannot tell a 75 ms stagger from a simultaneous entrance; the entrance
order is a rule the model follows, not one the scan can read. Both are judged
on the board.

## 5. Tests

- `motion-tokens.test.ts`: the preamble evaluated with the real Remotion
  equals `MOTION` (easings compared by sampling each curve at ten points,
  spring configs by value); every object frozen; `frames` and `stagger` at
  their edges (1 ms is 1 frame; the 600 ms cap).
- `remotion-rules.test.ts`: every excerpt line is found in its vendored file; no excerpt mentions a package other than `remotion`.
- `scan.test.ts`: each new refusal with a refused and a passing case,
  including `motion.ease.linear` passing, `config: motion.spring.hero`
  passing, a literal spring config refused, a bare `interpolate` refused.
- `check.test.ts`: the stored `compiled` starts with the preamble and carries
  `motion: 1`; the fixture and both examples pass the full checks under the
  preamble; a design that assigns to `motion.ms.enter` is refused by the dry
  run's crash report.
- `graphics.test.ts`: the prompt names every token and the rules; neither
  example uses `Easing.` or a literal spring config.
- The fixture is rewritten on the tokens; the two `GraphicCode` goldens are
  regenerated and viewed.

## 6. Rollout

A Vercel deploy and `PUT /api/inngest`. No migration (`motion` lives in the
brief's JSON column), no Remotion or broker deploy (the preamble uses
`Remotion.Easing` functions the runtime scope already has, and the sandbox
contract is unchanged). PROGRESS records decision 296, the number checked
against `origin/master` at the merge. Existing designs keep rendering;
Redesign moves one onto the tokens. The owner's first comparison: redesign
one graphic, then compare a `settle` spring against the eased entrance on the
same beat, and `hero` on its figure.

## 7. Out of scope

- The exemplar corpus and its retrieval (sub-project 2).
- Lottie assets and `@remotion/lottie`.
- Video references as engine input.
- Beat-synchronised timing to music; the narration's word times remain the
  clock.
- A check for simultaneous entrances or entrance order (section 4).
- Changing the tokens' values after the first board comparison: that is the
  owner's tuning, one number at a time.
