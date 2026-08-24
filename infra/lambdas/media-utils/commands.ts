import type { Caption, QcReport } from '@boom-busters/schemas'

/**
 * The media-utils Lambda's brain: FFmpeg invocation plans, stderr parsers
 * and report building — all pure, all unit-tested. `handler.ts` downloads
 * bytes, spawns the binaries and posts the signed callback; everything it
 * decides comes from here.
 *
 * QC thresholds (spec section 7.6: silence scan, black-frame scan, glitch
 * scan, loudness): values chosen for a narrated documentary — a 2.5 s hole
 * in narration+bed is a defect; a 1.5 s black is a slot that failed to
 * materialise; a frozen frame ≥ 0.5 s is a stuck renderer.
 */

export const QC_SILENCE_NOISE_DB = -45
export const QC_SILENCE_MIN_S = 2.5
export const QC_BLACK_MIN_S = 1.5
export const QC_BLACK_PIXEL_THRESHOLD = 0.1
export const QC_FREEZE_NOISE = 0.003
export const QC_FREEZE_MIN_S = 0.5
export const QC_LOUDNESS_TOLERANCE_LU = 1.5

/** One FFmpeg pass measuring everything QC needs; output discarded. */
export function qcArgs(inputPath: string): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    inputPath,
    '-af',
    `silencedetect=noise=${QC_SILENCE_NOISE_DB}dB:d=${QC_SILENCE_MIN_S},ebur128`,
    '-vf',
    `blackdetect=d=${QC_BLACK_MIN_S}:pix_th=${QC_BLACK_PIXEL_THRESHOLD},` +
      `freezedetect=n=${QC_FREEZE_NOISE}:d=${QC_FREEZE_MIN_S}`,
    '-f',
    'null',
    '-',
  ]
}

export interface TimeSpan {
  startMs: number
  endMs: number
}

const toMs = (seconds: string): number => Math.round(Number(seconds) * 1000)

/** silencedetect prints start and end on separate lines; pair them up. */
export function parseSilences(stderr: string): TimeSpan[] {
  const spans: TimeSpan[] = []
  let openStart: number | null = null
  for (const line of stderr.split('\n')) {
    const start = /silence_start:\s*([\d.]+)/.exec(line)
    if (start) openStart = toMs(start[1]!)
    const end = /silence_end:\s*([\d.]+)/.exec(line)
    if (end && openStart !== null) {
      spans.push({ startMs: openStart, endMs: toMs(end[1]!) })
      openStart = null
    }
  }
  return spans
}

/** blackdetect prints one line per span. */
export function parseBlackFrames(stderr: string): TimeSpan[] {
  const spans: TimeSpan[] = []
  for (const line of stderr.split('\n')) {
    const match = /black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/.exec(line)
    if (match) spans.push({ startMs: toMs(match[1]!), endMs: toMs(match[2]!) })
  }
  return spans
}

/** freezedetect logs lavfi metadata lines; pair start/end like silence. */
export function parseFreezes(stderr: string): TimeSpan[] {
  const spans: TimeSpan[] = []
  let openStart: number | null = null
  for (const line of stderr.split('\n')) {
    const start = /freeze_start:\s*([\d.]+)/.exec(line)
    if (start) openStart = toMs(start[1]!)
    const end = /freeze_end:\s*([\d.]+)/.exec(line)
    if (end && openStart !== null) {
      spans.push({ startMs: openStart, endMs: toMs(end[1]!) })
      openStart = null
    }
  }
  return spans
}

/** The ebur128 summary block's integrated loudness: "I: -14.2 LUFS". */
export function parseIntegratedLufs(stderr: string): number | null {
  const matches = [...stderr.matchAll(/^\s*I:\s*(-?[\d.]+)\s*LUFS/gm)]
  const last = matches[matches.length - 1]
  return last ? Number(last[1]) : null
}

export function buildQcReport(input: {
  silences: TimeSpan[]
  blackFrames: TimeSpan[]
  freezes: TimeSpan[]
  integratedLufs: number | null
  targetLufs: number
}): QcReport {
  const issues: QcReport['issues'] = []
  for (const span of input.silences) {
    issues.push({
      kind: 'silence',
      atMs: span.startMs,
      durationMs: span.endMs - span.startMs,
      detail: `${((span.endMs - span.startMs) / 1000).toFixed(1)}s of silence`,
    })
  }
  for (const span of input.blackFrames) {
    issues.push({
      kind: 'black-frames',
      atMs: span.startMs,
      durationMs: span.endMs - span.startMs,
      detail: `${((span.endMs - span.startMs) / 1000).toFixed(1)}s of black`,
    })
  }
  for (const span of input.freezes) {
    issues.push({
      kind: 'glitch',
      atMs: span.startMs,
      durationMs: span.endMs - span.startMs,
      detail: `frame frozen for ${((span.endMs - span.startMs) / 1000).toFixed(1)}s`,
    })
  }
  const integratedLufs = input.integratedLufs ?? 0
  if (
    input.integratedLufs === null ||
    Math.abs(input.integratedLufs - input.targetLufs) > QC_LOUDNESS_TOLERANCE_LU
  ) {
    issues.push({
      kind: 'loudness',
      atMs: 0,
      detail:
        input.integratedLufs === null
          ? 'integrated loudness could not be measured'
          : `${input.integratedLufs.toFixed(1)} LUFS integrated; target ${input.targetLufs} ±${QC_LOUDNESS_TOLERANCE_LU}`,
    })
  }
  issues.sort((a, b) => a.atMs - b.atMs)
  return { passed: issues.length === 0, integratedLufs, issues }
}

