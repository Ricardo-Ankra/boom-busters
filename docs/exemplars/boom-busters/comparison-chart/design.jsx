// Concept: reported against real, year by year. As each year is spoken, its reported bar climbs
// in grey beside a hollow dashed outline of the same height, and the real bar climbs into the
// outline and stops far short of it: the empty part of the outline is the gap. When the gap is
// given its figure, the last outline turns red and the figure lands in red inside it, and the
// chart holds.

function arrive(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

// When a word starting with `prefix` is spoken, else the fallback.
function spokenAt(words, prefix, fallback) {
  const said = words.find((w) => String(w.text).toLowerCase().indexOf(String(prefix).toLowerCase()) === 0)
  return said ? said.atMs : fallback
}

// A dashed line drawn from its start, so its dashes stay put while it grows.
function dashes(color, toward, dash, space) {
  return 'repeating-linear-gradient(' + toward + ', ' + color + ' 0px, ' + color + ' ' + dash + 'px, transparent ' + dash + 'px, transparent ' + (dash + space) + 'px)'
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
  const first = props.data.series[0]
  const second = props.data.series[1]
  const n = Math.min(first.points.length, second.points.length)
  const pairs = first.points.slice(0, n).map((p, i) => ({ x: String(p.x), a: p.y, b: second.points[i].y }))
  const peak = Math.max(...pairs.map((p) => Math.max(p.a, p.b))) || 1
  // Each figure is printed as its source states it, so it reads exactly as the claim it cites.
  const figure = (y) => String(y)

  // Each pair rises as its year is spoken. The payoff is the figure said after the years: the
  // outlines turn red as it is spoken and it lands in the last gap. With no such figure, the
  // outlines turn as the gap is named.
  const lands = pairs.map((p, i) => spokenAt(words, p.x, 2000 + i * 1333))
  const isYear = (w) => pairs.some((p) => String(w.text).indexOf(p.x) === 0)
  const lastYear = words.reduce((at, w, i) => (isYear(w) ? i : at), -1)
  const keyWord = words.find((w, i) => i > lastYear && /\d/.test(String(w.text)))
  const keyText = keyWord ? String(keyWord.text).replace(/^[^\d]+|[^\d%]+$/g, '') : null
  const payoffAt = keyWord ? keyWord.atMs : spokenAt(words, 'gap', lands[n - 1] + 1333)

  // The kicker is what is said before the first year, each series' name in its bars' tone, so
  // it is the legend too; with nothing said first, the series' names stand in.
  const yearAt = words.findIndex((w) => pairs.some((p) => String(w.text).indexOf(p.x) === 0))
  const said = words.slice(0, Math.max(0, yearAt))
  const kicker = said.length > 0 ? said : [first.label, 'against', second.label].map((text) => ({ text, atMs: 0 }))
  const key = (text) => String(text).toLowerCase().replace(/[^a-z]/g, '')
  const pale = Remotion.withAlpha(colors.textSecondary, 0.75)
  const toneOf = (text) =>
    key(text) === key(first.label) ? colors.textSecondary : key(text) === key(second.label) ? colors.textPrimary : pale

  const room = width - inset.left - inset.right
  const plotW = portrait ? room - 48 * unit : room * 0.8
  const plotH = (portrait ? 0.38 : 0.42) * height
  const groupW = plotW / n
  const barW = groupW * (portrait ? 0.33 : 0.3)
  const inner = groupW * 0.05
  const heightOf = (v) => (Math.max(0, v) / peak) * plotH
  const kickerSize = (portrait ? 36 : 32) * unit
  // The figures carry the data; the years are labels, no larger and quieter.
  const valueSize = (portrait ? 38 : 36) * unit
  const labelSize = (portrait ? 42 : 36) * unit
  const stroke = Math.max(3, 4 * unit)
  const dash = 14 * unit
  const space = 6 * unit
  // A bar's figure sits inside its top when the bar is tall enough, so the gap above the shorter
  // bar stays empty; a sliver of a bar carries its figure just above it.
  const pad = 12 * unit
  const inside = (h) => h >= valueSize + 2 * pad
  const figureAt = (h) => (inside(h) ? h - pad - valueSize : h + pad)
  // Each bar climbs over half a draw and slows into its height; the second follows a beat behind.
  const riseMs = motion.ms.draw / 2

  const bars = pairs.map((p, i) => {
    const cx = (i + 0.5) * groupW
    const leftA = cx - inner / 2 - barW
    const leftB = cx + inner / 2
    const riseA = arrive(frame, fps, lands[i], riseMs)
    const riseB = arrive(frame, fps, lands[i] + motion.ms.enter, riseMs)
    const hA = heightOf(p.a)
    const hB = heightOf(p.b)
    // The outline stands in the shorter bar's place at the taller bar's height and rises with it;
    // the shorter bar rises into it, so what stays empty is the gap.
    const aTaller = p.a >= p.b
    const tall = aTaller ? hA * riseA : hB * riseB
    const outlineLeft = aTaller ? leftB : leftA
    // No outline until it has risen clear of the baseline, nor for a pair with no gap.
    const outlined = p.a !== p.b && tall > stroke
    // Red marks the endpoint: with a spoken figure, only the last gap turns red as the figure lands
    // in it; with none, every outline turns as the gap is named, left to right.
    const keyed = keyText !== null && i === n - 1
    const red = keyText === null || keyed ? arrive(frame, fps, payoffAt + (keyed ? 0 : i * motion.ms.micro), motion.ms.enter) : 0
    // The spoken figure sits in the middle of the last gap's empty part, above the short bar's own.
    const shortH = aTaller ? hB : hA
    const shortTop = shortH + (inside(shortH) ? 0 : pad + valueSize)
    const keyBottom = (shortTop + (aTaller ? hA : hB)) / 2 - valueSize / 2
    const valueA = arrive(frame, fps, lands[i] + riseMs - motion.ms.enter, motion.ms.enter)
    const valueB = arrive(frame, fps, lands[i] + riseMs, motion.ms.enter)
    const outline = (color, opacity) => (
      <div style={{ position: 'absolute', left: outlineLeft, width: barW, bottom: 0, height: tall, opacity }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: stroke, backgroundImage: dashes(color, 'to top', dash, space) }} />
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: stroke, backgroundImage: dashes(color, 'to top', dash, space) }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: stroke, backgroundImage: dashes(color, 'to right', dash, space) }} />
      </div>
    )
    const value = (text, left, bottom, color, opacity) => (
      <div style={{ position: 'absolute', left: left - inner, width: barW + 2 * inner, bottom, textAlign: 'center', fontFamily: fonts.numbers, fontWeight: 700, fontSize: valueSize, lineHeight: 1, color, opacity }}>
        {text}
      </div>
    )
    return (
      <React.Fragment key={'pair' + i}>
        {outlined ? outline(colors.textSecondary, 1 - red) : null}
        {outlined ? outline(colors.accent, red) : null}
        <div style={{ position: 'absolute', left: leftA, width: barW, bottom: 0, height: hA * riseA, backgroundColor: Remotion.withAlpha(colors.textSecondary, 0.55) }} />
        <div style={{ position: 'absolute', left: leftB, width: barW, bottom: 0, height: hB * riseB, backgroundColor: colors.textPrimary }} />
        {value(figure(p.a), leftA, figureAt(hA), inside(hA) ? colors.textPrimary : colors.textSecondary, valueA)}
        {value(figure(p.b), leftB, figureAt(hB), inside(hB) ? colors.background : colors.textPrimary, valueB)}
        {keyed ? value(keyText, outlineLeft, keyBottom, colors.accent, red) : null}
      </React.Fragment>
    )
  })

  const baseline = arrive(frame, fps, 0, motion.ms.draw)
  const labels = pairs.map((p, i) => {
    const inA = arrive(frame, fps, lands[i], motion.ms.enter)
    return (
      <div key={'label' + i} style={{ position: 'absolute', left: i * groupW, width: groupW, top: 0, textAlign: 'center', fontFamily: fonts.numbers, fontWeight: 700, fontSize: labelSize, lineHeight: 1.2, color: colors.textSecondary, opacity: inA, transform: 'translateY(' + (1 - inA) * motion.px.rise * unit + 'px)' }}>
        {p.x}
      </div>
    )
  })

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: plotW }}>
        <div style={{ fontFamily: fonts.body, fontSize: kickerSize, fontWeight: 600, lineHeight: 1.2, letterSpacing: '0.18em', textTransform: 'uppercase', whiteSpace: 'nowrap', marginBottom: (portrait ? 110 : 90) * unit }}>
          {kicker.map((w, i) => {
            const inW = arrive(frame, fps, w.atMs, motion.ms.enter)
            const last = i === kicker.length - 1
            return (
              <span key={'k' + i} style={{ display: 'inline-block', opacity: inW, transform: 'translateY(' + (1 - inW) * motion.px.rise * unit + 'px)' }}>
                <span style={{ color: toneOf(w.text) }}>{String(w.text).replace(/[:,.]$/, '')}</span>
                <span style={{ color: pale }}>{last ? ', ' + first.unit : ' '}</span>
              </span>
            )
          })}
        </div>
        <div style={{ position: 'relative', width: plotW, height: plotH }}>{bars}</div>
        <div style={{ width: plotW, height: Math.max(2, 2 * unit), backgroundColor: Remotion.withAlpha(colors.textSecondary, 0.6), clipPath: 'inset(0 ' + (1 - baseline) * 100 + '% 0 0)' }} />
        <div style={{ position: 'relative', width: plotW, height: labelSize * 1.2, marginTop: 16 * unit }}>{labels}</div>
      </div>
    </Remotion.AbsoluteFill>
  )
}
