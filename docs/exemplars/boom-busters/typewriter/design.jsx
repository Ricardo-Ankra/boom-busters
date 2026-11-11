// Concept: the memo is typed out a letter at a time behind a steady caret, each word as it is
// spoken, as on the screen it was written on. The kicker that introduces it types in as the
// headline, then shrinks upward to a small header as the quote is due, and the quote types in
// mono beneath it. As its last letter lands, the red selection sweeps the order in one stroke,
// as if about to be acted on.

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

// The kicker is the words up to the colon; the line is what was written.
function partsOf(words) {
  const colon = words.findIndex((w) => /:$/.test(w.text))
  const end = colon >= 0 ? colon : Math.min(2, words.length - 2)
  return {
    kicker: words.slice(0, end + 1).map((w) => ({ atMs: w.atMs, text: w.text.replace(/:$/, '') })),
    line: words.slice(end + 1).map((w) => ({ atMs: w.atMs, text: w.text })),
  }
}

// Each word types at an even hand from the moment it is spoken, about a letter a frame, and is
// always typed before the next word is due (a run's last word, before untilMs).
function paced(words, untilMs) {
  return words.map((w, i) => {
    const nextMs = i + 1 < words.length ? words[i + 1].atMs : untilMs
    const room = (nextMs - w.atMs - motion.ms.micro) / Math.max(1, w.text.length)
    const pace = Math.max(1, Math.min(motion.ms.reveal / 10, room))
    return { atMs: w.atMs, text: w.text, pace, doneMs: w.atMs + (w.text.length - 1) * pace }
  })
}

// How many of a word's letters are typed at a frame: the first as it is spoken, then one a pace.
function typedOf(frame, fps, word) {
  const ms = (frame * 1000) / fps
  if (ms < word.atMs) return 0
  return Math.min(word.text.length, 1 + Math.floor((ms - word.atMs) / word.pace))
}

