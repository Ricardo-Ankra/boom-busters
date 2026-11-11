// Concept: the quotation's own opening mark is the first thing on screen, large, and it settles
// into the margin as the quotation builds beside it, where it stays as the card's anchor. As the
// last word lands a highlighter sweeps the claim; then a rule drawn down out of the mark turns to
// the attribution and names who said it.

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

// The quotation runs to the word that closes it; what follows says who said it.
function partsOf(words) {
  const close = words.findIndex((w) => /["”]$/.test(String(w.text)))
  const end = close >= 0 ? close : words.length - 1
  const strip = (t) => String(t).replace(/^["“]/, '').replace(/["”]$/, '')
  return {
    quote: words.slice(0, end + 1).map((w) => ({ atMs: w.atMs, text: strip(w.text) })),
    by: words.slice(end + 1).map((w) => ({ atMs: w.atMs, text: String(w.text).replace(/[.,;:!?]+$/, '') })),
  }
}

// The quotation's lines, filled greedily to a budget of characters, so each line's end is known.
function linesOf(words, budget) {
  const lines = []
  let line = []
  let chars = 0
  for (const w of words) {
    const add = (line.length > 0 ? 1 : 0) + w.text.length
    if (line.length > 0 && chars + add > budget) {
      lines.push(line)
      line = []
      chars = 0
    }
    chars += (line.length > 0 ? 1 : 0) + w.text.length
    line.push(w)
  }
  if (line.length > 0) lines.push(line)
  return lines
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
  const quote = parts.quote
  const by = parts.by
  const n = quote.length

  const room = width - inset.left - inset.right - 2 * 48 * unit
  const quoteSize = (portrait ? 92 : 112) * unit
  const lineH = quoteSize * 1.15
  // The hanging mark stands well above the first line's capitals; its column is the margin.
  const markSize = quoteSize * 3
  const markRight = markSize * 0.5
  const gutter = markRight + quoteSize * 0.45
  // The quotation sets as a card: in 16:9 two balanced lines, which leaves the margin room for
  // the mark to arrive large; in 9:16 as many lines as the width needs.
  const quoteChars = quote.map((w) => w.text).join(' ').length + 1
  const fits = Math.max(8, Math.floor((room - gutter) / (0.56 * quoteSize)))
  const longest = Math.max(1, ...quote.map((w) => w.text.length + 1))
  const budget = portrait || n < 3 ? fits : Math.min(fits, Math.max(longest, Math.ceil(quoteChars / 2) + 1))
  const lines = linesOf(quote, budget)
  const quoteW = Math.max(...lines.map((line) => line.map((w) => w.text).join(' ').length + 1)) * 0.56 * quoteSize
  const bySize = 44 * unit

  // The mark arrives large and settles slowly to its hanging size as the first words build,
  // scaling from its corner so it never crosses the words.
  const firstAt = n > 0 ? quote[0].atMs : 0
  const markIn = arrive(frame, fps, firstAt, motion.ms.enter)
  const settle = shift(frame, fps, firstAt + motion.ms.micro, 3 * motion.ms.move)
  const big = portrait ? 1.7 : 2
  const markScale = big + (1 - big) * settle

  // The claim is the quotation's last two words; one sweep runs behind them as the last word
  // lands, shared out by length.
  const marked = Math.min(2, Math.max(1, n - 1))
  const firstMarked = n - marked
  const lastAt = n > 0 ? quote[n - 1].atMs : props.durationMs
  const sweep = shift(frame, fps, lastAt + motion.ms.micro, motion.ms.reveal)
  const shares = quote.slice(firstMarked).map((w) => w.text.length + 1)
  const total = shares.reduce((a, b) => a + b, 0) || 1
  const partOf = (k) => {
    let from = 0
    for (let j = 0; j < k; j++) from += shares[j] / total
    return Math.max(0, Math.min(1, (sweep - from) / (shares[k] / total)))
  }

  // The attribution: once the sweep has landed, a rule drawn down out of the mark's foot turns to
  // where the speaker's name will be, in place as it is spoken; the unmarked words of the
  // quotation step back a beat later, on the name's second word.
  const byAt = by.length > 0 ? by[0].atMs : null
  const ruleAt = lastAt + motion.ms.reveal
  const drop = byAt === null ? 0 : shift(frame, fps, ruleAt, motion.ms.move)
  const turn = byAt === null ? 0 : shift(frame, fps, ruleAt + motion.ms.move, motion.ms.enter)
  const stepAt = by.length > 1 ? by[1].atMs : byAt === null ? props.durationMs : byAt + motion.ms.reveal
  const stepBack = byAt === null ? 0 : dim(frame, fps, stepAt, motion.ms.reveal)
  // In 9:16 the attribution breaks into two even lines rather than leaving a word alone.
  const byText = by.map((w) => w.text).join(' ')
  const byWide = byText.length * 0.82 * bySize > quoteW
  const byLines = portrait && byWide ? linesOf(by, Math.ceil(byText.length / 2) + 1) : [by]
  const stroke = Math.max(3, 4 * unit)
  const ruleX = markRight - markSize * 0.2
  const ruleTop = markSize * 0.42
  const byTop = lines.length * lineH + quoteSize * 0.55
  const byMiddle = byTop + bySize * 0.65
  let index = -1

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ position: 'relative', paddingLeft: gutter, maxWidth: room }}>
        <div style={{ position: 'absolute', left: 0, width: markRight, top: 0.12 * markSize, textAlign: 'right', fontFamily: fonts.heading, fontWeight: 800, fontSize: markSize, lineHeight: 0.6, color: colors.textSecondary, opacity: markIn, transform: 'scale(' + markScale + ')', transformOrigin: 'right top' }}>
          “
        </div>
        {by.length > 0 ? (
          <React.Fragment>
            <div style={{ position: 'absolute', left: ruleX - stroke / 2, top: ruleTop, width: stroke, height: byMiddle - ruleTop, backgroundColor: colors.textSecondary, transformOrigin: 'center top', transform: 'scaleY(' + drop + ')' }} />
            <div style={{ position: 'absolute', left: ruleX - stroke / 2, top: byMiddle - stroke / 2, width: gutter - ruleX - quoteSize * 0.12, height: stroke, backgroundColor: colors.textSecondary, transformOrigin: 'left center', transform: 'scaleX(' + turn + ')' }} />
          </React.Fragment>
        ) : null}
        <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: quoteSize, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
          {lines.map((line, l) => (
            <div key={'line' + l} style={{ display: 'flex', whiteSpace: 'nowrap' }}>
              {line.map((w, j) => {
                index += 1
                const i = index
                const k = i - firstMarked
                const endOfLine = j === line.length - 1
                const appear = arrive(frame, fps, w.atMs, motion.ms.enter)
                // The claim's words arrive settled, so the red never runs behind grey.
                const white = k >= 0 ? appear : arrive(frame, fps, w.atMs + motion.ms.micro, motion.ms.reveal) * (1 - stepBack)
                return (
                  <React.Fragment key={'w' + i}>
                    <span style={{ position: 'relative', display: 'inline-block', marginRight: endOfLine ? 0 : '0.26em', opacity: appear, transform: 'translateY(' + (1 - appear) * motion.px.rise * unit + 'px)' }}>
                      {k >= 0 ? (
                        <span style={{ position: 'absolute', left: '-0.1em', right: i === n - 1 || endOfLine ? '-0.1em' : '-0.36em', top: '0.06em', bottom: '-0.08em', backgroundColor: colors.accent, clipPath: 'inset(0 ' + (1 - partOf(k)) * 100 + '% 0 0)' }} />
                      ) : null}
                      <span style={{ position: 'relative', color: colors.textSecondary }}>{w.text}</span>
                      <span style={{ position: 'absolute', left: 0, top: 0, color: colors.textPrimary, opacity: white }}>{w.text}</span>
                    </span>
                    {i === n - 1 ? (
                      <span style={{ display: 'inline-block', marginLeft: '0.14em', color: colors.textSecondary, opacity: appear }}>”</span>
                    ) : null}
                  </React.Fragment>
                )
              })}
            </div>
          ))}
        </div>
        {by.length > 0 ? (
          <div style={{ marginTop: quoteSize * 0.55, fontFamily: fonts.body, fontWeight: 600, fontSize: bySize, lineHeight: 1.3, letterSpacing: '0.18em', textTransform: 'uppercase', color: colors.textSecondary }}>
            {byLines.map((line, l) => (
              <div key={'by' + l} style={{ whiteSpace: 'nowrap' }}>
                {line.map((w, j) => {
                  const inW = arrive(frame, fps, w.atMs, motion.ms.enter)
                  return (
                    <span key={'b' + j} style={{ display: 'inline-block', marginRight: j === line.length - 1 ? 0 : '0.5em', opacity: inW, transform: 'translateY(' + (1 - inW) * motion.px.rise * unit + 'px)' }}>
                      {w.text}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Remotion.AbsoluteFill>
  )
}
