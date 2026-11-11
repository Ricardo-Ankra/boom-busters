// Concept: one word built once and kept. Nobody stays where it lands; each verb after it arrives
// on a flat drum, the roll lifting the verb before it a line, a touch smaller and quieter, until
// the last verb lands in red.

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
const clamp01 = (v) => Math.min(1, Math.max(0, v))
const keyOf = (text) => String(text).toLowerCase().replace(/[^a-z]/g, '')

// The kept word is the first word; what is said after each saying of it is one phrase on the drum.
function partsOf(words) {
  if (words.length === 0) return { kept: null, phrases: [] }
  const kept = { atMs: words[0].atMs, text: String(words[0].text).replace(/[,;:.!?]+$/, '') }
  const phrases = []
  let phrase = null
  for (const w of words.slice(1)) {
    if (keyOf(w.text) === keyOf(kept.text)) {
      // The kept word said again: the phrase before it has been heard and steps back.
      if (phrase) phrase.repeatMs = w.atMs
      phrase = null
      continue
    }
    if (!phrase) {
      phrase = { atMs: w.atMs, text: String(w.text) }
      phrases.push(phrase)
    } else {
      phrase.text += ' ' + String(w.text)
    }
  }
  return { kept, phrases }
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height, fps } = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080
  const parts = React.useMemo(() => partsOf(props.words || []), [props.words])
  const kept = parts.kept
  const phrases = parts.phrases
  const n = phrases.length
  const longest = phrases.reduce((best, p) => (p.text.length > best.length ? p.text : best), '')

  const room = width - inset.left - inset.right - 2 * 48 * unit
  const chars = (kept ? kept.text.length : 0) + 1 + longest.length
  const size = Math.min((portrait ? 112 : 128) * unit, room / (0.6 * Math.max(1, chars)))
  const rowH = size * 1.2
  const pitch = rowH * 0.92

  // The drum turns once for each phrase, landing it on the turning line as it is spoken. A turn
  // starts as the kept word is said again, so the repeat is what turns the drum; the first turn,
  // with no repeat before it, starts a beat and a half ahead.
  let roll = 0
  for (let k = 0; k < n; k++) {
    const before = k > 0 ? phrases[k - 1].repeatMs : undefined
    const startMs = before !== undefined ? before : phrases[k].atMs - 1.5 * motion.ms.move
    roll += shift(frame, fps, startMs, Math.max(motion.ms.move, phrases[k].atMs - startMs))
  }
  const keptIn = kept ? arrive(frame, fps, kept.atMs, motion.ms.enter) : 0
  const keptWhite = kept ? arrive(frame, fps, kept.atMs + motion.ms.micro, motion.ms.reveal) : 0
  // The finished stack is centred in the safe area, so the line the drum turns at sits below centre.
  const lift = (Math.max(0, n - 1) * pitch) / 2
  // The drum's window: the turning line and the lines above it, clipped at the turning line's
  // foot so a new phrase rolls up from under it, and fading out at the top for anything carried
  // past the last line.
  const windowTop = (Math.max(0, n - 1) + 0.6) * pitch
  const fade = 'linear-gradient(to bottom, transparent 0%, ' + colors.textPrimary + ' 12%)'

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', transform: 'translateY(' + lift + 'px)', fontFamily: fonts.heading, fontWeight: 800, fontSize: size, lineHeight: 1.2, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
        {kept ? (
          <div style={{ position: 'relative', height: rowH, opacity: keptIn, transform: 'translateY(' + (1 - keptIn) * motion.px.rise * unit + 'px)' }}>
            <span style={{ color: colors.textSecondary }}>{kept.text}</span>
            <span style={{ position: 'absolute', left: 0, top: 0, color: colors.textPrimary, opacity: keptWhite }}>{kept.text}</span>
          </div>
        ) : null}
        <div style={{ position: 'relative', height: rowH, marginLeft: '0.28em' }}>
          <span style={{ visibility: 'hidden' }}>{longest}</span>
          <div style={{ position: 'absolute', left: 0, right: '-0.5em', top: -windowTop, height: windowTop + rowH, overflow: 'hidden', maskImage: fade, WebkitMaskImage: fade }}>
            {phrases.map((p, k) => {
              // How far the drum has carried this phrase: under the turning line before its turn,
              // 0 in the line beside the kept word, then one line up per later phrase. It stays
              // unseen until it is well inside the window, so no letter tips show at its edge.
              const age = roll - (k + 1)
              const appear = clamp01(1 + 1.6 * age)
              const rise = 0
              const scale = Math.pow(0.85, Math.max(0, age))
              const heard = p.repeatMs === undefined ? 0 : arrive(frame, fps, p.repeatMs, motion.ms.micro)
              const white = arrive(frame, fps, p.atMs + motion.ms.micro, motion.ms.reveal) * (1 - Math.max(heard, clamp01(age)))
              const pale = clamp01(age - 1)
              const last = k === n - 1
              return (
                <div key={'p' + k} style={{ position: 'absolute', left: 0, top: windowTop, height: rowH, transform: 'translateY(' + (rise - age * pitch) + 'px) scale(' + scale + ')', transformOrigin: 'left center', opacity: appear * (1 - 0.3 * pale) }}>
                  <span style={{ color: colors.textSecondary }}>{p.text}</span>
                  <span style={{ position: 'absolute', left: 0, top: 0, color: last ? colors.accent : colors.textPrimary, opacity: white }}>{p.text}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Remotion.AbsoluteFill>
  )
}
