// Concept: the line is drawn a year at a time, the pen reaching each point as its year is spoken
// at one steady pace, the ground under it filling with a flat tone behind the pen. A hollow red
// ring waits at the last point; the pen, slower over the last stretch, reaches it as the last
// year is said, the ring fills red and the last value lands in red.

function arrive(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

function tally(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.linear, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

// When a word starting with `prefix` is spoken, else the fallback.
function spokenAt(words, prefix, fallback) {
  const said = words.find((w) => String(w.text).toLowerCase().indexOf(String(prefix).toLowerCase()) === 0)
  return said ? said.atMs : fallback
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
  const series = props.data.series[0]
  const points = series.points
  const n = points.length
  const last = n - 1
  const peak = Math.max(...points.map((p) => p.y)) || 1
  const note = (props.data.annotations || []).find((a) => String(a.atX) === String(points[last].x))

  // The pen reaches each point as its year is spoken.
  const lands = points.map((p, i) => spokenAt(words, String(p.x), 2000 + i * 1000))
  const noteAt = note ? spokenAt(words, note.text, lands[last] + motion.ms.reveal) : null
  const kicker = words.slice(0, Math.max(0, words.findIndex((w) => points.some((p) => String(w.text).indexOf(String(p.x)) === 0))))
  const named = kicker.length > 0 ? kicker : [{ text: series.label, atMs: 0 }]

  const room = width - inset.left - inset.right
  const plotW = portrait ? room - 48 * unit : room * 0.8
  const plotH = (portrait ? 0.46 : 0.42) * height
  // Headroom above the highest point for its value.
  const yOf = (v) => plotH - (Math.max(0, v) / peak) * plotH * 0.84
  const kickerSize = (portrait ? 36 : 32) * unit
  const valueSize = (portrait ? 44 : 40) * unit
  const labelSize = (portrait ? 42 : 36) * unit
  const lineW = Math.max(3, 6 * unit)
  const ring = 16 * unit
  // The note's width, from its length in tracked capitals.
  const noteSize = kickerSize * 1.15
  const noteW = note ? String(note.text).length * 0.82 * noteSize + noteSize : 0
  // The last point stands far enough in from the right edge for its note to centre under it.
  const padL = plotW * 0.07
  const padR = Math.max(padL, noteW / 2 + 8 * unit)
  const xOf = (i) => padL + (i * (plotW - padL - padR)) / Math.max(1, last)

  // The pen: along segment k from its year to the next at a steady pace, so it is at each point
  // exactly as that year is spoken and never waits ahead of the voice. The last stretch, twice as
  // long, starts at the pace the pen arrives with and slows into the ring: two thirds steady, one
  // third the enter curve.
  let segment = 0
  let along = 0
  for (let k = 0; k < last; k++) {
    const lengthMs = lands[k + 1] - lands[k]
    const steady = tally(frame, fps, lands[k], lengthMs)
    const s = k === last - 1 ? (2 * steady + arrive(frame, fps, lands[k], lengthMs)) / 3 : steady
    if (s > 0) {
      segment = k
      along = s
    }
  }
  const started = frame >= motion.frames(lands[0], fps)
  const penX = xOf(segment) + (xOf(segment + 1) - xOf(segment)) * along
  const penY = yOf(points[segment].y) + (yOf(points[segment + 1].y) - yOf(points[segment].y)) * along
  const drawn = [...points.slice(0, segment + 1).map((p, i) => [xOf(i), yOf(p.y)]), [penX, penY]]
  const lineD = drawn.map((pt, i) => (i === 0 ? 'M ' : 'L ') + pt[0] + ' ' + pt[1]).join(' ')
  const groundD = lineD + ' L ' + penX + ' ' + plotH + ' L ' + xOf(0) + ' ' + plotH + ' Z'

  const baseline = arrive(frame, fps, 0, motion.ms.draw)
  const ringIn = n > 1 ? arrive(frame, fps, lands[last - 1], motion.ms.enter) : 0
  const ringFull = arrive(frame, fps, lands[last], motion.ms.enter)

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: plotW }}>
        <div style={{ fontFamily: fonts.body, fontSize: kickerSize, fontWeight: 600, lineHeight: 1.2, letterSpacing: '0.18em', textTransform: 'uppercase', whiteSpace: 'nowrap', color: colors.textSecondary, marginBottom: (portrait ? 90 : 60) * unit }}>
          {named.map((w, i) => {
            const inW = arrive(frame, fps, w.atMs, motion.ms.enter)
            const final = i === named.length - 1
            return (
              <span key={'k' + i} style={{ display: 'inline-block', opacity: inW, transform: 'translateY(' + (1 - inW) * motion.px.rise * unit + 'px)' }}>
                {String(w.text).replace(/[:,.]$/, '') + (final ? ', ' + series.unit : ' ')}
              </span>
            )
          })}
        </div>
        <div style={{ position: 'relative', width: plotW, height: plotH }}>
          <svg width={plotW} height={plotH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
            {started ? <path d={groundD} fill={Remotion.withAlpha(colors.textSecondary, 0.2)} /> : null}
            {started ? <path d={lineD} fill="none" stroke={colors.textPrimary} strokeWidth={lineW} strokeLinejoin="round" strokeLinecap="round" /> : null}
            {n > 1 ? (
              <circle cx={xOf(last)} cy={yOf(points[last].y)} r={ring} fill={colors.accent} fillOpacity={ringFull} stroke={colors.accent} strokeWidth={Math.max(3, 4 * unit)} opacity={ringIn} />
            ) : null}
          </svg>
          {points.map((p, i) => {
            const inV = arrive(frame, fps, lands[i], motion.ms.enter)
            const key = i === last
            // The endpoint's figure and note end at its ring, so they stay inside the frame's edge.
            const place = key
              ? { right: plotW - xOf(i) - ring, textAlign: 'right' }
              : { left: xOf(i) - 120 * unit, width: 240 * unit, textAlign: 'center' }
            return (
              <div key={'v' + i} style={{ position: 'absolute', ...place, bottom: plotH - yOf(p.y) + ring + 14 * unit, whiteSpace: 'nowrap', fontFamily: fonts.numbers, fontWeight: 700, fontSize: valueSize, lineHeight: 1, color: key ? colors.accent : colors.textSecondary, opacity: inV, transform: 'translateY(' + (1 - inV) * motion.px.rise * unit + 'px)' }}>
                {String(p.y)}
              </div>
            )
          })}
        </div>
        <div style={{ width: plotW, height: Math.max(2, 3 * unit), backgroundColor: Remotion.withAlpha(colors.textSecondary, 0.6), clipPath: 'inset(0 ' + (1 - baseline) * 100 + '% 0 0)' }} />
        <div style={{ position: 'relative', width: plotW, height: labelSize * 1.2 + (note ? noteSize * 1.5 : 0), marginTop: 16 * unit }}>
          {points.map((p, i) => {
            const inA = arrive(frame, fps, lands[i], motion.ms.enter)
            return (
              <div key={'x' + i} style={{ position: 'absolute', left: xOf(i) - 120 * unit, width: 240 * unit, top: 0, textAlign: 'center', fontFamily: fonts.numbers, fontWeight: 700, fontSize: labelSize, lineHeight: 1.2, color: colors.textSecondary, opacity: inA }}>
                {p.x}
              </div>
            )
          })}
          {note ? (
            // The note belongs to its year and is the payoff: centred under the year's label on the
            // axis, clear of the line, red with the ring and the figure as one endpoint.
            <div style={{ position: 'absolute', left: Math.min(xOf(last) - noteW / 2, plotW - noteW), width: noteW, top: labelSize * 1.2 + noteSize * 0.2, textAlign: 'center', whiteSpace: 'nowrap', fontFamily: fonts.body, fontWeight: 700, fontSize: noteSize, lineHeight: 1.2, letterSpacing: '0.18em', textTransform: 'uppercase', color: colors.accent, opacity: arrive(frame, fps, noteAt, motion.ms.enter) }}>
              {note.text}
            </div>
          ) : null}
        </div>
      </div>
    </Remotion.AbsoluteFill>
  )
}
