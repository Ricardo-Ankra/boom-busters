import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SHORT_RULES,
  TimelineSchema,
  UlidSchema,
  ValidationError,
  timelineDurationMs,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { compileShortMaster, POINT_CHAPTER_ID } from './point'
import { pointFixtureInput } from './point.fixture'
import {
  compileShortTimeline,
  END_CARD_LABEL,
  FOLLOW_CARD_HEADLINE,
  FOLLOW_CARD_LINE,
  FOLLOW_CARD_MS,
} from './short'

const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'point-timeline.json')

function compiled() {
  return compileShortMaster(pointFixtureInput())
}

describe('POINT_CHAPTER_ID', () => {
  it('is a valid ULID', () => {
    expect(UlidSchema.safeParse(POINT_CHAPTER_ID).success).toBe(true)
  })
})

describe('compileShortMaster', () => {
  it('matches the committed golden byte for byte', () => {
    const text = JSON.stringify(compiled(), null, 2) + '\n'
    if (process.env['REGEN_GOLDEN'] === '1') {
      writeFileSync(GOLDEN_PATH, text)
    }
    // Regenerate with REGEN_GOLDEN=1 after an intentional change and review the diff.
    expect(text).toBe(readFileSync(GOLDEN_PATH, 'utf8'))
  })

  it('is a schema-valid timeline with no music', () => {
    const timeline = compiled()
    expect(TimelineSchema.safeParse(timeline).success).toBe(true)
    expect(timeline.music).toBeNull()
    expect(timeline.narration.every((segment) => segment.chapterId === POINT_CHAPTER_ID)).toBe(true)
  })

  it('lays narration back to back with the rule book gap', () => {
    const { narration } = compiled()
    for (let i = 1; i < narration.length; i += 1) {
      const previous = narration[i - 1]!
      expect(narration[i]!.startMs).toBe(
        previous.startMs + previous.durationMs + SHORT_RULES.paragraphGapMs,
      )
    }
  })

  it('starts each shot on its word and ends it where the next begins', () => {
    const input = pointFixtureInput()
    const timeline = compileShortMaster(input)
    const words = timeline.captions.words
    const end = timelineDurationMs(timeline)
    expect(timeline.slots).toHaveLength(input.shots.length)
    timeline.slots.forEach((slot, index) => {
      const expectedStart = index === 0 ? 0 : words[input.shots[index]!.startWord]!.startMs
      expect(slot.startMs).toBe(expectedStart)
      const next = timeline.slots[index + 1]
      expect(slot.startMs + slot.durationMs).toBe(next ? next.startMs : end)
      expect(slot.transition).toBe('cut')
      expect(slot.crop).toBe(input.shots[index]!.crop)
    })
  })

  it('starts shot 0 at zero whatever word it names', () => {
    const input = pointFixtureInput()
    input.shots[0] = { ...input.shots[0]!, startWord: 2 }
    expect(compileShortMaster(input).slots[0]!.startMs).toBe(0)
  })

  it('replaces a video slot’s motion with the plan’s Ken Burns, but a chart keeps draw-on', () => {
    const timeline = compiled()
    const video = timeline.slots.find((slot) => slot.payload.kind === 'video')!
    expect(video.motion).toEqual({
      kind: 'kenburns',
      direction: 'out',
      intensity: SHORT_RULES.kenburnsIntensity,
    })
    const chart = timeline.slots.find((slot) => slot.payload.kind === 'chart')!
    expect(chart.motion).toEqual({ kind: 'draw-on' })
    const map = timeline.slots.find((slot) => slot.payload.kind === 'map')!
    expect(map.motion).toEqual({ kind: 'static' })
  })

  it('maps punch to the rule book punch and static to static', () => {
    const input = pointFixtureInput()
    input.shots[1] = { ...input.shots[1]!, motion: 'static' }
    const timeline = compileShortMaster(input)
    expect(timeline.slots[0]!.motion).toEqual({
      kind: 'punch',
      scale: SHORT_RULES.punchScale,
      durationMs: SHORT_RULES.punchMs,
    })
    expect(timeline.slots[1]!.motion).toEqual({ kind: 'static' })
  })

  it('lets a plan punch override a chart too', () => {
    const input = pointFixtureInput()
    const at = input.shots.findIndex((shot) => shot.slot.payload.kind === 'chart')
    input.shots[at] = { ...input.shots[at]!, motion: 'punch' }
    expect(compileShortMaster(input).slots[at]!.motion.kind).toBe('punch')
  })

  it('spans both bridge overlays from the bridge paragraph to the narration end', () => {
    const timeline = compiled()
    const bridge = timeline.narration[timeline.narration.length - 1]!
    const end = bridge.startMs + bridge.durationMs
    expect(timeline.overlays.map((overlay) => overlay.kind)).toEqual([
      'relatedArrow',
      'subscribeBadge',
    ])
    for (const overlay of timeline.overlays) {
      expect(overlay.startMs).toBe(bridge.startMs)
      expect(overlay.startMs + overlay.durationMs).toBe(end)
    }
  })

  it('throws for no paragraphs, no shots, no bridge and a start word past the end', () => {
    const base = pointFixtureInput()
    expect(() => compileShortMaster({ ...base, paragraphs: [] })).toThrow(ValidationError)
    expect(() => compileShortMaster({ ...base, shots: [] })).toThrow(ValidationError)
    expect(() => compileShortMaster({ ...base, paragraphs: base.paragraphs.slice(0, 4) })).toThrow(
      /bridge/,
    )
    expect(() =>
      compileShortMaster({
        ...base,
        shots: [...base.shots, { ...base.shots[0]!, startWord: 999 }],
      }),
    ).toThrow(ValidationError)
  })

  it('refuses shots that do not advance', () => {
    const base = pointFixtureInput()
    const shots = [base.shots[0]!, { ...base.shots[1]!, startWord: 0 }]
    expect(() => compileShortMaster({ ...base, shots })).toThrow(/last no time/)
  })
})

