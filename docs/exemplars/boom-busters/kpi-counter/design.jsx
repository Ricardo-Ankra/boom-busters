// Concept: the figures that tell the collapse, one at a time. Each lands large and counts up as
// it is said, then docks into a row above, smaller and grey, as the next is named. The last
// stays large and lands in red.

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

const STOP = new Set(['of', 'a', 'an', 'and', 'the', 'to', 'in', 'with'])
const bare = (text) => String(text).toLowerCase().replace(/[^a-z]/g, '')
const trimmed = (text) => String(text).replace(/[,;:.!?]+$/, '')

// Each spoken figure with its label: the words said since the figure before it, or, for a figure
// with none, the words said after it.
function tilesOf(words) {
  const groups = []
  let pending = []
  for (const w of words) {
    if (/\d/.test(String(w.text))) {
      groups.push({ figure: w, before: pending, after: [] })
      pending = []
    } else {
      pending.push(w)
    }
  }
  if (groups.length > 0) groups[groups.length - 1].after = pending
  const content = (list) => list.filter((w) => !STOP.has(bare(w.text)))
  return groups.map((g) => {
    const token = trimmed(g.figure.text)
    const parts = /^([^\d]*)([\d.,]*\d)(.*)$/.exec(token) || ['', '', token, '']
    const digits = parts[2]
    const labelFirst = content(g.before).length > 0
    return {
      atMs: g.figure.atMs,
      prefix: parts[1],
      suffix: parts[3],
      target: Number(digits.replace(/,/g, '')) || 0,
      decimals: (digits.split('.')[1] || '').length,
      grouped: digits.indexOf(',') >= 0,
      labelFirst,
      label: (labelFirst ? content(g.before) : content(g.after)).map((w) => ({ atMs: w.atMs, text: trimmed(w.text) })),
    }
  })
}

// A figure part way through its count, in the form it was spoken.
function shown(tile, value) {
  const fixed = value.toFixed(tile.decimals)
  if (!tile.grouped) return fixed
  const halves = fixed.split('.')
  return halves[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (halves.length > 1 ? '.' + halves[1] : '')
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height, fps } = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080
  const tiles = React.useMemo(() => tilesOf(props.words || []), [props.words])
  const n = tiles.length

  const W = width - inset.left - inset.right
  const H = height - inset.top - inset.bottom
  const widest = Math.max(4, ...tiles.map((t) => t.prefix.length + shown(t, t.target).length + t.suffix.length * 0.5))
  const figureSize = Math.min((portrait ? 220 : 240) * unit, (0.8 * W) / (0.6 * widest))
  const labelSize = (portrait ? 38 : 34) * unit
  const gap = 18 * unit
  // The figure in play sits below the middle; the docked row runs across the top of the area.
  const mainX = W / 2
  const mainY = H * 0.6
  const rowY = H * 0.17
  const dockScale = 0.4
  const slotW = (portrait ? 0.48 : 0.3) * W
  const slotX = (k) => W / 2 + (k - (n - 2) / 2) * slotW

  // A shorter count than the house's, so each figure rests a beat before it docks. It docks so as
  // to arrive in the row as the next label (or, with none first, the next figure) is spoken, so
  // what comes next always lands in an empty place.
  const countMs = motion.ms.count * 0.7
  const dockAt = tiles.map((t, k) => {
    if (k === n - 1) return null
    const next = tiles[k + 1]
    const cue = next.labelFirst ? next.label[0].atMs : next.atMs
    return Math.max(t.atMs + countMs + motion.ms.micro, cue - motion.ms.move)
  })

  return (
    <Remotion.AbsoluteFill style={{ paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left }}>
      <div style={{ position: 'relative', width: W, height: H }}>
        {tiles.map((t, k) => {
          const docked = dockAt[k] === null ? 0 : shift(frame, fps, dockAt[k], motion.ms.move)
          const x = mainX + (slotX(k) - mainX) * docked
          const y = mainY + (rowY - mainY) * docked
          const scale = 1 + (dockScale - 1) * docked
          const inF = arrive(frame, fps, t.atMs, motion.ms.enter)
          const count = arrive(frame, fps, t.atMs, countMs)
          const last = k === n - 1
          const red = last ? arrive(frame, fps, t.atMs + countMs, motion.ms.micro) : 0
          const text = frame >= motion.frames(t.atMs, fps) ? shown(t, t.target * count) : ''
          const figure = (color, opacity) => (
            <span style={{ position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap', color, opacity }}>
              {t.prefix}{text}<span style={{ fontSize: '0.5em' }}>{t.suffix}</span>
            </span>
          )
          const labelTop = y + (figureSize / 2) * scale + gap
          return (
            <React.Fragment key={'tile' + k}>
              <div style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%, -50%) translateY(' + (1 - inF) * motion.px.rise * unit + 'px) scale(' + scale + ')', opacity: inF, fontFamily: fonts.numbers, fontWeight: 800, fontSize: figureSize, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ visibility: 'hidden', whiteSpace: 'nowrap' }}>
                  {t.prefix}{shown(t, t.target)}<span style={{ fontSize: '0.5em' }}>{t.suffix}</span>
                </span>
                {figure(colors.textSecondary, 1)}
                {figure(colors.textPrimary, (1 - docked) * (1 - red))}
                {last ? figure(colors.accent, red) : null}
              </div>
              <div style={{ position: 'absolute', left: x, top: labelTop, transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontFamily: fonts.body, fontWeight: 600, fontSize: labelSize, lineHeight: 1.2, letterSpacing: '0.18em', textTransform: 'uppercase', color: colors.textSecondary, opacity: 1 - 0.25 * docked }}>
                {t.label.map((w, j) => {
                  const inW = arrive(frame, fps, w.atMs, motion.ms.enter)
                  return (
                    <span key={'l' + j} style={{ display: 'inline-block', marginLeft: j === 0 ? 0 : '0.5em', opacity: inW, transform: 'translateY(' + (1 - inW) * motion.px.rise * unit + 'px)' }}>
                      {w.text}
                    </span>
                  )
                })}
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </Remotion.AbsoluteFill>
  )
}
