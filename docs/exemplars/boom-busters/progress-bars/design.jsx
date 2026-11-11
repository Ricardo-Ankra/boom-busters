// Concept: one row per holder, named as it is spoken; each new row arrives below and the block
// slides up to stay centred. As each figure is said, its track draws across and the bar chases
// it in one stroke, slowing into its share, and the figure lands at the bar's tip. The largest
// share alone is red, and every figure is one size; the bars carry the weight.

function arrive(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}
function shift(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.move, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

const LINKS = new Set(['held', 'and', 'the', 'a', 'of', 'had', 'owned'])

// One row per spoken share: the words before a percentage name its holder.
function rowsOf(words) {
  const rows = []
  let label = []
  for (const w of words) {
    const share = /^(\d+(?:\.\d+)?)%/.exec(w.text)
    if (share) {
      const named = label.filter((l) => !LINKS.has(l.text.toLowerCase().replace(/[^a-z]/g, '')))
      const words = named.map((l) => ({ atMs: l.atMs, text: l.text.replace(/[^\w'’-]/g, '') }))
      rows.push({
        label: words.length > 0 ? words : [{ atMs: w.atMs, text: 'Share' }],
        startMs: (label[0] || w).atMs,
        landMs: w.atMs,
        value: Number(share[1]),
        shown: share[1] + '%',
      })
      label = []
    } else {
      label.push(w)
    }
  }
  return rows
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height, fps } = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080
  const rows = React.useMemo(() => rowsOf(props.words), [props.words])
  const top = rows.reduce((best, row, i) => (row.value > rows[best].value ? i : best), 0)

  const room = width - inset.left - inset.right
  const blockW = Math.min(room - 96 * unit, (portrait ? 960 : 1240) * unit)
  const labelSize = (portrait ? 56 : 44) * unit
  const valueSize = (portrait ? 74 : 58) * unit
  const trackH = (portrait ? 100 : 76) * unit
  const labelGap = (portrait ? 18 : 12) * unit
  const rowGap = (portrait ? 110 : 64) * unit
  const trackW = blockW
  // A figure sits just past its bar's tip, or inside the bar's end when it would run off the track.
  const valueW = valueSize * 0.6 * 4
  const tipGap = 18 * unit

  // The bar starts half a second before its figure is spoken, is all but home as it is said and
  // settles a little after; the figure lands at the tip as the bar does.
  const leadMs = motion.ms.move + motion.ms.micro
  const strokeMs = leadMs + motion.ms.move
  const trackMs = 3 * motion.ms.move

  // Rows stack from the centre: each new row arrives below and the block slides up by half
  // its pitch, so what has been said stays centred in the frame.
  const rowH = labelSize * 1.2 + labelGap + trackH
  const pitch = rowH + rowGap
  const arrived = rows.map((row, i) => (i === 0 ? 1 : shift(frame, fps, row.startMs, motion.ms.move)))
  const lift = rows.reduce((sum, _row, i) => sum + (i === 0 ? 0 : (1 - arrived[i]) * (pitch / 2)), 0)

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ width: blockW, display: 'flex', flexDirection: 'column', gap: rowGap, transform: 'translateY(' + lift + 'px)' }}>
        {rows.map((row, i) => {
          const key = i === top
          // The holder's name arrives whole; its empty track draws steadily across while the
          // holder is named, so the scale is there when the bar starts.
          const named = arrive(frame, fps, row.startMs, motion.ms.enter)
          // Every track draws at one pace, a beat after its row arrives; the bar never outruns it.
          const track = arrive(frame, fps, row.startMs + motion.ms.micro, trackMs)
          const strokeAt = Math.max(row.startMs + motion.ms.reveal, row.landMs - leadMs)
          const p = Math.min(arrive(frame, fps, strokeAt, strokeMs), (100 * track) / row.value)
          const landed = arrive(frame, fps, row.landMs, motion.ms.micro)
          const tip = (trackW * row.value) / 100
          const inside = tip + tipGap + valueW > trackW
          return (
            <div key={'row' + i} style={{ display: 'flex', flexDirection: 'column', gap: labelGap }}>
              <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: labelSize, lineHeight: 1.2, letterSpacing: '0.16em', textTransform: 'uppercase', color: colors.textSecondary, whiteSpace: 'nowrap', opacity: named }}>
                {row.label.map((w) => w.text).join(' ')}
              </div>
              <div style={{ position: 'relative', height: trackH, width: blockW }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: trackW * track, backgroundColor: Remotion.withAlpha(colors.textSecondary, 0.2) }} />
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: (trackW * row.value * p) / 100, backgroundColor: key ? colors.accent : Remotion.withAlpha(colors.textSecondary, 0.85) }} />
                <div style={{ position: 'absolute', ...(inside ? { right: trackW - tip + tipGap } : { left: tip + tipGap }), top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontFamily: fonts.numbers, fontWeight: 700, fontSize: valueSize, lineHeight: 1, color: inside ? colors.background : key ? colors.accent : colors.textPrimary, opacity: landed, whiteSpace: 'nowrap' }}>
                  {row.shown}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Remotion.AbsoluteFill>
  )
}
