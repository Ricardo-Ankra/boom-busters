import { CARD_SLOT_TYPES, SHORT_PHASES, SHORT_RULES, countWords } from '@boom-busters/schemas'
import type { ShortPhase, Timeline } from '@boom-busters/schemas'

/**
 * A compiled point Short measured against the rule book (playbook Shorts spec
 * section 4). Phase ends are "done by" maxima, not hard cuts: a miss is a
 * finding for the owner to read, never a refusal.
 */

export interface RuleFinding {
  rule:
    | 'words'
    | 'runtime'
    | 'pace'
    | 'phase-timing'
    | 'shot-length'
    | 'hook-punch'
    | 'bridge-length'
    | 'transition'
    | 'new-images'
  message: string
  shotIndex?: number
  phase?: ShortPhase
}

/** Seconds to one decimal, rounding half up on the millisecond. */
function seconds(ms: number): string {
  return `${(Math.round(ms / 100) / 10).toFixed(1)} s`
}

/** A rule-book limit: whole seconds read as "3 s", not "3.0 s". */
function limit(ms: number): string {
  return seconds(ms).replace('.0 s', ' s')
}

export function checkShortRules(input: {
  timeline: Timeline
  paragraphs: readonly { text: string; phase: ShortPhase }[]
  newImageCount: number
}): RuleFinding[] {
  const { timeline, paragraphs, newImageCount } = input
  const rules = SHORT_RULES
  const findings: RuleFinding[] = []

  // Words, over the script the voice read.
  const words = paragraphs.reduce((sum, p) => sum + countWords(p.text), 0)
  if (words < rules.wordsMin || words > rules.wordsMax) {
    findings.push({
      rule: 'words',
      message: `The script is ${words} words; the rule book wants ${rules.wordsMin} to ${rules.wordsMax}`,
    })
  }

  // Narration is laid out one segment per paragraph, so segment i is paragraph i.
  const segments = timeline.narration.map((segment, i) => ({
    startMs: segment.startMs,
    endMs: segment.startMs + segment.durationMs,
    durationMs: segment.durationMs,
    phase: paragraphs[i]?.phase,
  }))
  const narrationEndMs = segments.reduce((end, s) => Math.max(end, s.endMs), 0)

  if (segments.length > 0) {
    if (narrationEndMs < rules.runtimeMinMs || narrationEndMs > rules.runtimeMaxMs) {
      findings.push({
        rule: 'runtime',
        message: `The Short runs ${seconds(narrationEndMs)}; the rule book wants ${limit(rules.runtimeMinMs)} to ${limit(rules.runtimeMaxMs)}`,
      })
    }

    // Pace over the voiced time, not the gaps between paragraphs.
    const voicedMs = segments.reduce((sum, s) => sum + s.durationMs, 0)
    if (voicedMs > 0) {
      const wpm = (words / voicedMs) * 60_000
      if (wpm < rules.wpmMin || wpm > rules.wpmMax) {
        findings.push({
          rule: 'pace',
          message: `The narration runs ${Math.round(wpm)} words a minute; the rule book wants ${rules.wpmMin} to ${rules.wpmMax}`,
        })
      }
    }
  }

  for (const phase of SHORT_PHASES) {
    const ends = segments.filter((s) => s.phase === phase).map((s) => s.endMs)
    if (ends.length === 0) continue
    const endMs = Math.max(...ends)
    const byMs = rules.phaseEndMs[phase]
    if (endMs > byMs) {
      findings.push({
        rule: 'phase-timing',
        phase,
        message: `The ${phase} runs ${seconds(endMs)}; the rule book wants it done by ${limit(byMs)}`,
      })
    }
  }

  const bridge = segments.filter((s) => s.phase === 'bridge')
  if (bridge.length > 0) {
    const startMs = Math.min(...bridge.map((s) => s.startMs))
    const endMs = Math.max(...bridge.map((s) => s.endMs))
    const lengthMs = endMs - startMs
    if (lengthMs < rules.bridgeMinMs || lengthMs > rules.bridgeMaxMs) {
      findings.push({
        rule: 'bridge-length',
        phase: 'bridge',
        message: `The bridge runs ${seconds(lengthMs)}; the rule book wants ${limit(rules.bridgeMinMs)} to ${limit(rules.bridgeMaxMs)}`,
      })
    }
  }

  const lastShot = timeline.slots.length - 1
  for (const [index, slot] of timeline.slots.entries()) {
    const isCard = (CARD_SLOT_TYPES as readonly string[]).includes(slot.type)
    const maxMs = isCard ? rules.cardShotMaxMs : rules.shotMaxMs
    if (slot.durationMs > maxMs) {
      findings.push({
        rule: 'shot-length',
        shotIndex: index,
        message: `Shot ${index + 1} holds ${seconds(slot.durationMs)}; the rule book wants no more than ${limit(maxMs)}${isCard ? ' for a card' : ''}`,
      })
    } else if (index !== lastShot && slot.durationMs < rules.shotMinMs) {
      findings.push({
        rule: 'shot-length',
        shotIndex: index,
        message: `Shot ${index + 1} holds ${seconds(slot.durationMs)}; the rule book wants at least ${limit(rules.shotMinMs)}`,
      })
    }
    if (slot.transition !== 'cut') {
      findings.push({
        rule: 'transition',
        shotIndex: index,
        message: `Shot ${index + 1} enters with a ${slot.transition}; the rule book wants cuts only`,
      })
    }
  }

  // "Within the first 1.2 s" read as a punch-in that starts by then.
  const punched = timeline.slots.some(
    (slot) => slot.motion.kind === 'punch' && slot.startMs <= rules.hookPunchByMs,
  )
  if (timeline.slots.length > 0 && !punched) {
    findings.push({
      rule: 'hook-punch',
      message: `The hook has no punch-in in its first ${limit(rules.hookPunchByMs)}; the rule book wants one by then`,
    })
  }

  if (newImageCount > rules.newImagesMax) {
    findings.push({
      rule: 'new-images',
      message: `The Short asks for ${newImageCount} new images; the rule book allows ${rules.newImagesMax}`,
    })
  }

  return findings
}
