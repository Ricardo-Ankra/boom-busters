import { GRAPHIC_CODE_VERSION } from '@boom-busters/schemas'
import type { GraphicCodePayload } from '@boom-busters/schemas'

/**
 * The house fixture for the designer's code (decision 295): the source the
 * mock designer answers with, the dry run's passing case and the source of
 * the `GraphicCodeWide` and `GraphicCodeTall` goldens. It is, character for
 * character, providers' `GRAPHIC_CODE_FIXTURE_SOURCE`
 * (`packages/providers/src/prompts/graphic-code-fixture.ts`), held equal by a
 * test there that reads this file off disk, so it carries no backtick, no
 * backslash and no `${`.
 *
 * It is plain JavaScript with `React.createElement`, not JSX, so the code
 * the sandbox runs is the code written here. It is what the checks ask of
 * any design: it reads the frame and the frame size, lays out for 16:9 and
 * 9:16, takes every colour and face from its props, pads itself in by the
 * safe area and positions nothing absolutely. A title fades in, the figure
 * counts up to $4bn over the first second (the passing values hold for less
 * than a second, so only "$4bn" is shown), an underline sweeps from the count
 * to the slot's end so nothing is ever still, a second line rises in halfway,
 * and the last frame holds with all its text up.
 */
export const GRAPHIC_CODE_SOURCE = `function Graphic(props) {
  const h = React.createElement
  const frame = Remotion.useCurrentFrame()
  const video = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = video.height > video.width
  const unit = Math.min(video.width, video.height) / 1080
  const last = Math.max(1, video.durationInFrames - 1)
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }

  // The title fades in; the figure counts up to $4bn over the first second.
  const titleIn = Remotion.interpolate(frame, [0, 12], [0, 1], clamp)
  const landAt = Math.min(9, Math.max(0, last - video.fps))
  const count = Remotion.spring({
    frame: frame,
    fps: video.fps,
    delay: landAt,
    durationInFrames: video.fps,
    config: { damping: 200 },
  })
  const figure = '$' + Math.round(count * 40) / 10 + 'bn'

  // The underline sweeps from the count to the slot's end, so the graphic
  // never sits still; a second line rises in halfway through.
  const sweepFrom = landAt + video.fps
  const sweep = Remotion.interpolate(frame, [sweepFrom, Math.max(sweepFrom + 1, last)], [0, 1], clamp)
  const half = Math.round(last / 2)
  const nextIn = Remotion.interpolate(frame, [half, half + 12], [0, 1], clamp)

  return h(
    Remotion.AbsoluteFill,
    {
      style: {
        paddingTop: inset.top,
        paddingRight: inset.right,
        paddingBottom: inset.bottom,
        paddingLeft: inset.left,
        justifyContent: 'center',
        alignItems: portrait ? 'center' : 'flex-start',
        textAlign: portrait ? 'center' : 'left',
      },
    },
    h(
      'div',
      {
        style: {
          fontFamily: fonts.title,
          fontSize: 56 * unit,
          color: colors.textSecondary,
          opacity: titleIn,
        },
      },
      'Raised in one round',
    ),
    h(
      'div',
      {
        style: {
          fontFamily: fonts.numbers,
          fontSize: 240 * unit,
          lineHeight: 1.1,
          color: colors.accent,
        },
      },
      figure,
    ),
    h('div', {
      style: {
        height: 10 * unit,
        width: sweep * (portrait ? 80 : 50) + '%',
        backgroundColor: colors.accent,
      },
    }),
    h(
      'div',
      {
        style: {
          fontFamily: fonts.body,
          fontSize: 44 * unit,
          marginTop: 24 * unit,
          color: colors.textPrimary,
          opacity: nextIn,
          transform: 'translateY(' + (1 - nextIn) * 24 * unit + 'px)',
        },
      },
      'Then the next step',
    ),
  )
}
`

/**
 * The fixture as a timeline payload: an 8 s slot, no logos, one claim. The
 * claim's text is not in a payload; a test that runs the fixture through the
 * facts check supplies a claim holding "$4 billion".
 */
export const GRAPHIC_CODE_PAYLOAD: GraphicCodePayload = {
  kind: 'graphic-code',
  version: GRAPHIC_CODE_VERSION,
  // Plain JavaScript runs as written.
  compiled: GRAPHIC_CODE_SOURCE,
  title: 'Four billion, on paper',
  words: [
    { text: 'Four', atMs: 0 },
    { text: 'billion', atMs: 360 },
    { text: 'dollars.', atMs: 820 },
  ],
  durationMs: 8000,
  logos: {},
  claimIds: ['01HQ00000000000000000000AA'],
}