describe('the point fixture', () => {
  const timeline = compiled()
  const words = timeline.captions.words

  it('holds 110 to 160 words at 150 to 170 a minute over 45 to 60 s', () => {
    expect(words.length).toBeGreaterThanOrEqual(SHORT_RULES.wordsMin)
    expect(words.length).toBeLessThanOrEqual(SHORT_RULES.wordsMax)
    const voicedMs = timeline.narration.reduce((sum, segment) => sum + segment.durationMs, 0)
    const wpm = words.length / (voicedMs / 60_000)
    expect(wpm).toBeGreaterThanOrEqual(SHORT_RULES.wpmMin)
    expect(wpm).toBeLessThanOrEqual(SHORT_RULES.wpmMax)
    const runtime = timelineDurationMs(timeline)
    expect(runtime).toBeGreaterThanOrEqual(SHORT_RULES.runtimeMinMs)
    expect(runtime).toBeLessThanOrEqual(SHORT_RULES.runtimeMaxMs)
  })

  it('ends each phase inside its limit and keeps the bridge 5 to 8 s', () => {
    const input = pointFixtureInput()
    input.paragraphs.forEach((paragraph, index) => {
      const segment = timeline.narration[index]!
      expect(segment.startMs + segment.durationMs).toBeLessThanOrEqual(
        SHORT_RULES.phaseEndMs[paragraph.phase],
      )
    })
    const bridge = timeline.narration[timeline.narration.length - 1]!
    expect(bridge.durationMs).toBeGreaterThanOrEqual(SHORT_RULES.bridgeMinMs)
    expect(bridge.durationMs).toBeLessThanOrEqual(SHORT_RULES.bridgeMaxMs)
  })

  it('cuts every 2.5 to 5 s, all hard cuts, with a punch inside the first 1.2 s', () => {
    for (const slot of timeline.slots) {
      expect(slot.durationMs).toBeGreaterThanOrEqual(SHORT_RULES.shotMinMs)
      expect(slot.durationMs).toBeLessThanOrEqual(SHORT_RULES.shotMaxMs)
      expect(slot.transition).toBe('cut')
    }
    expect(timeline.slots.length).toBeGreaterThanOrEqual(14)
    expect(timeline.slots.length).toBeLessThanOrEqual(20)
    const punch = timeline.slots.find((slot) => slot.motion.kind === 'punch')!
    expect(punch.startMs).toBeLessThanOrEqual(SHORT_RULES.hookPunchByMs)
  })
})

