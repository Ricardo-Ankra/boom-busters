// Concept: a list that counts down to nothing. Each item builds word by word as it is named, one
// square marker gliding down a hairline spine to meet it, the spine drawn behind it as the path
// walked, and the items already named step back in tone. As the last item lands the marker turns
// red, and a highlighter sweeps behind it.

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
function dim(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.exit, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

const CONNECTIVES = new Set(['and', 'or', 'but', 'then'])

// The items are the phrases between commas. A connective opening an item is said, not shown:
// it only sends the marker on ahead of the item's first word.
function itemsOf(words) {
  const items = []
  let item = null
  for (const w of words) {
    const text = String(w.text)
    if (!item) item = { cueMs: w.atMs, words: [] }
    const bare = text.toLowerCase().replace(/[^a-z]/g, '')
    if (item.words.length === 0 && CONNECTIVES.has(bare)) {
      item.cueMs = w.atMs
      continue
    }
    item.words.push({ atMs: w.atMs, text: text.replace(/[,;:.!?]+$/, '') })
    if (/[,;:.!?]$/.test(text)) {
      items.push(item)
      item = null
    }
  }
  if (item && item.words.length > 0) items.push(item)
  return items.map((it) => ({ ...it, atMs: it.words[0].atMs }))
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height, fps } = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080
  const items = React.useMemo(() => itemsOf(props.words || []), [props.words])
  const n = items.length
  const last = n - 1

  const itemSize = 112 * unit
  const rowH = itemSize * 1.15
  const rowGap = itemSize * 0.24
  const pitch = rowH + rowGap
  // The marker is a solid square on the spine, level with the middle of each item's letters.
  const square = Math.max(10, itemSize * 0.3)
  const gutter = square + itemSize * 0.5
  const spineW = Math.max(2, 3 * unit)
  const middle = rowH * 0.52

  // The marker sets off a glide before each item's first word, or at the connective that leads
  // into it, and arrives as the word is spoken.
  let markerY = 0
  for (let k = 1; k < n; k++) {
    const departMs = Math.min(items[k].cueMs, items[k].atMs - motion.ms.move)
    markerY += pitch * shift(frame, fps, departMs, items[k].atMs - departMs)
  }
  const markerIn = arrive(frame, fps, n > 0 ? items[0].atMs : 0, motion.ms.enter)
  const landed = n > 0 ? arrive(frame, fps, items[last].atMs, motion.ms.enter) : 0
  // The payoff is one gesture: the highlighter sweeps behind the last item as its last word lands,
  // reaching the word as it appears, and that word arrives settled, so no grey sits on the red.
  const lastWordAt = n > 0 ? items[last].words[items[last].words.length - 1].atMs : props.durationMs
  const sweep = shift(frame, fps, lastWordAt, motion.ms.reveal)

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: rowGap, paddingLeft: gutter }}>
        <div style={{ position: 'absolute', left: (square - spineW) / 2, top: middle, width: spineW, height: markerY, backgroundColor: Remotion.withAlpha(colors.textSecondary, 0.6) }} />
        <div style={{ position: 'absolute', left: 0, top: middle + markerY - square / 2, width: square, height: square, opacity: markerIn }}>
          <div style={{ position: 'absolute', inset: 0, backgroundColor: colors.textPrimary }} />
          <div style={{ position: 'absolute', inset: 0, backgroundColor: colors.accent, opacity: landed }} />
        </div>
        {items.map((item, k) => {
          // What has been named steps back: to mid grey as the next item is named, to pale grey
          // as the one after it is; the last item stays bright.
          const toMid = k < last ? dim(frame, fps, items[k + 1].atMs, motion.ms.micro) : 0
          const toPale = k + 2 <= last ? dim(frame, fps, items[k + 2].atMs, motion.ms.micro) : 0
          const marked = k === last
          return (
            <div key={'item' + k} style={{ position: 'relative', alignSelf: 'flex-start', height: rowH, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', fontFamily: fonts.heading, fontWeight: 800, fontSize: itemSize, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
              {marked ? (
                <div style={{ position: 'absolute', left: '-0.12em', right: '-0.12em', top: '0.08em', bottom: '-0.06em', backgroundColor: colors.accent, clipPath: 'inset(0 ' + (1 - sweep) * 100 + '% 0 0)' }} />
              ) : null}
              {item.words.map((w, j) => {
                const appear = arrive(frame, fps, w.atMs, motion.ms.enter)
                // The payoff's last word settles as it appears, so the highlighter can follow it.
                const quick = marked && j === item.words.length - 1
                const bright = quick
                  ? appear
                  : arrive(frame, fps, w.atMs + motion.ms.micro, motion.ms.reveal) * (1 - toMid)
                const text = j === 0 ? w.text.charAt(0).toUpperCase() + w.text.slice(1) : w.text
                return (
                  <span key={'w' + j} style={{ position: 'relative', display: 'inline-block', marginRight: j === item.words.length - 1 ? 0 : '0.26em', opacity: appear * (1 - 0.4 * toPale), transform: 'translateY(' + (1 - appear) * motion.px.rise * unit + 'px)' }}>
                    <span style={{ color: colors.textSecondary }}>{text}</span>
                    <span style={{ position: 'absolute', left: 0, top: 0, color: colors.textPrimary, opacity: bright }}>{text}</span>
                  </span>
                )
              })}
            </div>
          )
        })}
      </div>
    </Remotion.AbsoluteFill>
  )
}