// A word laid out whole from the start, so nothing moves as it types: the letters not yet typed
// hold their place unseen. Typed letters arrive grey and the word settles to off white as it
// completes; the caret, when it is here, rides the last letter typed.
function typed(text, count, white, colors, caret) {
  const shown = text.slice(0, count)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ visibility: 'hidden' }}>{text}</span>
      <span style={{ position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap', color: colors.textSecondary }}>
        {shown}
        {caret}
      </span>
      <span style={{ position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap', color: colors.textPrimary, opacity: white }}>{shown}</span>
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

  // The selected phrase is the order's last two words; in portrait it takes a line of its own,
  // so it is never split across lines.
  const marked = Math.min(2, n)
  const groups = [line.slice(0, n - marked), line.slice(n - marked)].filter((g) => g.length > 0)
  const room = width - inset.left - inset.right - 2 * 48 * unit
  const charsOf = (words) => Math.max(6, words.map((w) => w.text).join(' ').length + 2)
  const widest = portrait ? Math.max(...groups.map(charsOf)) : charsOf(line)
  // In 16:9 the quote takes at most four fifths of the room, so generous margins stay
  // whatever the quote's length; in 9:16 the width is the limit.
  const lineSize = Math.min((portrait ? 104 : 112) * unit, ((portrait ? 1 : 0.8) * room) / (0.6 * widest))
  const lineRows = portrait ? groups.length : 1
  const kickerSize = (portrait ? 36 : 32) * unit
  const kickerGap = 28 * unit

  // Until the quote is due, the kicker is the headline: larger, at the block's centre. Once it is
  // typed it shrinks upward into its header slot and steps back in tone, in one smooth move that
  // lands just before the first letter of the quote is typed.
  const demoteMs = motion.ms.move + motion.ms.enter
  const demoteAt = lineAt - demoteMs - motion.ms.micro / 2
  const demote = shift(frame, fps, demoteAt, demoteMs)
  const headline = portrait ? 2 : 2.6
  const drop = (kickerGap + lineRows * 1.25 * lineSize) / 2
  const kickerScale = headline + (1 - headline) * demote

  // What is typed: the kicker, finished before it moves; then the quote in its marks, its last
  // letter typed early enough for the selection to land before the end.
  const kickerKeys = paced(parts.kicker, demoteAt)
  const lineKeys = paced(
    line.map((w, i) => ({ atMs: w.atMs, text: (i === 0 ? '“' : '') + w.text + (i === n - 1 ? '”' : '') })),
    props.durationMs - motion.ms.reveal - motion.ms.micro,
  )
  const counts = kickerKeys.concat(lineKeys).map((key) => typedOf(frame, fps, key))
  const current = counts.reduce((at, count, i) => (count > 0 ? i : at), -1)

  // The selection takes over from the caret as the last letter lands: one smooth stroke from the
  // phrase's first letter that gathers and slows into the last word, the channel's highlighter sweep.
  const selectAt = n > 0 ? lineKeys[n - 1].doneMs : props.durationMs
  const s = shift(frame, fps, selectAt, motion.ms.reveal)
  const shares = line.slice(n - marked).map((w) => w.text.length + 1)
  const total = shares.reduce((a, b) => a + b, 0) || 1
  const partOf = (k) => {
    let from = 0
    for (let j = 0; j < k; j++) from += shares[j] / total
    const to = from + shares[k] / total
    return Math.max(0, Math.min(1, (s - from) / (to - from)))
  }

  // The caret is steady: it rides the last letter typed, waits there between words, moves to the
  // quote with its first letter and gives way to the selection.
  const caretOn = current >= 0 && (frame * 1000) / fps < selectAt
  const caret = (gap) => (
    <span style={{ position: 'absolute', left: '100%', marginLeft: gap, top: '0.2em', width: '0.09em', height: '0.92em', backgroundColor: colors.textPrimary }} />
  )

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: room }}>
        <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: kickerSize, lineHeight: 1.25, letterSpacing: '0.24em', textTransform: 'uppercase', marginBottom: kickerGap, whiteSpace: 'nowrap', transformOrigin: 'left center', transform: 'translateY(' + (1 - demote) * drop + 'px) scale(' + kickerScale + ')' }}>
          {kickerKeys.map((key, i) => {
            const white = arrive(frame, fps, key.atMs, key.doneMs - key.atMs + motion.ms.micro) * (1 - demote)
            return (
              <span key={'k' + key.atMs} style={{ display: 'inline-block', marginRight: i === kickerKeys.length - 1 ? 0 : '0.5em' }}>
                {typed(key.text, counts[i], white, colors, caretOn && current === i ? caret('-0.18em') : null)}
              </span>
            )
          })}
        </div>
        <div style={{ position: 'relative', display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: 'flex-start', fontFamily: fonts.numbers, fontWeight: 700, fontSize: lineSize, lineHeight: 1.25, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
          {groups.map((group, g) => (
            <div key={'g' + g} style={{ display: 'flex', marginRight: !portrait && g === 0 && groups.length > 1 ? '0.6em' : 0 }}>
              {group.map((w, gi) => {
                const i = line.indexOf(w)
                const key = lineKeys[i]
                const at = kickerKeys.length + i
                const last = i === n - 1
                const white = arrive(frame, fps, key.atMs, key.doneMs - key.atMs + motion.ms.micro)
                const k = i - (n - marked)
                const hi = k >= 0 ? partOf(k) : 0
                const first = i === 0
                const groupLast = gi === group.length - 1
                return (
                  <span key={'w' + w.atMs} style={{ position: 'relative', display: 'inline-block', marginRight: groupLast ? 0 : '0.6em', marginLeft: first ? '-0.6em' : 0 }}>
                    {k >= 0 ? (
                      <span style={{ position: 'absolute', left: first ? '0.5em' : '-0.12em', right: last ? '-0.12em' : groupLast ? 0 : '-0.72em', top: '0.08em', bottom: '-0.04em', backgroundColor: colors.accent, clipPath: 'inset(0 ' + (1 - hi) * 100 + '% 0 0)' }} />
                    ) : null}
                    {typed(key.text, counts[at], white, colors, caretOn && current === at ? caret('0.07em') : null)}
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
