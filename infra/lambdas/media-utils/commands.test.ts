import { describe, expect, it } from 'vitest'
import {
  buildQcReport,
  concatListText,
  joinArgs,
  loudnormMeasureArgs,
  parseDurationMs,
  redactUrls,
  loudnormApplyArgs,
  loudnormApplyVideoArgs,
  parseBlackFrames,
  parseFreezes,
  parseIntegratedLufs,
  parseLoudnormJson,
  parseSilences,
  qcArgs,
  whisperJsonToCaptions,
  youtubeInitBody,
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

describe('youtubeInitBody', () => {
  const job = {
    kind: 'upload-youtube' as const,
    jobId: '01HQ0000000000000000000JOB',
    projectId: '01HQ0000000000000000000PRJ',
    callbackUrl: 'https://example.com/hook',
    videoS3Key: 'renders/master.mp4',
    accessToken: 'ya29.short',
    title: 'The audit that lied',
    description: 'Wirecard.',
    tags: ['finance'],
    privacyStatus: 'private' as const,
    publishAt: '2026-11-05T15:00:00.000Z',
    containsSyntheticMedia: true,
  }

  it('is byte-identical to the body sent before the category and language existed', () => {
    const before = JSON.stringify({
      snippet: { title: job.title, description: job.description, tags: job.tags },
      status: {
        privacyStatus: job.privacyStatus,
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
        publishAt: job.publishAt,
      },
    })
    expect(youtubeInitBody(job)).toBe(before)
  })

  it('puts the category and both languages in the snippet when the job has them', () => {
    const body = JSON.parse(
      youtubeInitBody({
        ...job,
        categoryId: '27',
        defaultLanguage: 'en',
        defaultAudioLanguage: 'en',
      }),
    ) as { snippet: Record<string, unknown> }
    expect(body.snippet).toEqual({
      title: job.title,
      description: job.description,
      tags: job.tags,
      categoryId: '27',
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en',
    })
  })
})

describe('long renders in parts', () => {
  const measured = {
    input_i: '-20.10',
    input_tp: '-3.00',
    input_lra: '6.00',
    input_thresh: '-30.50',
    target_offset: '0.20',
  }

  it('shifts every issue by the part offset and carries the measurement', () => {
    const report = buildQcReport({
      silences: [{ startMs: 1000, endMs: 4000 }],
      blackFrames: [{ startMs: 2000, endMs: 4000 }],
      freezes: [],
      integratedLufs: -20,
      targetLufs: -14,
      offsetMs: 600_000,
      loudnorm: measured,
      durationMs: 900_030,
    })
    expect(report.issues.map((issue) => issue.atMs)).toEqual([0 + 600_000, 601_000, 602_000])
    expect(report.loudnorm).toEqual(measured)
    expect(report.durationMs).toBe(900_030)
  })

  it('omits the new fields when none are given', () => {
    const report = buildQcReport({
      silences: [],
      blackFrames: [],
      freezes: [],
      integratedLufs: -14,
      targetLufs: -14,
    })
    expect(Object.keys(report)).toEqual(['passed', 'integratedLufs', 'issues'])
  })

  it('reads the duration line', () => {
    expect(parseDurationMs('Input #0\n  Duration: 00:15:00.03, start: 0.0, bitrate: 1')).toBe(
      900_030,
    )
    expect(parseDurationMs('nothing here')).toBeNull()
  })

  it('strips the signature from presigned urls in a log tail', () => {
    const tail =
      "Opening 'https://b.s3.amazonaws.com/renders/x/out.mkv?X-Amz-Signature=abc&X-Amz-Date=1' for reading"
    expect(redactUrls(tail)).toBe(
      "Opening 'https://b.s3.amazonaws.com/renders/x/out.mkv?redacted' for reading",
    )
    expect(redactUrls('no urls here')).toBe('no urls here')
  })

  it('measures audio only when asked', () => {
    const args = loudnormMeasureArgs('/tmp/in', -14, { audioOnly: true })
    expect(args.indexOf('-vn')).toBeGreaterThan(-1)
    expect(args.indexOf('-vn')).toBeLessThan(args.indexOf('-i'))
    expect(loudnormMeasureArgs('/tmp/in', -14)).not.toContain('-vn')
  })

  it('writes one file line per url and escapes a quote', () => {
    expect(concatListText(['https://a/1', "https://a/it's"])).toBe(
      "file 'https://a/1'\nfile 'https://a/it'\\''s'\n",
    )
  })

  it('joins by stream copy with the loudness filter, fragmented, to stdout', () => {
    const args = joinArgs('/tmp/list.txt', -14, measured)
    const joined = args.join(' ')
    expect(joined).toContain('-protocol_whitelist file,https,tls,tcp')
    expect(joined).toContain('-f concat -safe 0 -i /tmp/list.txt')
    expect(joined).toContain('-c:v copy')
    expect(joined).toContain('linear=true,ebur128')
    expect(joined).toContain('loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-20.10')
    expect(joined).toContain('-movflags empty_moov+default_base_moof+delay_moov')
    expect(joined).toContain('-frag_duration 10000000')
    expect(args.slice(-3)).toEqual(['-f', 'mp4', 'pipe:1'])
  })
})
