/**
 * The graphic the mock designer answers with (decision 295), and the house
 * fixture: compositions holds the same text as `GRAPHIC_CODE_SOURCE`
 * (`packages/compositions/src/fixtures/graphic-code.ts`), because providers
 * may not depend on compositions; `graphic-code-fixture.test.ts` holds the two
 * equal. `mockGraphicCode` swaps its figure for a claim's own. Plain JavaScript with
 * `React.createElement`, so it is its own compiled form: a title fades in,
 * $4bn counts up over the first second, an underline sweeps to the slot's
 * end so nothing is ever still, a second line rises in halfway, and the
 * last frame holds. Colours and type come from `props.brand` only.
 */
export const GRAPHIC_CODE_FIXTURE_SOURCE = `function Graphic(props) {
  const h = React.createElement
  const frame = Remotion.useCurrentFrame()
  const video = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = video.height > video.width
  const unit = Math.min(video.width, video.height) / 1080
  const last = Math.max(1, video.durationInFrames - 1)
  const clamp = 'clamp'

  // The title arrives over motion.ms.enter; the figure counts up to $4bn over motion.ms.count.
  const titleIn = Remotion.interpolate(frame, [0, motion.frames(motion.ms.enter, video.fps)], [0, 1], {
    easing: motion.ease.enter,
    extrapolateLeft: clamp,
    extrapolateRight: clamp,
  })
  const countFrames = motion.frames(motion.ms.count, video.fps)
  const landAt = Math.min(9, Math.max(0, last - countFrames))
  const count = Remotion.interpolate(frame, [landAt, landAt + countFrames], [0, 1], {
    easing: motion.ease.emphasis,
    extrapolateLeft: clamp,
    extrapolateRight: clamp,
  })
  const figure = '$' + Math.round(count * 40) / 10 + 'bn'

  // The underline sweeps from the count to the slot's end, so the graphic
  // never sits still; a second line rises in halfway through.
  const sweepFrom = landAt + countFrames
  const sweep = Remotion.interpolate(frame, [sweepFrom, Math.max(sweepFrom + 1, last)], [0, 1], {
    easing: motion.ease.linear,
    extrapolateLeft: clamp,
    extrapolateRight: clamp,
  })
  const half = Math.round(last / 2)
  const nextIn = Remotion.interpolate(frame, [half, half + motion.frames(motion.ms.enter, video.fps)], [0, 1], {
    easing: motion.ease.enter,
    extrapolateLeft: clamp,
    extrapolateRight: clamp,
  })

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
          transform: 'translateY(' + (1 - nextIn) * motion.px.rise * unit + 'px)',
        },
      },
      'Then the next step',
    ),
  )
}
`
