// Concept: the steps are walked along one hairline. The line is laid first; as each step is
// named its ordinal settles over its ring, the off white line draws on from the last ring and
// reaches this one as the step's word is spoken, and the ring lights. The walked steps step back
// in stages. The last ring waits hollow in red until the line slows into it, and fills as its
// word lands under a red highlighter, one beat.

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'then', 'next', 'finally', 'lastly', 'last']
const ARTICLES = ['the', 'a', 'an']

function arrive(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

// 0 to 1 between two moments: two thirds steady, one third slowing in, so a line runs evenly
// and settles into the ring it is drawn to.
function draw(frame, fps, fromMs, toMs) {
  const a = motion.frames(Math.max(0, fromMs), fps)
  const range = [a, Math.max(a + 1, motion.frames(Math.max(0, toMs), fps))]
  const even = Remotion.interpolate(frame, range, [0, 1], {
    easing: motion.ease.linear, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  const slow = Remotion.interpolate(frame, range, [0, 1], {
    easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  return (2 * even + slow) / 3
}

function sweep(frame, fps, atMs, lengthMs) {
  const a = motion.frames(Math.max(0, atMs), fps)
  return Remotion.interpolate(frame, [a, a + motion.frames(lengthMs, fps)], [0, 1], {
    easing: motion.ease.move, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
}

function bare(word) {
  return String(word.text).toLowerCase().replace(/[^a-z]/g, '')
}

// The steps: each starts at an ordinal word and runs to the next; its key is the first word
// after the ordinal that is not an article. With no ordinals, each phrase is a step.
function stepsOf(words) {
  let starts = []
  words.forEach((w, i) => {
    if (ORDINALS.indexOf(bare(w)) >= 0) starts.push(i)
  })
  const counted = starts.length >= 2
  if (!counted) {
    starts = [0]
    words.forEach((w, i) => {
      if (i + 1 < words.length && /[,.;]$/.test(String(w.text))) starts.push(i + 1)
    })
  }
  return starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : words.length
    const name = words.slice(counted ? s + 1 : s, end)
    const key = name.find((w) => ARTICLES.indexOf(bare(w)) < 0) || name[0] || words[s]
    return { ordinal: counted ? words[s] : null, name, startAt: words[s].atMs, key }
  })
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height, fps } = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080
  const steps = React.useMemo(() => stepsOf(props.words || []), [props.words])
  const n = Math.max(1, steps.length)
  const last = n - 1

  // The first ring is reached as its step is named; each later one as its step's word is spoken.
  const reach = steps.map((s, k) => (k === 0 ? s.startAt : Math.max(s.key.atMs, s.startAt + motion.ms.move)))
  const laid = draw(frame, fps, 0, motion.ms.draw)
  let walked = 0
  for (let k = 1; k < n; k++) walked += draw(frame, fps, steps[k].startAt, reach[k])
  const landed = last > 0 ? arrive(frame, fps, reach[last], motion.ms.enter) : 0

  const room = width - inset.left - inset.right
  const roomH = height - inset.top - inset.bottom
  const r = (portrait ? 22 : 18) * unit
  const stroke = Math.max(2, 3 * unit)
  const kickerSize = (portrait ? 36 : 32) * unit
  const colW = room / n
  const longest = Math.max(...steps.map((s) => s.name.map((w) => String(w.text)).join(' ').length))
  // Every name on one line in its column in 16:9, all at one size: the longest sets it.
  const fitted = (colW - 20 * unit) / (Math.max(6, longest) * 0.5)
  const oneLine = portrait || fitted >= 40 * unit
  const nameSize = portrait ? 64 * unit : Math.max(40 * unit, Math.min(52 * unit, fitted))
  const axisY = kickerSize * 1.25 + 26 * unit + 1.35 * r
  const stageH = portrait
    ? Math.min(0.82 * roomH, n * 250 * unit)
    : axisY + 1.35 * r + 26 * unit + nameSize * 1.1 * (oneLine ? 1 : 2)
  const rowH = stageH / n
  // In 9:16 the line and its names are centred together, from the longest name's width.
  const textW = Math.min(room - 2.7 * r - 36 * unit, longest * 0.5 * nameSize)
  const axisX = portrait ? Math.max(1.35 * r, (room - (2.7 * r + 36 * unit + textW)) / 2 + 1.35 * r) : 1.35 * r
  // Where each ring sits: across the frame in 16:9, down its left side in 9:16.
  const at = (k) => (portrait ? { x: axisX, y: rowH * (k + 0.5) } : { x: colW * (k + 0.5), y: axisY })
  const span = portrait ? rowH : colW
  const first = at(0)
  const end = at(last)
  const length = portrait ? end.y - first.y : end.x - first.x
  const lineStyle = (amount) =>
    portrait
      ? { left: first.x - stroke / 2, top: first.y, width: stroke, height: amount }
      : { left: first.x, top: first.y - stroke / 2, width: amount, height: stroke }

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right, paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ position: 'relative', width: room, height: stageH }}>
        <div style={{ position: 'absolute', ...lineStyle(length * laid), backgroundColor: Remotion.withAlpha(colors.textSecondary, 0.35) }} />
        {/* The walked line steps back to grey as the last ring lands, leaving red the one bright mark. */}
        <div style={{ position: 'absolute', ...lineStyle(span * walked), backgroundColor: colors.textPrimary, opacity: 1 - landed }} />
        <div style={{ position: 'absolute', ...lineStyle(span * walked), backgroundColor: colors.textSecondary, opacity: landed }} />
        {steps.map((s, k) => {
          const p = at(k)
          const shown = arrive(frame, fps, (k / Math.max(1, last)) * 0.75 * motion.ms.draw, motion.ms.enter)
          const lit = arrive(frame, fps, reach[k], motion.ms.enter)
          const back = k < last ? arrive(frame, fps, steps[k + 1].startAt, motion.ms.enter) : 0
          const waiting = k === last && last > 0 ? arrive(frame, fps, s.startAt, motion.ms.enter) : 0
          const disc = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: '50%' }
          return (
            <div key={'ring' + k} style={{ position: 'absolute', left: p.x - r, top: p.y - r, width: 2 * r, height: 2 * r, opacity: shown, transform: 'scale(' + (1 + 0.35 * (lit - back)) + ')' }}>
              <div style={{ ...disc, backgroundColor: colors.background, border: stroke + 'px solid ' + Remotion.withAlpha(colors.textSecondary, 0.6) }} />
              {k === last && last > 0 ? <div style={{ ...disc, border: stroke + 'px solid ' + colors.accent, opacity: waiting }} /> : null}
              <div style={{ ...disc, backgroundColor: k === last && last > 0 ? colors.accent : colors.textPrimary, opacity: lit * (1 - back) }} />
              {k < last ? <div style={{ ...disc, backgroundColor: colors.textSecondary, opacity: back }} /> : null}
            </div>
          )
        })}
        {steps.map((s, k) => {
          const p = at(k)
          const back = k < last ? arrive(frame, fps, steps[k + 1].startAt, motion.ms.enter) : 0
          const back2 = k + 1 < last ? arrive(frame, fps, steps[k + 2].startAt, motion.ms.enter) : 0
          const place = portrait
            ? { left: p.x + 1.35 * r + 36 * unit, width: room - (p.x + 1.35 * r + 36 * unit), top: p.y - (kickerSize * 1.25 + 6 * unit + nameSize * 1.1) / 2, textAlign: 'left' }
            : { left: p.x - colW / 2 + 12 * unit, width: colW - 24 * unit, top: 0, textAlign: 'center' }
          return (
            <div key={'text' + k} style={{ position: 'absolute', ...place }}>
              <div style={{ height: kickerSize * 1.25, marginBottom: portrait ? 6 * unit : axisY + 1.35 * r + 26 * unit - kickerSize * 1.25, fontFamily: fonts.body, fontSize: kickerSize, fontWeight: 600, lineHeight: 1.25, letterSpacing: '0.18em', textTransform: 'uppercase', whiteSpace: 'nowrap', color: colors.textSecondary, opacity: (s.ordinal ? arrive(frame, fps, s.startAt, motion.ms.enter) : 0) * (1 - 0.2 * back - 0.2 * back2) }}>
                {s.ordinal ? bare(s.ordinal) : ''}
              </div>
              <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: nameSize, lineHeight: 1.1, letterSpacing: '-0.02em', whiteSpace: oneLine ? 'nowrap' : 'normal', opacity: 1 - 0.35 * back2, transform: 'scale(' + (1 - 0.14 * back) + ')', transformOrigin: portrait ? 'left center' : 'center top' }}>
                {s.name.map((w, i) => {
                  const raw = String(w.text).replace(/[,.;:]$/, '')
                  const text = i === 0 ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw
                  const appear = arrive(frame, fps, w.atMs, motion.ms.enter)
                  // The last step's word lands under a red highlighter, wiping as it is spoken; it
                  // arrives in off white on the bar rather than settling from grey under it.
                  const marked = k === last && last > 0 && w === s.key
                  const white = marked ? 1 : arrive(frame, fps, w.atMs + motion.ms.micro, motion.ms.reveal) * (1 - back)
                  const hl = marked ? sweep(frame, fps, w.atMs, motion.ms.reveal) : 0
                  return (
                    <span key={'w' + i} style={{ position: 'relative', display: 'inline-block', marginRight: i === s.name.length - 1 ? 0 : '0.24em', opacity: appear }}>
                      {marked ? (
                        <span style={{ position: 'absolute', left: '-0.08em', right: '-0.08em', top: '0.1em', bottom: '0.02em', backgroundColor: colors.accent, clipPath: 'inset(0 ' + (1 - hl) * 100 + '% 0 0)' }} />
                      ) : null}
                      <span style={{ position: 'relative', display: 'inline-grid' }}>
                        <span style={{ gridArea: '1 / 1', color: colors.textSecondary }}>{text}</span>
                        <span style={{ gridArea: '1 / 1', color: colors.textPrimary, opacity: white }}>{text}</span>
                      </span>
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Remotion.AbsoluteFill>
  )
}