// ---------------------------------------------------------------------------
// Loudness normalisation (two-pass loudnorm)
// ---------------------------------------------------------------------------

export function loudnormMeasureArgs(inputPath: string, targetLufs: number): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    inputPath,
    '-af',
    `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:print_format=json`,
    '-f',
    'null',
    '-',
  ]
}

export interface LoudnormMeasurement {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

/** loudnorm prints its JSON blob at the end of stderr. */
export function parseLoudnormJson(stderr: string): LoudnormMeasurement | null {
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const blob = JSON.parse(stderr.slice(start, end + 1)) as Record<string, unknown>
    if (typeof blob['input_i'] !== 'string') return null
    return blob as unknown as LoudnormMeasurement
  } catch {
    return null
  }
}

/** The pass-2 filter both apply variants share, fed by pass 1's numbers. */
function loudnormApplyFilter(targetLufs: number, measured: LoudnormMeasurement): string {
  return (
    `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:` +
    `measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:` +
    `measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:` +
    `offset=${measured.target_offset}:linear=true`
  )
}

/** Pass 2: linear normalisation using pass 1's measurements. */
export function loudnormApplyArgs(
  inputPath: string,
  outputPath: string,
  targetLufs: number,
  measured: LoudnormMeasurement,
): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    inputPath,
    '-af',
    loudnormApplyFilter(targetLufs, measured),
    '-ar',
    '48000',
    outputPath,
  ]
}

/**
 * Pass 2 for a VIDEO container (a finished master or Short, decision 188):
 * the video stream is COPIED untouched — no re-encode, no generation loss,
 * seconds of I/O instead of another render — and only the audio passes
 * through loudnorm into AAC. `+faststart` keeps the moov atom at the front,
 * which the render itself also does; a normalised file must stream from
 * byte one exactly like the file it replaces.
 */
export function loudnormApplyVideoArgs(
  inputPath: string,
  outputPath: string,
  targetLufs: number,
  measured: LoudnormMeasurement,
): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    inputPath,
    '-af',
    loudnormApplyFilter(targetLufs, measured),
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    outputPath,
  ]
}

// ---------------------------------------------------------------------------
// Whisper.cpp transcription
// ---------------------------------------------------------------------------

/** Whisper wants 16 kHz mono PCM; masters and takes arrive as anything. */
export function toWhisperWavArgs(inputPath: string, wavPath: string): string[] {
  return ['-hide_banner', '-nostats', '-i', inputPath, '-ar', '16000', '-ac', '1', wavPath]
}

/** Token-level timestamps (-ml 1), JSON to <outBase>.json. */
export function whisperArgs(modelPath: string, wavPath: string, outBase: string): string[] {
  return ['-m', modelPath, '-f', wavPath, '-ml', '1', '-oj', '-of', outBase]
}

interface WhisperToken {
  text: string
  offsets: { from: number; to: number }
}

/**
 * whisper.cpp's -ml 1 output splits on tokens: a token starting with a space
 * begins a new word, anything else continues the previous one. Bracketed
 * noise like [_BEG_] and blank tokens are dropped.
 */
export function whisperJsonToCaptions(json: unknown): Caption[] {
  const transcription = (json as { transcription?: WhisperToken[] }).transcription ?? []
  const words: Caption[] = []
  for (const token of transcription) {
    const text = token.text
    if (text.trim() === '' || /^\s*\[[^\]]*\]\s*$/.test(text)) continue
    const startsWord = text.startsWith(' ') || words.length === 0
    if (startsWord) {
      words.push({
        text: text.trim(),
        startMs: token.offsets.from,
        endMs: token.offsets.to,
        timestampMs: token.offsets.from,
        confidence: null,
      })
    } else {
      const last = words[words.length - 1]!
      last.text += text.trim()
      last.endMs = token.offsets.to
    }
  }
  return words.filter((word) => word.text.length > 0)
}
