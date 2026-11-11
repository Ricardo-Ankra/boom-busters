// Concept: one claim builds at the centre and takes its red mark as its last word lands. Once
// marked it slides aside into its half; the pivot word lands in the space it leaves (just under
// the line in 16:9, at the middle in 9:16), closes from both ends to a sliver, and the dashed seam
// grows out of the sliver across the frame. The second claim builds opposite with the same red
// mark on its last word, so the halves mirror each other and only the words differ.

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

// The two claims either side of the pivot: the word after the first comma, else the middle word.
function partsOf(words) {
  const comma = words.findIndex((w) => /,$/.test(String(w.text)))
  const at = comma >= 0 && comma + 1 < words.length ? comma + 1 : Math.floor(words.length / 2)
  const clean = (w) => ({ atMs: w.atMs, text: String(w.text).replace(/[,;:.!?]+$/, '') })
  return {
    left: words.slice(0, at).map(clean),
    pivot: words[at] ? clean(words[at]) : null,
    right: words.slice(at + 1).map(clean),
  }
}

// A dashed line drawn from its start, so its dashes stay put while it is revealed.
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
  const parts = React.useMemo(() => partsOf(props.words || []), [props.words])

  const W = width - inset.left - inset.right
  const H = height - inset.top - inset.bottom
  const chars = Math.max(4, ...[parts.left, parts.right].map((side) => side.map((w) => w.text).join(' ').length))
  // In 16:9 each claim fits its half; in 9:16 the halves stack, so each claim has the width.
  const size = portrait
    ? Math.min(104 * unit, (W - 96 * unit) / (0.56 * chars))
    : Math.min(100 * unit, (W / 2 - 96 * unit) / (0.56 * chars))

  const pivotAt = parts.pivot ? parts.pivot.atMs : parts.right.length > 0 ? parts.right[0].atMs - motion.ms.reveal : props.durationMs / 2
  // One beat at a time. The claim, once marked, slides aside into its half; the pivot lands in
  // the space it leaves; then the pivot, whole and undistorted, closes from both ends toward its
  // centre like a curtain, and the seam grows out of the closing sliver before it is gone, so the
  // word hands straight over to the divider.
  const leftLast = parts.left.length > 0 ? parts.left[parts.left.length - 1].atMs : 0
  const slideMs = motion.ms.move + motion.ms.micro / 2
  const slideAt = Math.min(leftLast + motion.ms.reveal, pivotAt - slideMs / 2)
  const slide = shift(frame, fps, slideAt, slideMs)
  const foldAt = pivotAt + motion.ms.enter + motion.ms.micro / 2
  const foldMs = motion.ms.move
  const fold = shift(frame, fps, foldAt, foldMs)
  const seam = arrive(frame, fps, foldAt + foldMs * 0.6, motion.ms.move)
  const rightAt = parts.right.length > 0 ? parts.right[0].atMs : props.durationMs
  const stepBack = dim(frame, fps, rightAt, motion.ms.micro)

  // Before the split the claim and the pivot sit as one unit at the middle; after it, the claims
  // face each other across the seam, left and right in 16:9, above and below in 9:16.
  const cx = W / 2
  const cy = H / 2
  // In 16:9 the claims hang off the seam by the same gap, so the halves mirror exactly; in 9:16
  // each is centred in its half.
  const halfH = H / 4
  // The gap from the seam allows for the highlighter's overhang on the left claim's last word.
  const gap = size * 0.5
  // The claim builds at the middle; the pivot lands where it was in 9:16, and in 16:9 just under
  // the line, clear of the claim that now hangs off the seam.
  const leftFrom = [cx, cy]
  const leftTo = portrait ? [cx, cy - halfH] : [cx - gap - size * 0.1, cy]
  const rightPos = portrait ? [cx, cy + halfH] : [cx + gap, cy]
  const pivotPos = portrait ? [cx, cy] : [cx, cy + size * 1.2]
  const leftPos = [leftFrom[0] + (leftTo[0] - leftFrom[0]) * slide, leftFrom[1] + (leftTo[1] - leftFrom[1]) * slide]
  const leftAnchor = portrait ? -50 : -50 - 50 * slide
  const rightAnchor = portrait ? -50 : 0

  const claim = (side, pos, key, stepped, anchor) => (
    <div key={key} style={{ position: 'absolute', left: pos[0], top: pos[1], transform: 'translate(' + anchor + '%, -50%)', whiteSpace: 'nowrap', fontFamily: fonts.heading, fontWeight: 800, fontSize: size, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
      {side.map((w, j) => {
        const marked = j === side.length - 1
        const appear = arrive(frame, fps, w.atMs, motion.ms.enter)
        // The marked word settles as it appears, so its highlighter runs behind grey for a moment at most.
        const white = marked ? appear : arrive(frame, fps, w.atMs + motion.ms.micro, motion.ms.reveal) * (1 - stepped)
        // The sweep starts with the word, so the word and its mark land as one gesture.
        const sweep = marked ? shift(frame, fps, w.atMs, motion.ms.reveal) : 0
        const text = j === 0 ? w.text.charAt(0).toUpperCase() + w.text.slice(1) : w.text
        return (
          <span key={'w' + j} style={{ position: 'relative', display: 'inline-block', marginRight: marked ? 0 : '0.26em', opacity: appear, transform: 'translateY(' + (1 - appear) * motion.px.rise * unit + 'px)' }}>
            {marked ? (
              <span style={{ position: 'absolute', left: '-0.1em', right: '-0.1em', top: '0.1em', bottom: '0.02em', backgroundColor: colors.accent, clipPath: 'inset(0 ' + (1 - sweep) * 100 + '% 0 0)' }} />
            ) : null}
            <span style={{ position: 'relative', color: colors.textSecondary }}>{text}</span>
            <span style={{ position: 'absolute', left: 0, top: 0, color: colors.textPrimary, opacity: white }}>{text}</span>
          </span>
        )
      })}
    </div>
  )

  // The seam draws out of the folded pivot, both ways at once, dashes fixed as it is revealed.
  const stroke = Math.max(3, 4 * unit)
  const seamColor = Remotion.withAlpha(colors.textSecondary, 0.8)
  const reach = portrait ? [48 * unit, W - 48 * unit] : [0, H]
  const from = portrait ? pivotPos[0] : pivotPos[1]
  const near = (1 - seam) * (from - reach[0])
  const far = (1 - seam) * (reach[1] - from)
  const pivotIn = parts.pivot ? arrive(frame, fps, parts.pivot.atMs, motion.ms.enter) : 0

  return (
    <Remotion.AbsoluteFill style={{ paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left }}>
      <div style={{ position: 'relative', width: W, height: H }}>
        {seam > 0 ? (
          portrait ? (
            <div style={{ position: 'absolute', left: reach[0], width: reach[1] - reach[0], top: cy - stroke / 2, height: stroke, backgroundImage: dashes(seamColor, 'to right', 14 * unit, 10 * unit), clipPath: 'inset(0 ' + far + 'px 0 ' + near + 'px)' }} />
          ) : (
            <div style={{ position: 'absolute', top: reach[0], height: reach[1] - reach[0], left: cx - stroke / 2, width: stroke, backgroundImage: dashes(seamColor, 'to bottom', 14 * unit, 10 * unit), clipPath: 'inset(' + near + 'px 0 ' + far + 'px 0)' }} />
          )
        ) : null}
        {claim(parts.left, leftPos, 'left', stepBack, leftAnchor)}
        {parts.pivot && fold < 1 ? (
          <div style={{ position: 'absolute', left: pivotPos[0], top: pivotPos[1], transform: 'translate(-50%, -50%) translateY(' + (1 - pivotIn) * motion.px.rise * unit + 'px)', clipPath: portrait ? 'inset(' + fold * 50 + '% 0 ' + fold * 50 + '% 0)' : 'inset(0 ' + fold * 50 + '% 0 ' + fold * 50 + '%)', opacity: pivotIn, whiteSpace: 'nowrap', fontFamily: fonts.heading, fontWeight: 800, fontSize: size, lineHeight: 1.15, letterSpacing: '-0.02em', color: colors.textPrimary }}>
            {parts.pivot.text}
          </div>
        ) : null}
        {claim(parts.right, rightPos, 'right', 0, rightAnchor)}
      </div>
    </Remotion.AbsoluteFill>
  )
}