describe('compileShortTimeline with the bridge ending', () => {
  it('keeps both bridge overlays, re-clocked, and adds no endCta', () => {
    const master = compiled()
    const narration = master.narration
    const short = compileShortTimeline({
      master,
      segmentRef: {
        chapterId: POINT_CHAPTER_ID,
        fromParagraph: 0,
        toParagraph: narration.length - 1,
      },
      ending: 'bridge',
      music: null,
    })
    expect(short.overlays.map((overlay) => overlay.kind)).toEqual([
      'relatedArrow',
      'subscribeBadge',
    ])
    expect(short.overlays).toEqual(master.overlays)
    expect(short.overlays.some((overlay) => overlay.kind === 'endCta')).toBe(false)
  })

  it('re-clocks the overlays when the window starts later', () => {
    const master = compiled()
    const last = master.narration.length - 1
    const bridge = master.narration[last]!
    const short = compileShortTimeline({
      master,
      segmentRef: { chapterId: POINT_CHAPTER_ID, fromParagraph: last - 1, toParagraph: last },
      ending: 'bridge',
      music: null,
    })
    const windowStart = master.narration[last - 1]!.startMs
    for (const overlay of short.overlays) {
      expect(overlay.startMs).toBe(bridge.startMs - windowStart)
      expect(overlay.durationMs).toBe(bridge.durationMs)
    }
  })
})

describe('compileShortTimeline with the end card (decision 479)', () => {
  const card = {
    title: 'How Wirecard Fell',
    chapters: [
      { number: 4, title: 'The audit' },
      { number: 6, title: 'The trial' },
      { number: 7, title: '   ' },
      { number: 8, title: 'The fourth, never shown' },
      { number: 9, title: 'The fifth, never shown' },
    ],
    runtimeMs: 1_122_000,
  }
  const short = (master = compiled()) =>
    compileShortTimeline({
      master,
      segmentRef: {
        chapterId: POINT_CHAPTER_ID,
        fromParagraph: 0,
        toParagraph: master.narration.length - 1,
      },
      ending: 'bridge',
      music: { r2Key: 'boom-busters/music/shorts-pulse-01.mp3' },
      endCard: card,
    })

  it('puts the end card where the bridge overlays were, and the follow card after the narration', () => {
    const master = compiled()
    const bridge = master.overlays[0]!
    const compiledShort = short(master)
    const narrationEnd = Math.max(...master.narration.map((s) => s.startMs + s.durationMs))

    expect(compiledShort.overlays).toEqual([
      {
        kind: 'endCard',
        startMs: bridge.startMs,
        durationMs: bridge.durationMs,
        props: {
          channelName: 'Boom & Busters',
          title: 'How Wirecard Fell',
          chapters: [
            { number: 4, title: 'The audit' },
            { number: 6, title: 'The trial' },
            { number: 8, title: 'The fourth, never shown' },
          ],
          runtimeMs: 1_122_000,
          label: END_CARD_LABEL,
        },
      },
      {
        kind: 'followCard',
        startMs: narrationEnd,
        durationMs: FOLLOW_CARD_MS,
        props: {
          channelName: 'Boom & Busters',
          headline: FOLLOW_CARD_HEADLINE,
          line: FOLLOW_CARD_LINE,
        },
      },
    ])
  })

  it('runs the follow card on the last shot held on, so the Short is 2.5 s longer', () => {
    const master = compiled()
    const without = compileShortTimeline({
      master,
      segmentRef: {
        chapterId: POINT_CHAPTER_ID,
        fromParagraph: 0,
        toParagraph: master.narration.length - 1,
      },
      ending: 'bridge',
      music: null,
    })
    const withCard = short(master)
    expect(timelineDurationMs(withCard)).toBe(timelineDurationMs(without) + FOLLOW_CARD_MS)
    expect(withCard.slots.slice(0, -1)).toEqual(without.slots.slice(0, -1))
    expect(TimelineSchema.safeParse(withCard).success).toBe(true)
  })

  it('compiles the same from a master that already carries an end card', () => {
    const once = short()
    const twice = compileShortTimeline({
      master: { ...compiled(), overlays: [once.overlays[0]!] },
      segmentRef: {
        chapterId: POINT_CHAPTER_ID,
        fromParagraph: 0,
        toParagraph: compiled().narration.length - 1,
      },
      ending: 'bridge',
      music: { r2Key: 'boom-busters/music/shorts-pulse-01.mp3' },
      endCard: card,
    })
    expect(twice.overlays).toEqual(once.overlays)
  })
})
