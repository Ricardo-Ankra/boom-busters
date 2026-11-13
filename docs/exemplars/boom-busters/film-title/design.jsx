// Concept: the film's name, read into the frame. The whole name stands at the package's largest
// size from the first moment, in a quiet grey; as each word is read it settles to off white,
// while two grey hairlines open from the centre above and below to the name's width. The last
// word is written by a red highlighter: its wipe turns the word off white on red as it passes.
// The layout never changes and nothing blurs; the camera never moves.

const LINE = 1.04
const GAP_EM = 0.24

function arrive(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

function sweep(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.move, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

// The width in em of a word of heavy Inter set tight, reckoned by letter: the layout cannot
// measure, so capitals, wide and narrow letters are counted apart.
function ems(text) {
  let w = 0
  for (const ch of String(text)) {
    if (/[ilj.,:;'’!|I]/.test(ch)) w += 0.3
    else if (/[mwMW]/.test(ch)) w += 0.9
    else if (/[A-Z]/.test(ch)) w += 0.7
    else if (/[a-z]/.test(ch)) w += 0.57
    else if (/[0-9]/.test(ch)) w += 0.62
    else w += 0.6
  }
  return Math.max(0, w - 0.025 * String(text).length)
}

function lineEms(line) {
  return line.reduce((sum, w, i) => sum + ems(w.text) + (i > 0 ? GAP_EM : 0), 0)
}

// Words a line should not end on: it would split a phrase from what it introduces, or a figure
// from what it counts.
const WEAK = ['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from', 'into', 'as', 'vs',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twelve', 'twenty', 'fifty', 'hundred',
  'thousand', 'million', 'billion', 'trillion']

// The name in `count` lines, broken where the widest line is narrowest, at phrases: a line
// ending on a weak word or a numeral costs half its width again (a leading "The" alone on the
// first line is a title's own shape and costs nothing), a word left alone on any later line a
// quarter, and a break after a colon gains a tenth.
function balance(words, count) {
  let best = null
  const pick = (from, left, acc) => {
    if (left === 1) {
      const lines = acc.concat([words.slice(from)])
      // The last line carries the red bar, which stands 0.06 em past its word on each side.
      const widest = Math.max(...lines.map((line, i) => lineEms(line) + (i === lines.length - 1 ? 0.12 : 0)))
      let score = widest
      lines.slice(0, -1).forEach((line, li) => {
        const end = String(line[line.length - 1].text)
        const article = li === 0 && line.length === 1 && /^(the|a|an)$/i.test(end)
        const bare = end.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (!article && (WEAK.indexOf(bare) >= 0 || /^\d/.test(bare))) score *= 1.5
        if (/[:;,]$/.test(end)) score *= 0.9
      })
      // A title of four words or more leaves no word alone on a line after the first.
      if (words.length >= 4) lines.slice(1).forEach((line) => { if (line.length === 1) score *= 1.25 })
      if (best === null || score < best.score) best = { lines, widest, score }
      return
    }
    for (let cut = from + 1; cut <= words.length - left + 1; cut++) {
      pick(cut, left - 1, acc.concat([words.slice(from, cut)]))
    }
  }
  pick(0, Math.max(1, Math.min(count, words.length)), [])
  return best
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height, fps } = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080

  // Only the name's own closing full stop goes; a word with stops inside (U.S.) keeps them.
  const words = (props.words || []).map((w, i, all) => ({
    atMs: w.atMs,
    text: i === all.length - 1 ? String(w.text).replace(/^([^.]+)\.$/, '$1') : String(w.text),
  }))
  const n = words.length
  if (n === 0) return null
  const firstAt = words[0].atMs
  const lastAt = words[n - 1].atMs

  // The largest size the name can take, on as few lines as earn it: another line only when it
  // buys a markedly larger name.
  const room = width - inset.left - inset.right
  const roomH = height - inset.top - inset.bottom
  const cap = (portrait ? 190 : 210) * unit
  let layout = null
  // The line count is chosen on the phrase-weighted width, the size set by the true one.
  const fit = (w, lines) => Math.min(cap, (0.9 * room) / Math.max(2.5, w), (0.6 * roomH) / (lines * LINE))
  for (let count = 1; count <= Math.min(portrait ? 4 : 3, n); count++) {
    const b = balance(words, count)
    const weighed = fit(b.score, b.lines.length)
    if (layout === null || weighed > layout.weighed * 1.08) {
      layout = { lines: b.lines, widest: b.widest, weighed, size: fit(b.widest, b.lines.length) }
    }
  }
  const size = layout.size
  const hair = Math.max(2, 3 * unit)
  // The whole name stands in quiet grey from the hook; the frame opens promptly as it is read
  // and comes to rest at the name's width as the last word lands. No word settles until the
  // name has faded up, so the first beat reads as two.
  const shown = arrive(frame, fps, 0, motion.ms.enter)
  const readFrom = (atMs) => Math.max(atMs, motion.ms.enter)
  const openFrom = motion.frames(readFrom(firstAt), fps)
  const openRange = [openFrom, Math.max(openFrom + 1, motion.frames(readFrom(lastAt) + motion.ms.reveal, fps))]
  const open =
    (Remotion.interpolate(frame, openRange, [0, 1], { easing: motion.ease.move, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) +
      3 * Remotion.interpolate(frame, openRange, [0, 1], { easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })) /
    4
  const written = sweep(frame, fps, readFrom(lastAt), motion.ms.reveal)
  const lastLine = layout.lines.length - 1
  // The red bar fits the last word: from clear above its ascenders and dots to just below its
  // descenders, or as far below its baseline when it has none. The frame's gaps are measured to
  // the bar, its heaviest mark: under the name always, over it too on a one-line card.
  const deep = (text) => /[gjpqy,;]/.test(text)
  const barDeep = deep(words[n - 1].text)
  const gapTop = (lastLine === 0 ? 0.35 : 0.24) * size
  const gapBottom = (barDeep ? 0.55 : 0.35) * size
  // A line with descenders above the red word gets room, so they never graze its bar.
  const aboveDeep = lastLine > 0 && layout.lines[lastLine - 1].some((w) => deep(w.text))
  // Quiet, but above 3:1 on the ground so the unread name can still be read.
  const quiet = Remotion.withAlpha(colors.textSecondary, 0.6)
  // The hairlines hang on the laid-out name, so the browser sizes them: a little past each side
  // of its widest line, opened from the centre.
  const shut = (1 - open) * 50 + '%'
  const rule = (key, place) => (
    <div key={key} style={{ position: 'absolute', left: '-0.12em', right: '-0.12em', ...place, height: hair, backgroundColor: colors.textSecondary, clipPath: 'inset(0 ' + shut + ' 0 ' + shut + ')' }} />
  )

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: room }}>
        <div style={{ position: 'relative', width: 'max-content', margin: gapTop + hair + 'px 0 ' + (gapBottom + hair) + 'px', textAlign: 'center', fontFamily: fonts.heading, fontWeight: 800, fontSize: size, lineHeight: LINE, letterSpacing: '-0.025em', opacity: shown }}>
          {rule('top', { top: -gapTop - hair })}
          {rule('bottom', { bottom: -gapBottom - hair })}
          {layout.lines.map((line, li) => (
            <div key={'line' + li} style={{ whiteSpace: 'nowrap', marginTop: li === lastLine && aboveDeep ? '0.12em' : 0 }}>
              {line.map((w, wi) => {
                const end = wi === line.length - 1
                // The quiet grey is a colour, not an opacity: a layer with opacity paints over
                // the settled off white one above it and dulls it.
                const still = { gridArea: '1 / 1', color: quiet }
                if (end && li === lastLine) {
                  // The highlighter writes the last word: bar and off white word wiped on together
                  // over the quiet grey one. The bar's reach past the word takes up room, so the
                  // hairlines clear it as they clear the type.
                  return (
                    <span key={'w' + wi} style={{ display: 'inline-grid' }}>
                      <span style={{ ...still, padding: '0 0.06em' }}>{w.text}</span>
                      <span style={{ gridArea: '1 / 1', position: 'relative', padding: '0 0.06em', clipPath: 'inset(-30% ' + (1 - written) * 100 + '% -30% 0)' }}>
                        <span style={{ position: 'absolute', left: 0, right: 0, top: '0.045em', bottom: barDeep ? '-0.155em' : '0.045em', backgroundColor: colors.accent }} />
                        <span style={{ position: 'relative', color: colors.textPrimary }}>{w.text}</span>
                      </span>
                    </span>
                  )
                }
                const read = arrive(frame, fps, readFrom(w.atMs), motion.ms.reveal)
                return (
                  <span key={'w' + wi} style={{ display: 'inline-grid', marginRight: end ? 0 : GAP_EM + 'em' }}>
                    <span style={still}>{w.text}</span>
                    <span style={{ gridArea: '1 / 1', color: colors.textPrimary, opacity: read }}>{w.text}</span>
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </Remotion.AbsoluteFill>
  )
}
