// Concept: the race is read a year at a time. Named bars rise out of the baseline; as each year
// is spoken it rolls on like a reel and the bars step to its values, then rest there to be read.
// A bar passing another trades rows with it, its lead showing past. The bar the story follows
// is brightest from the start; named at the close, a red wipe runs along it and the rest step back.

function arrive(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

// 0 to 1 between two moments, starting and ending at rest.
function between(frame, fps, fromMs, toMs) {
  const a = motion.frames(Math.max(0, fromMs), fps)
  const b = Math.max(a + 1, motion.frames(Math.max(0, toMs), fps))
  return Remotion.interpolate(frame, [a, b], [0, 1], {
    easing: motion.ease.move, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

function move(frame, fps, atFrame) {
  return Remotion.interpolate(frame, [atFrame, atFrame + motion.frames(motion.ms.move, fps)], [0, 1], {
    easing: motion.ease.move, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

// When a word starting with `prefix` is spoken at or after `fromMs`, else the fallback.
function spokenAt(words, prefix, fromMs, fallback) {
  const key = String(prefix).toLowerCase()
  const said = words.find((w) => w.atMs >= fromMs && String(w.text).toLowerCase().indexOf(key) === 0)
  return said ? said.atMs : fallback
}

// The step to year k: a little over half the gap before it, done before the next year is read,
// never longer than a draw.
function stepMs(lands, k) {
  let ms = Math.max(motion.ms.move, 0.55 * (lands[k] - lands[k - 1]))
  if (k + 1 < lands.length) ms = Math.min(ms, Math.max(motion.ms.micro, lands[k + 1] - lands[k] - motion.ms.gap))
  return Math.min(ms, motion.ms.draw)
}

// A bar's value at a frame: nothing until the first year is read, up out of the baseline as it
// is, then one step to each next year's value as that year is spoken (when its digit rolls on),
// resting there for the rest of the gap, so every figure at rest is read against its own year.
function valueAt(frame, fps, ys, lands) {
  if (frame < motion.frames(lands[0], fps)) return 0
  let v = ys[0] * arrive(frame, fps, lands[0], motion.ms.move)
  for (let k = 1; k < ys.length; k++) {
    v += (ys[k] - ys[k - 1]) * between(frame, fps, lands[k], lands[k] + stepMs(lands, k))
  }
  return v
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
  const all = props.data.series
  const m = all.length
  // The years are the longest series'; each value is found by its year, so a series that
  // starts late stands at nothing until it does.
  const years = all.reduce((a, s) => (s.points.length > a.length ? s.points.map((p) => String(p.x)) : a), [])
  const n = years.length
  const last = n - 1
  const ys = all.map((s) => years.map((x) => (s.points.find((p) => String(p.x) === x) || { y: 0 }).y))
  const peak = Math.max(1, ...ys.map((v) => Math.max(...v)))

  // Each year is looked for after the one before it, so a year named early ("from 2004 to
  // 2008") is not taken for the later reading; a year the narration skips is spaced evenly
  // between the spoken years around it.
  const said = []
  let after = 0
  years.forEach((x) => {
    const w = words.find((v) => v.atMs >= after && String(v.text).indexOf(x) === 0)
    said.push(w ? w.atMs : null)
    if (w) after = w.atMs + 1
  })
  const known = said.map((t, k) => (t === null ? null : k)).filter((k) => k !== null)
  const lands = []
  years.forEach((x, k) => {
    let t = said[k]
    if (t === null) {
      const before = known.filter((j) => j < k).pop()
      const next = known.find((j) => j > k)
      if (before !== undefined && next !== undefined) {
        t = said[before] + ((said[next] - said[before]) * (k - before)) / (next - before)
      } else if (before !== undefined) {
        t = said[before] + (k - before) * 1200
      } else if (next !== undefined) {
        t = Math.max(0, said[next] - (next - k) * 1200)
      } else {
        t = 1000 + k * 1200
      }
    }
    lands.push(k === 0 ? t : Math.max(t, lands[k - 1] + motion.ms.move))
  })

  // The bar the story follows is the one that leads at the close; it is lit when it is named.
  let lead = 0
  ys.forEach((v, i) => {
    if (v[last] > ys[lead][last]) lead = i
  })
  const leadKey = String(all[lead].label).split(' ').sort((a, b) => b.length - a.length)[0]
  // The race is over once the last step and any pass it starts are done; the leader is lit
  // when named after that, never mid-race.
  const raceEnd = lands[last] + (last > 0 ? stepMs(lands, last) : 0) + motion.ms.move
  const litAt = Math.max(raceEnd, spokenAt(words, leadKey, lands[last], raceEnd + motion.ms.gap))
  // A red wipe runs along its bar from the baseline (two wipes' time: it crosses a whole bar) as
  // the others step back on the same curve; its figure turns red as the wipe arrives.
  const wipeMs = 2 * motion.ms.reveal
  const wipe = between(frame, fps, litAt, litAt + wipeMs)
  const stepBack = wipe
  const figureLit = arrive(frame, fps, litAt + wipeMs - motion.ms.micro, motion.ms.micro)

  // The kicker is the measure's short name said before the first year and closed by a colon
  // ("Deposits:"), its little words dropped; otherwise the unit stands alone.
  const LITTLE = ['in', 'from', 'by', 'the', 'a', 'an', 'of', 'and', 'to', 'for', 'over', 'since', 'year']
  const firstYear = words.findIndex((w) => years.some((x) => String(w.text).indexOf(x) === 0))
  const before = firstYear > 0 ? words.slice(0, firstYear) : []
  const colon = before.findIndex((w) => /:$/.test(String(w.text)))
  const named = before.slice(0, colon + 1).filter((w) => LITTLE.indexOf(String(w.text).toLowerCase().replace(/[^a-z]/g, '')) < 0)
  const kicker = named.length > 0 && named.length <= 3 ? named : []

  // Where each pair changes places: the frames at which the lead between them changes hands.
  const flips = React.useMemo(() => {
    const list = []
    const from = motion.frames(lands[0] + motion.ms.move, fps)
    const to = motion.frames(raceEnd, fps) + 1
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        let ahead = ys[i][0] >= ys[j][0]
        for (let f = from; f <= to; f++) {
          const d = valueAt(f, fps, ys[i], lands) - valueAt(f, fps, ys[j], lands)
          const now = d > 0 ? true : d < 0 ? false : ahead
          if (now !== ahead) {
            list.push({ i, j, f, ahead: now })
            ahead = now
          }
        }
      }
    }
    return list
  }, [fps, props.data, props.words])

  // How many bars are ahead of each, eased through every change of places.
  const ahead = all.map((_, i) => {
    let count = 0
    for (let j = 0; j < m; j++) {
      if (j === i) continue
      const a = Math.min(i, j)
      const b = Math.max(i, j)
      let state = ys[a][0] >= ys[b][0] ? 1 : 0
      let amount = state
      flips.forEach((x) => {
        if (x.i !== a || x.j !== b) return
        const target = x.ahead ? 1 : 0
        amount += (target - state) * move(frame, fps, x.f)
        state = target
      })
      count += j === a ? amount : 1 - amount
    }
    return count
  })
  const room = width - inset.left - inset.right
  const plotW = portrait ? room - 48 * unit : Math.min(room, 1480 * unit)
  const roomH = height - inset.top - inset.bottom
  const yearSize = (portrait ? 112 : 96) * unit
  const headGap = (portrait ? 64 : 56) * unit
  // The rows share the height left under the year: labels, bars and gaps shrink for a longer
  // race (labels never under 32 px), never past today's sizes for a short one.
  const labelSize = Math.max(32 * unit, Math.min((portrait ? 38 : 34) * unit, ((roomH - yearSize - headGap) / m) * 0.25))
  const labelGap = (portrait ? 14 : 12) * unit
  const barFull = (portrait ? 104 : 74) * unit
  const gapFull = (portrait ? 70 : 46) * unit
  const labelBlock = labelSize * 1.25 + labelGap
  const fit = Math.min(1, (roomH - yearSize - headGap - 16 * unit - m * labelBlock) / (m * (barFull + gapFull) - gapFull))
  const barH = barFull * Math.max(0.2, fit)
  const rowGap = gapFull * Math.max(0.2, fit)
  const valueSize = Math.max(32 * unit, Math.min((portrait ? 48 : 42) * unit, 0.9 * barH))
  const pitch = labelBlock + barH + rowGap
  const lineW = Math.max(2, 3 * unit)
  const valueGap = 16 * unit
  // Figures print at the data's own decimals (a whole figure stays whole), with room kept for
  // the widest of them past the longest bar.
  const decimals = Math.max(0, ...ys.flat().map((y) => (String(y).split('.')[1] || '').length))
  const format = (v) => String(Number(Math.max(0, v).toFixed(decimals)))
  const widest = Math.max(3, ...ys.flat().map((y) => format(y).length))
  const barMax = plotW - lineW - valueGap - widest * 0.62 * valueSize
  const started = frame >= motion.frames(lands[0], fps)
  const axis = arrive(frame, fps, 0, motion.ms.draw)
  const rowsH = m * pitch - rowGap
  const labelW = Math.max(...all.map((s) => String(s.label).length)) * 0.9 * labelSize + 28 * unit
  const values = all.map((_, i) => valueAt(frame, fps, ys[i], lands))
  const rows = all.map((s, i) => {
    const followed = i === lead
    // The shorter row is in front: one more for every row longer than it.
    const front = 1 + values.filter((w, j) => w > values[i] || (w === values[i] && j < i)).length
    return {
      i, s, followed, front,
      top: ahead[i] * pitch,
      len: (Math.max(0, values[i]) / peak) * barMax,
      figure: format(values[i]),
      label: arrive(frame, fps, motion.ms.enter + ahead[i] * 120, motion.ms.enter),
      back: followed ? 0 : stepBack,
    }
  })

  // The year rolls on like a reel as each is read: only the digits that change from the year
  // before roll, the ones the two share stay.
  let at = -1
  lands.forEach((t, k) => {
    if (frame >= motion.frames(t, fps)) at = k
  })
  const was = at >= 1 ? years[at - 1] : ''
  let shared = 0
  while (at >= 1 && was.length === years[at].length && shared < was.length - 1 && was[shared] === years[at][shared]) shared += 1
  const roll = at >= 1 ? move(frame, fps, motion.frames(lands[at], fps)) : 1
  const yearIn = arrive(frame, fps, lands[0], motion.ms.enter)
  // A whole line of travel inside the window, so the leaving and arriving digits never overlap.
  const travel = yearSize

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: plotW }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', height: yearSize, marginBottom: headGap }}>
          <div style={{ fontFamily: fonts.body, fontSize: labelSize, fontWeight: 600, lineHeight: 1.2, letterSpacing: '0.18em', textTransform: 'uppercase', whiteSpace: 'nowrap', color: colors.textSecondary }}>
            {(kicker.length > 0 ? kicker : [{ text: '', atMs: 0 }]).map((w, i, list) => {
              const final = i === list.length - 1
              const text = String(w.text).replace(/[:,.;]$/, '')
              return (
                <span key={'k' + i} style={{ display: 'inline-block', marginRight: final ? 0 : '0.4em', opacity: arrive(frame, fps, w.atMs, motion.ms.enter) }}>
                  {text === '' ? all[0].unit : text + (final ? ', ' + all[0].unit : '')}
                </span>
              )
            })}
          </div>
          {at >= 0 ? (
            <div style={{ display: 'flex', fontFamily: fonts.numbers, fontWeight: 700, fontSize: yearSize, lineHeight: 1, color: colors.textSecondary, opacity: yearIn * (1 - 0.5 * stepBack) }}>
              <span>{years[at].slice(0, shared)}</span>
              <span style={{ position: 'relative', overflow: 'hidden', height: yearSize }}>
                <span style={{ display: 'block', opacity: roll, transform: 'translateY(' + (1 - roll) * travel + 'px)' }}>
                  {years[at].slice(shared)}
                </span>
                {roll < 1 ? (
                  <span style={{ position: 'absolute', left: 0, top: 0, opacity: 1 - roll, transform: 'translateY(' + -roll * travel + 'px)' }}>
                    {years[at - 1].slice(shared)}
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
        {/* Words under bars: every label (on its plate) and every figure sits in one layer beneath
            all the bars, so in a pass a bar may hide a word but a word never cuts a bar. In each
            layer the shorter row is in front, so the passer's lead always shows past the bar it
            passes, and only one label shows where two share a row. */}
        <div style={{ position: 'relative', width: plotW, height: rowsH }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: lineW, height: rowsH, backgroundColor: Remotion.withAlpha(colors.textSecondary, 0.6), clipPath: 'inset(0 0 ' + (1 - axis) * 100 + '% 0)' }} />
          <div style={{ position: 'absolute', left: 0, top: 0, width: plotW, height: rowsH, zIndex: 1 }}>
            {rows.map((r) => (
              <div key={'words' + r.i} style={{ position: 'absolute', left: 0, top: r.top, width: plotW, height: pitch, zIndex: r.front }}>
                <div style={{ position: 'relative', width: labelW, backgroundColor: colors.background, marginLeft: lineW, paddingLeft: 14 * unit, height: labelSize * 1.25, fontFamily: fonts.body, fontSize: labelSize, fontWeight: 600, lineHeight: 1.25, letterSpacing: '0.18em', textTransform: 'uppercase', whiteSpace: 'nowrap', color: r.followed ? colors.textPrimary : colors.textSecondary, opacity: r.label * (1 - 0.3 * r.back) }}>
                  {r.s.label}
                </div>
                {started ? (
                  <div style={{ position: 'absolute', left: lineW + r.len + valueGap, top: labelSize * 1.25 + labelGap + (barH - valueSize) / 2, fontFamily: fonts.numbers, fontWeight: 700, fontSize: valueSize, lineHeight: 1, whiteSpace: 'nowrap', color: r.followed ? colors.textPrimary : colors.textSecondary, opacity: 1 - 0.3 * r.back }}>
                    {/* The red is a crossfade of the same figure stacked in one grid cell. */}
                    <span style={{ display: 'inline-grid' }}>
                      <span style={{ gridArea: '1 / 1' }}>{r.figure}</span>
                      {r.followed && figureLit > 0 ? (
                        <span style={{ gridArea: '1 / 1', color: colors.accent, opacity: figureLit }}>{r.figure}</span>
                      ) : null}
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div style={{ position: 'absolute', left: 0, top: 0, width: plotW, height: rowsH, zIndex: 2 }}>
            {rows.map((r) => (
              // Bars are opaque on the ground, so two passing bars never show through each other.
              <div key={'bar' + r.i} style={{ position: 'absolute', left: lineW, top: r.top + labelSize * 1.25 + labelGap, width: r.len, height: barH, zIndex: r.front, backgroundColor: r.followed ? colors.textPrimary : colors.background }}>
                {r.followed ? null : (
                  <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: Remotion.withAlpha(colors.textSecondary, 0.55 - 0.15 * r.back) }} />
                )}
                {r.followed && wipe > 0 ? (
                  <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: colors.accent, clipPath: 'inset(0 ' + (1 - wipe) * 100 + '% 0 0)' }} />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Remotion.AbsoluteFill>
  )
}
