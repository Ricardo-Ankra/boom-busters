// Concept: the memo's words type out one at a time in mono behind a steady caret, as on the
// screen they were written on. The kicker that introduces them is the headline until the quote
// starts, then shrinks upward to a small header. As the last word is typed, the red selection
// sweeps the order in one stroke, as if about to be acted on.

function arrive(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

// The kicker is the words up to the colon; the line is what was written.
function partsOf(words) {
  const colon = words.findIndex((w) => /:$/.test(w.text))
  const end = colon >= 0 ? colon : Math.min(2, words.length - 2)
  return {
    kicker: words.slice(0, end + 1).map((w) => ({ atMs: w.atMs, text: w.text.replace(/:$/, '') })),
    line: words.slice(end + 1).map((w) => ({ atMs: w.atMs, text: w.text })),
  }
}

function toned(text, white, colors) {
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ color: colors.textSecondary }}>{text}</span>
      <span style={{ position: 'absolute', left: 0, top: 0, color: colors.textPrimary, opacity: white }}>{text}</span>
    </span>
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
  const parts = React.useMemo(() => partsOf(props.words), [props.words])
  const line = parts.line
  const n = line.length
  const lineAt = n > 0 ? line[0].atMs : props.durationMs
  const lastAt = n > 0 ? line[n - 1].atMs : props.durationMs

  // The selected phrase is the order's last two words; in portrait it takes a line of its own,
  // so it is never split across lines.
  const marked = Math.min(2, n)
  const groups = [line.slice(0, n - marked), line.slice(n - marked)].filter((g) => g.length > 0)
  const room = width - inset.left - inset.right - 2 * 48 * unit
  const charsOf = (words) => Math.max(6, words.map((w) => w.text).join(' ').length + 2)
  const widest = portrait ? Math.max(...groups.map(charsOf)) : charsOf(line)
  const lineSize = Math.min((portrait ? 104 : 112) * unit, room / (0.6 * widest))
  const lineRows = portrait ? groups.length : 1
  const kickerSize = (portrait ? 36 : 32) * unit
  const kickerGap = 28 * unit

  // Until the quote is due, the kicker is the headline: larger, at the block's centre. Once it is
  // complete it shrinks upward into its header slot and steps back in tone, in one move that
  // settles before the first word of the quote is typed.
  // The shrink moves at once and is all but done within a fifth of a second; its soft tail
  // settles as the quote's first word is typed, so the header hands over to the quote.
  const demoteMs = motion.ms.move
  const demoteAt = lineAt - demoteMs
  const demote = arrive(frame, fps, demoteAt, demoteMs)
  const headline = portrait ? 2 : 2.25
  const drop = (kickerGap + lineRows * 1.25 * lineSize) / 2
  const kickerScale = headline + (1 - headline) * demote

  // The selection starts as the last word is typed, in the caret's place: one stroke across the
  // phrase, off the mark at once and slowing into the last word.
  const selectAt = lastAt
  const s = arrive(frame, fps, selectAt, motion.ms.move + motion.ms.micro / 2)
  const shares = line.slice(n - marked).map((w) => w.text.length + 1)
  const total = shares.reduce((a, b) => a + b, 0) || 1
  const partOf = (k) => {
    let from = 0
    for (let j = 0; j < k; j++) from += shares[j] / total
    const to = from + shares[k] / total
    return Math.max(0, Math.min(1, (s - from) / (to - from)))
  }
  // The caret waits after the last word typed and gives way to the selection.
  const typed = line.filter((w) => frame >= motion.frames(w.atMs, fps)).length
  const caretOn = typed > 0 && frame < motion.frames(selectAt, fps)
  const caretIn = arrive(frame, fps, lineAt, motion.ms.micro)

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: room }}>
        <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: kickerSize, letterSpacing: '0.24em', textTransform: 'uppercase', marginBottom: kickerGap, whiteSpace: 'nowrap', transformOrigin: 'left center', transform: 'translateY(' + (1 - demote) * drop + 'px) scale(' + kickerScale + ')' }}>
          {parts.kicker.map((w, i) => {
            const enter = arrive(frame, fps, w.atMs, motion.ms.enter)
            const white = arrive(frame, fps, w.atMs, motion.ms.enter) * (1 - demote)
            return (
              <span key={'k' + w.atMs} style={{ display: 'inline-block', marginRight: i === parts.kicker.length - 1 ? 0 : '0.5em', opacity: enter }}>
                {toned(w.text, white, colors)}
              </span>
            )
          })}
        </div>
        <div style={{ position: 'relative', display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: 'flex-start', fontFamily: fonts.numbers, fontWeight: 700, fontSize: lineSize, lineHeight: 1.25, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
          {groups.map((group, g) => (
            <div key={'g' + g} style={{ display: 'flex', marginRight: !portrait && g === 0 && groups.length > 1 ? '0.6em' : 0 }}>
              {group.map((w, gi) => {
                const i = line.indexOf(w)
                const shown = frame >= motion.frames(w.atMs, fps) ? 1 : 0
                const last = i === n - 1
                // The last word settles quicker: the selection runs behind it at once.
                const white = arrive(frame, fps, w.atMs + motion.ms.micro, last ? motion.ms.enter : motion.ms.reveal)
                const k = i - (n - marked)
                const hi = k >= 0 ? partOf(k) : 0
                const first = i === 0
                const groupLast = gi === group.length - 1
                const text = (first ? '“' : '') + w.text + (last ? '”' : '')
                const lineStart = gi === 0 && (portrait || g === 0)
                return (
                  <span key={'w' + w.atMs} style={{ position: 'relative', display: 'inline-block', marginRight: groupLast ? 0 : '0.6em', marginLeft: first ? '-0.6em' : 0, opacity: shown }}>
                    {k >= 0 ? (
                      <span style={{ position: 'absolute', left: first ? '0.5em' : lineStart ? 0 : '-0.12em', right: last ? '-0.12em' : groupLast ? 0 : '-0.72em', top: '0.08em', bottom: '0.04em', backgroundColor: colors.accent, clipPath: 'inset(0 ' + (1 - hi) * 100 + '% 0 0)' }} />
                    ) : null}
                    <span style={{ position: 'relative' }}>{toned(text, white, colors)}</span>
                    {caretOn && i === typed - 1 ? (
                      <span style={{ position: 'absolute', left: '100%', marginLeft: '0.14em', top: '0.2em', width: '0.09em', height: '0.92em', backgroundColor: colors.textPrimary, opacity: caretIn }} />
                    ) : null}
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
