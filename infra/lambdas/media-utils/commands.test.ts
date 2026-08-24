import { describe, expect, it } from 'vitest'
import {
  buildQcReport,
  loudnormApplyArgs,
  loudnormApplyVideoArgs,
  parseBlackFrames,
  parseFreezes,
  parseIntegratedLufs,
  parseLoudnormJson,
  parseSilences,
  qcArgs,
  whisperJsonToCaptions,
} from './commands'

describe('qcArgs', () => {
  it('measures silence, black, freeze and loudness in one pass', () => {
    const args = qcArgs('/tmp/master.mp4').join(' ')
    expect(args).toContain('silencedetect=noise=-45dB:d=2.5')
    expect(args).toContain('blackdetect=d=1.5')
    expect(args).toContain('freezedetect')
    expect(args).toContain('ebur128')
    expect(args).toContain('-f null')
  })
})

describe('stderr parsers', () => {
  it('pairs silencedetect start/end lines', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 421.03',
      'frame= 1000',
      '[silencedetect @ 0x1] silence_end: 424.27 | silence_duration: 3.24',
    ].join('\n')
    expect(parseSilences(stderr)).toEqual([{ startMs: 421030, endMs: 424270 }])
  })

  it('reads blackdetect spans from one line', () => {
    const stderr = '[blackdetect @ 0x2] black_start:12.4 black_end:14.16 black_duration:1.76'
    expect(parseBlackFrames(stderr)).toEqual([{ startMs: 12400, endMs: 14160 }])
  })

  it('pairs freezedetect metadata lines', () => {
    const stderr = [
      '[freezedetect @ 0x3] lavfi.freezedetect.freeze_start: 5.2',
      '[freezedetect @ 0x3] lavfi.freezedetect.freeze_end: 6.0',
    ].join('\n')
    expect(parseFreezes(stderr)).toEqual([{ startMs: 5200, endMs: 6000 }])
  })

  it('takes the LAST integrated loudness — the summary, not a progress line', () => {
    const stderr = ['  I:  -18.3 LUFS', 'other noise', '  I:  -14.2 LUFS'].join('\n')
    expect(parseIntegratedLufs(stderr)).toBe(-14.2)
    expect(parseIntegratedLufs('no loudness here')).toBeNull()
  })
})

describe('buildQcReport', () => {
  it('passes a clean master at target loudness', () => {
    const report = buildQcReport({
      silences: [],
      blackFrames: [],
      freezes: [],
      integratedLufs: -14.3,
      targetLufs: -14,
    })
    expect(report.passed).toBe(true)
    expect(report.issues).toEqual([])
  })

  it('collects every defect, sorted by time, and fails', () => {
    const report = buildQcReport({
      silences: [{ startMs: 421000, endMs: 424200 }],
      blackFrames: [{ startMs: 12400, endMs: 14100 }],
      freezes: [{ startMs: 5200, endMs: 6000 }],
      integratedLufs: -10.1,
      targetLufs: -14,
    })
    expect(report.passed).toBe(false)
    expect(report.issues.map((issue) => issue.kind)).toEqual([
      'loudness',
      'glitch',
      'black-frames',
      'silence',
    ])
  })

  it('treats unmeasurable loudness as a failure, never a pass', () => {
    const report = buildQcReport({
      silences: [],
      blackFrames: [],
      freezes: [],
      integratedLufs: null,
      targetLufs: -14,
    })
    expect(report.passed).toBe(false)
    expect(report.issues[0]?.kind).toBe('loudness')
  })
})

describe('two-pass loudnorm', () => {
  const stderr = `
frame= 100
[Parsed_loudnorm_0 @ 0x5]
{
  "input_i": "-23.61",
  "input_tp": "-6.53",
  "input_lra": "4.70",
  "input_thresh": "-34.13",
  "output_i": "-16.02",
  "target_offset": "0.02"
}
`

  it('extracts the measurement blob from pass 1 stderr', () => {
    const measured = parseLoudnormJson(stderr)
    expect(measured?.input_i).toBe('-23.61')
    expect(parseLoudnormJson('nothing here')).toBeNull()
  })

  it('feeds the measurements into a linear pass 2', () => {
    const measured = parseLoudnormJson(stderr)!
    const args = loudnormApplyArgs('/tmp/in.wav', '/tmp/out.wav', -16, measured).join(' ')
    expect(args).toContain('measured_I=-23.61')
    expect(args).toContain('linear=true')
    expect(args).toContain('-ar 48000')
  })

  it('copies the video stream untouched when normalising a finished master', () => {
    const measured = parseLoudnormJson(stderr)!
    const args = loudnormApplyVideoArgs('/tmp/in.mp4', '/tmp/out.mp4', -14, measured).join(' ')
    // Same measured pass-2 filter as the audio path...
    expect(args).toContain('measured_I=-23.61')
    expect(args).toContain('linear=true')
    // ...but the picture is a copy, the audio re-encodes, and the moov atom
    // stays at the front so the replaced file still streams from byte one.
    expect(args).toContain('-c:v copy')
    expect(args).toContain('-c:a aac')
    expect(args).toContain('-movflags +faststart')
  })
})

describe('whisperJsonToCaptions', () => {
  it('joins sub-word tokens and drops bracketed noise', () => {
    const captions = whisperJsonToCaptions({
      transcription: [
        { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
        { text: ' By', offsets: { from: 0, to: 180 } },
        { text: ' June', offsets: { from: 180, to: 460 } },
        { text: ',', offsets: { from: 460, to: 520 } },
        { text: ' nine', offsets: { from: 700, to: 950 } },
        { text: 'teen', offsets: { from: 950, to: 1100 } },
      ],
    })
    expect(captions.map((word) => word.text)).toEqual(['By', 'June,', 'nineteen'])
    expect(captions[2]).toMatchObject({ startMs: 700, endMs: 1100 })
  })

  it('returns nothing for an empty or malformed payload', () => {
    expect(whisperJsonToCaptions({})).toEqual([])
    expect(whisperJsonToCaptions({ transcription: [] })).toEqual([])
  })
})
