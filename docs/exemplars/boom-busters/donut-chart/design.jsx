// Concept: the ring is all the money. It draws in as the opening words are read; on the figure
// an arc sweeps round it locked to a heavy mono count, and the two land red together; on the
// last word that red slice pulls out of the ring, leaving its gap.

function arrive(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

// Two thirds steady and one third slowing in, so a draw runs evenly and settles into its close.
function draw(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  const range = [a, a + motion.frames(lengthMs, fps)]
  const even = Remotion.interpolate(frame, range, [0, 1], {
    easing: motion.ease.linear, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  const slow = Remotion.interpolate(frame, range, [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  return (2 * even + slow) / 3
}

function shift(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.move, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

// The ring's path from `from` to `to`, in turns clockwise from twelve o'clock.
function arc(c, r, from, to) {
  const span = Math.min(0.9999, Math.max(0, to - from))
  if (span <= 0) return ''
  const a0 = ((from * 360 - 90) * Math.PI) / 180
  const a1 = (((from + span) * 360 - 90) * Math.PI) / 180
  return (
    'M ' + (c + r * Math.cos(a0)) + ' ' + (c + r * Math.sin(a0)) +
    ' A ' + r + ' ' + r + ' 0 ' + (span > 0.5 ? 1 : 0) + ' 1 ' +
    (c + r * Math.cos(a1)) + ' ' + (c + r * Math.sin(a1))
  )
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height, fps } = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080
  const words = props.words || []

  // The spoken figure: its number, and what is written before and after it.
  const at = words.findIndex((w) => /\d/.test(String(w.text)))
  const said = at >= 0 ? words[at] : null
  const parts = said ? /^(\D*?)(\d+(?:\.\d+)?)(.*)$/.exec(String(said.text).replace(/[,.;:]+$/, '')) : null
  const target = parts ? Number(parts[2]) : 0
  const decimals = parts && parts[2].indexOf('.') >= 0 ? parts[2].split('.')[1].length : 0
  const share = Math.min(1, Math.max(0, target / 100))
  const figureAt = said ? said.atMs : props.durationMs * 0.45
  const landAt = figureAt + motion.ms.count

  // The kicker is what is read before the figure; the payoff is the last word, after it.
  const kicker = at > 0 ? words.slice(0, at) : []
  const final = words[words.length - 1]
  const payoff = final && at >= 0 && words.length - 1 > at && !/\d/.test(String(final.text)) ? final : null
  const goneAt = payoff ? Math.max(payoff.atMs, landAt + motion.ms.gap) : null

  // The whole ring is drawn by the time the figure is spoken.
  const ringIn = draw(frame, fps, 0, Math.max(motion.ms.enter, Math.min(motion.ms.draw, figureAt)))
  const counting = said !== null && frame >= motion.frames(figureAt, fps)
  const count = draw(frame, fps, figureAt, motion.ms.count)
  const landed = arrive(frame, fps, landAt, motion.ms.micro)
  const pull = goneAt === null ? 0 : shift(frame, fps, goneAt, motion.ms.move)
  const labelIn = goneAt === null ? 0 : arrive(frame, fps, goneAt, motion.ms.enter)
  const sweep = share * count

  const room = width - inset.left - inset.right
  const roomH = height - inset.top - inset.bottom
  const kickerSize = (portrait ? 38 : 34) * unit
  const R = portrait ? Math.min(0.36 * room, 0.3 * roomH) : Math.min(0.33 * roomH, 0.22 * room)
  const ringW = 0.24 * R
  const mid = R - ringW / 2
  const pullBy = 0.16 * R
  const box = 2 * (R + pullBy)
  const c = box / 2
  const shown = parts ? parts[1] + (target * count).toFixed(decimals) + parts[3] : ''
  const chars = parts ? (parts[1] + parts[2] + parts[3]).length : 3
  const figureSize = Math.min(0.6 * R, (1.1 * R) / (Math.max(3, chars) * 0.62))
  // The figure and the payoff word beneath it are centred in the ring together from the start,
  // so nothing shifts when the word arrives.
  const payoffSize = Math.max(kickerSize, 0.26 * figureSize)
  const payoffGap = 0.1 * figureSize
  const stackH = figureSize + (payoff ? payoffGap + payoffSize * 1.2 : 0)
  const figureTop = c - stackH / 2
  // The slice leaves along its own middle.
  const middle = (share / 2) * 2 * Math.PI - Math.PI / 2
  const dx = Math.cos(middle) * pullBy * pull
  const dy = Math.sin(middle) * pullBy * pull

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: room }}>
        <div style={{ maxWidth: room, textAlign: 'center', fontFamily: fonts.body, fontSize: kickerSize, fontWeight: 600, lineHeight: 1.25, letterSpacing: '0.18em', textTransform: 'uppercase', color: colors.textSecondary, marginBottom: (portrait ? 48 : 40) * unit }}>
          {kicker.map((w, i) => (
            <span key={'k' + i} style={{ display: 'inline-block', marginRight: i === kicker.length - 1 ? 0 : '0.4em', opacity: arrive(frame, fps, w.atMs, motion.ms.enter) }}>
              {String(w.text).replace(/[:,.;]$/, '')}
            </span>
          ))}
        </div>
        <div style={{ position: 'relative', width: box, height: box }}>
          <svg width={box} height={box} style={{ position: 'absolute', left: 0, top: 0 }}>
            <path d={arc(c, mid, sweep, ringIn)} fill="none" stroke={Remotion.withAlpha(colors.textSecondary, 0.3)} strokeWidth={ringW} />
            {counting ? (
              <g transform={'translate(' + dx + ' ' + dy + ')'}>
                <path d={arc(c, mid, 0, sweep)} fill="none" stroke={colors.textPrimary} strokeWidth={ringW} />
                {landed > 0 ? <path d={arc(c, mid, 0, sweep)} fill="none" stroke={colors.accent} strokeOpacity={landed} strokeWidth={ringW} /> : null}
              </g>
            ) : null}
          </svg>
          {counting ? (
            // The red is a crossfade of the same figure stacked in one grid cell.
            <div style={{ position: 'absolute', left: 0, width: box, top: figureTop, height: figureSize, display: 'flex', justifyContent: 'center' }}>
              <div style={{ display: 'grid', fontFamily: fonts.numbers, fontWeight: 800, fontSize: figureSize, lineHeight: 1, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ gridArea: '1 / 1', color: colors.textPrimary }}>{shown}</span>
                {landed > 0 ? <span style={{ gridArea: '1 / 1', color: colors.accent, opacity: landed }}>{shown}</span> : null}
              </div>
            </div>
          ) : null}
          {payoff && frame >= motion.frames(goneAt, fps) ? (
            <div style={{ position: 'absolute', left: 0, width: box, top: figureTop + figureSize + payoffGap, textAlign: 'center', fontFamily: fonts.body, fontSize: payoffSize, fontWeight: 700, lineHeight: 1.2, letterSpacing: '0.18em', textTransform: 'uppercase', color: colors.accent, opacity: labelIn }}>
              {String(payoff.text).replace(/[:,.;!?]$/, '')}
            </div>
          ) : null}
        </div>
      </div>
    </Remotion.AbsoluteFill>
  )
}
