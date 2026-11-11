// Concept: one thin red rule is the seam and it comes first. It draws out in one stroke to the
// block's full width, the name rising out from behind it as the edge passes each word, then the
// role drops out below it word by word as it is spoken. One width, one gesture, then a hold.

function arrive(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}
function draw(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.move, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

// The name is the words up to the first comma; the role is the rest. Straight quotes curl.
function partsOf(words) {
  const comma = words.findIndex((w) => /,$/.test(w.text))
  const end = comma >= 0 ? comma : Math.min(1, words.length - 1)
  const clean = (w) => ({ atMs: w.atMs, text: w.text.replace(/[,.]$/, '').replace(/'/g, '’') })
  return { name: words.slice(0, end + 1).map(clean), role: words.slice(end + 1).map(clean) }
}

// A word that appears grey and settles to off white.
function toned(text, settle, colors) {
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ color: colors.textSecondary }}>{text}</span>
      <span style={{ position: 'absolute', left: 0, top: 0, color: colors.textPrimary, opacity: settle }}>{text}</span>
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
  const unit = (Math.min(width, height) / 1080) * (portrait ? 1.25 : 1)
  const parts = React.useMemo(() => partsOf(props.words), [props.words])

  // Each tier at its size, or smaller when a long name or role would not fit the room.
  const room = width - inset.left - inset.right - 2 * 48 * unit
  const charsOf = (words) => Math.max(4, words.map((w) => w.text).join(' ').length)
  const nameSize = Math.min(92 * unit, (0.95 * room) / (0.62 * charsOf(parts.name)))
  const roleSize = Math.min(40 * unit, (0.95 * room) / (0.86 * charsOf(parts.role)))
  const seam = 14 * unit
  const nameType = { fontFamily: fonts.heading, fontWeight: 800, fontSize: nameSize, letterSpacing: '-0.025em', whiteSpace: 'nowrap' }
  const roleType = { fontFamily: fonts.body, fontWeight: 600, fontSize: roleSize, letterSpacing: '0.16em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
  const ruleH = Math.max(2, 5 * unit)
  const gap = '0.28em'

  // The rule draws first, in one stroke across the whole block; each name word rises as the
  // edge reaches its start, the first one a beat behind the stroke's start.
  const strokeMs = motion.ms.move
  const stroke = draw(frame, fps, 0, strokeMs)
  const nameChars = Math.max(1, parts.name.map((w) => w.text).join(' ').length)
  let before = 0
  const nameAt = parts.name.map((w) => {
    const passed = Math.max(motion.ms.enter, (before / nameChars) * strokeMs)
    before += w.text.length + 1
    return Math.max(w.atMs, passed)
  })

  // The rule's row stretches to the column, which the browser sizes to the wider of the two
  // lines, so the stroke ends exactly at the block's edge.
  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'flex-end', alignItems: 'flex-start',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginLeft: 48 * unit, marginBottom: 40 * unit }}>
        <div style={{ clipPath: 'inset(-40% -10% 0 -10%)', paddingBottom: seam, lineHeight: 1.12, ...nameType }}>
          {parts.name.map((w, i) => {
            const rise = arrive(frame, fps, nameAt[i], motion.ms.reveal)
            const settle = arrive(frame, fps, nameAt[i] + motion.ms.micro, motion.ms.reveal)
            return (
              <span key={'n' + w.atMs} style={{ display: 'inline-block', paddingRight: i === parts.name.length - 1 ? 0 : gap, transform: 'translateY(' + ((1 - rise) * 1.12 * nameSize + (1 - rise) * seam) + 'px)' }}>
                {toned(w.text, settle, colors)}
              </span>
            )
          })}
        </div>
        <div style={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: ruleH, width: (stroke * 100).toFixed(3) + '%', backgroundColor: colors.accent }} />
        </div>
        <div style={{ clipPath: 'inset(0 -10% -40% -10%)', marginTop: seam, lineHeight: 1.25, ...roleType }}>
          {parts.role.map((w, i) => {
            const drop = arrive(frame, fps, w.atMs, motion.ms.reveal)
            const settle = arrive(frame, fps, w.atMs + motion.ms.micro, motion.ms.enter)
            return (
              <span key={'r' + w.atMs} style={{ display: 'inline-block', paddingRight: i === parts.role.length - 1 ? 0 : gap, transform: 'translateY(' + (drop - 1) * 1.3 * roleSize + 'px)' }}>
                {toned(w.text, settle, colors)}
              </span>
            )
          })}
        </div>
      </div>
    </Remotion.AbsoluteFill>
  )
}
