import { describe, expect, it } from 'vitest'
import {
  brokerSignature,
  CancelAcceptedSchema,
  estimateRenderCostUsd,
  MediaJobCallbackSchema,
  MediaJobSchema,
  PresignRequestSchema,
  TranscribeResultSchema,
  UploadYoutubeResultSchema,
  QcReportSchema,
  RemotionWebhookSchema,
  RenderCallbackSchema,
  RenderProgressSchema,
  RenderRequestSchema,
  verifyBrokerSignature,
} from './broker'

const PROJECT = '01HQ0000000000000000000PR1'
const RENDER = '01HQ0000000000000000000RD1'
const JOB = '01HQ0000000000000000000JB1'

describe('RenderRequestSchema', () => {
  const valid = {
    projectId: PROJECT,
    renderId: RENDER,
    kind: 'master',
    timelineS3Key: 'boom-busters/timelines/x.json',
    composition: 'DocumentaryMaster',
    expectedDurationSec: 900,
  }

  it('accepts the master render request', () => {
    expect(RenderRequestSchema.parse(valid).kind).toBe('master')
  })

  it('accepts a draft — the assembly stage invokes these automatically', () => {
    expect(RenderRequestSchema.parse({ ...valid, kind: 'draft' }).kind).toBe('draft')
  })

  it('rejects a non-ULID render id — the broker never invents IDs', () => {
    expect(RenderRequestSchema.safeParse({ ...valid, renderId: 'render-1' }).success).toBe(false)
  })

  it('rejects a zero-duration expectation', () => {
    expect(RenderRequestSchema.safeParse({ ...valid, expectedDurationSec: 0 }).success).toBe(false)
  })
})

describe('RenderProgressSchema', () => {
  it('bounds progress to 0..1', () => {
    const base = { renderId: RENDER, status: 'running', overallProgress: 0.5 }
    expect(RenderProgressSchema.parse(base).overallProgress).toBe(0.5)
    expect(RenderProgressSchema.safeParse({ ...base, overallProgress: 1.2 }).success).toBe(false)
  })

  it('carries a playable outputUrl only as a real URL', () => {
    const done = { renderId: RENDER, status: 'completed', overallProgress: 1 }
    expect(
      RenderProgressSchema.parse({ ...done, outputUrl: 'https://s3.example.com/out.mp4?sig=x' })
        .outputUrl,
    ).toContain('out.mp4')
    expect(RenderProgressSchema.safeParse({ ...done, outputUrl: 'renders/out.mp4' }).success).toBe(
      false,
    )
  })
})

describe('estimateRenderCostUsd', () => {
  it("quotes Remotion's reported cost: $1.00 for a 16.6-minute master, $0.90 for 900 s", () => {
    expect(estimateRenderCostUsd(996)).toBe(1)
    expect(estimateRenderCostUsd(900)).toBe(0.9036)
    expect(estimateRenderCostUsd(20)).toBeCloseTo(0.0201, 4)
  })

  it('quotes a half-scale draft at a quarter of the master price', () => {
    expect(estimateRenderCostUsd(900, 'draft')).toBeCloseTo(0.2259, 4)
    expect(estimateRenderCostUsd(900, 'short')).toBe(0.9036)
  })
})

describe('RemotionWebhookSchema', () => {
  it('reads the fields it needs and tolerates the rest', () => {
    const parsed = RemotionWebhookSchema.parse({
      type: 'success',
      renderId: 'abcdef123',
      outputFile: 'renders/abcdef123/out.mp4',
      bucketName: 'remotionlambda-x',
      somethingNew: { remotion: 'added this' },
      costs: { estimatedCost: 0.21, currency: 'USD' },
    })
    expect(parsed.type).toBe('success')
    expect(parsed.costs?.estimatedCost).toBe(0.21)
  })

  it('rejects an unknown outcome type — normalisation must be exhaustive', () => {
    expect(RemotionWebhookSchema.safeParse({ type: 'maybe', renderId: 'x' }).success).toBe(false)
  })
})

describe('MediaJobSchema', () => {
  const common = {
    jobId: JOB,
    projectId: PROJECT,
    callbackUrl: 'https://app.example.com/api/hooks/broker',
  }

  it('defaults qc to the -14 LUFS master target', () => {
    const job = MediaJobSchema.parse({ kind: 'qc', ...common, s3Key: 'renders/x.mp4' })
    if (job.kind === 'qc') expect(job.targetLufs).toBe(-14)
  })

  it('defaults loudnorm to the -16 LUFS voice reference', () => {
    const job = MediaJobSchema.parse({
      kind: 'loudnorm',
      ...common,
      s3Key: 'voice/in.wav',
      outputS3Key: 'voice/out.wav',
    })
    if (job.kind === 'loudnorm') expect(job.targetLufs).toBe(-16)
  })

  it('requires a callback URL — a job with no way home is lost spend', () => {
    expect(
      MediaJobSchema.safeParse({
        kind: 'transcribe',
        jobId: JOB,
        projectId: PROJECT,
        audioS3Key: 'voice/ch1.wav',
      }).success,
    ).toBe(false)
  })

  it('keeps the refresh token out: upload jobs carry an access token only', () => {
    const parsed = MediaJobSchema.safeParse({
      kind: 'upload-youtube',
      ...common,
      videoS3Key: 'renders/master.mp4',
      accessToken: 'ya29.short-lived',
      title: 'How Wirecard vanished',
      description: '',
      tags: ['finance'],
      privacyStatus: 'private',
    })
    expect(parsed.success).toBe(true)
  })

  const upload = {
    kind: 'upload-youtube',
    ...common,
    videoS3Key: 'renders/master.mp4',
    accessToken: 'ya29.short-lived',
    title: 'How Wirecard vanished',
    description: '',
    tags: [],
    privacyStatus: 'private',
  }

  it('accepts an upload with a category and both languages, and without them', () => {
    expect(MediaJobSchema.safeParse(upload).success).toBe(true)
    const parsed = MediaJobSchema.parse({
      ...upload,
      categoryId: '27',
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en',
    })
    expect(parsed).toMatchObject({ categoryId: '27', defaultLanguage: 'en' })
  })

  it('refuses a category that is not one to three digits, and an over-long language', () => {
    expect(MediaJobSchema.safeParse({ ...upload, categoryId: 'education' }).success).toBe(false)
    expect(MediaJobSchema.safeParse({ ...upload, categoryId: '1234' }).success).toBe(false)
    expect(MediaJobSchema.safeParse({ ...upload, defaultLanguage: 'x'.repeat(13) }).success).toBe(
      false,
    )
  })
})

describe('callbacks', () => {
  it('a completed render callback carries its artefact and cost', () => {
    const parsed = RenderCallbackSchema.parse({
      source: 'broker',
      projectId: PROJECT,
      renderId: RENDER,
      kind: 'master',
      result: 'completed',
      outputS3Key: 'renders/x/out.mp4',
      costUsd: 0.24,
    })
    expect(parsed.result).toBe('completed')
  })

  it('a qc callback validates its report shape', () => {
    const report = QcReportSchema.parse({
      passed: false,
      integratedLufs: -12.4,
      issues: [{ kind: 'silence', atMs: 421000, durationMs: 3200, detail: '3.2s of silence' }],
    })
    const parsed = MediaJobCallbackSchema.parse({
      source: 'media-utils',
      kind: 'qc',
      jobId: JOB,
      projectId: PROJECT,
      ok: true,
      result: report,
    })
    expect(parsed.kind).toBe('qc')
  })
})

describe('CancelAcceptedSchema', () => {
  it('acknowledges whether spend was already sunk (section 8.1)', () => {
    const parsed = CancelAcceptedSchema.parse({
      renderId: RENDER,
      status: 'cancelled',
      wasRunning: true,
    })
    expect(parsed.wasRunning).toBe(true)
  })
})

describe('webhook signing', () => {
  const token = 'broker-token-0000'
  const body = JSON.stringify({ hello: 'world' })

  it('round-trips', () => {
    const signature = brokerSignature(body, token)
    expect(verifyBrokerSignature(body, token, signature)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const signature = brokerSignature(body, token)
    expect(verifyBrokerSignature(body + ' ', token, signature)).toBe(false)
  })

  it('rejects a signature under the wrong token', () => {
    const signature = brokerSignature(body, 'other-token')
    expect(verifyBrokerSignature(body, token, signature)).toBe(false)
  })

  it('rejects garbage signatures without throwing', () => {
    expect(verifyBrokerSignature(body, token, 'zz-not-hex')).toBe(false)
    expect(verifyBrokerSignature(body, token, '')).toBe(false)
  })
})

describe('QcReportSchema loudness fields', () => {
  it('a QC report without loudnorm parses as before', () => {
    const parsed = QcReportSchema.parse({ passed: true, integratedLufs: -14, issues: [] })
    expect(parsed.loudnorm).toBeUndefined()
    expect(parsed.durationMs).toBeUndefined()
  })

  it('carries the loudnorm measurement and duration on a part report', () => {
    const parsed = QcReportSchema.parse({
      passed: true,
      integratedLufs: -14.2,
      issues: [],
      loudnorm: {
        input_i: '-14.20',
        input_tp: '-1.10',
        input_lra: '6.30',
        input_thresh: '-24.20',
        target_offset: '0.20',
      },
      durationMs: 900030,
    })
    expect(parsed.loudnorm?.input_i).toBe('-14.20')
    expect(parsed.durationMs).toBe(900030)
  })
})

describe('long-render contract additions', () => {
  const common = {
    jobId: JOB,
    projectId: PROJECT,
    callbackUrl: 'https://app.example.com/api/hooks/broker',
  }
  const measured = {
    input_i: '-20.1',
    input_tp: '-3.0',
    input_lra: '5.2',
    input_thresh: '-30.4',
    target_offset: '0.3',
  }

  it('accepts a part request with an inclusive frame range and refuses a reversed one', () => {
    const base = {
      projectId: PROJECT,
      renderId: RENDER,
      kind: 'master',
      timelineS3Key: 'boom-busters/timelines/x.json',
      composition: 'DocumentaryMaster',
      expectedDurationSec: 900,
    }
    expect(RenderRequestSchema.parse({ ...base, frameRange: [0, 100] }).frameRange).toEqual([
      0, 100,
    ])
    expect(RenderRequestSchema.safeParse({ ...base, frameRange: [5, 5] }).success).toBe(true)
    expect(RenderRequestSchema.safeParse({ ...base, frameRange: [101, 100] }).success).toBe(false)
    expect(RenderRequestSchema.safeParse({ ...base, frameRange: [-1, 100] }).success).toBe(false)
    expect(RenderRequestSchema.parse(base).frameRange).toBeUndefined()
  })

  it('defaults a QC job to no offset and no loudnorm measurement', () => {
    const job = MediaJobSchema.parse({ kind: 'qc', ...common, s3Key: 'renders/x.mp4' })
    if (job.kind !== 'qc') throw new Error('expected qc')
    expect(job.offsetMs).toBe(0)
    expect(job.withLoudnorm).toBe(false)
  })

  it('accepts a join job and refuses an output outside renders/', () => {
    const join = {
      kind: 'join',
      ...common,
      partS3Keys: ['renders/p1.mp4', 'renders/p2.mp4'],
      outputS3Key: 'renders/final.mp4',
      measured,
    }
    const job = MediaJobSchema.parse(join)
    if (job.kind !== 'join') throw new Error('expected join')
    expect(job.targetLufs).toBe(-14)
    expect(
      MediaJobSchema.safeParse({ ...join, outputS3Key: 'boom-busters/final.mp4' }).success,
    ).toBe(false)
    expect(MediaJobSchema.safeParse({ ...join, partS3Keys: ['renders/p1.mp4'] }).success).toBe(
      false,
    )
  })

  it('an upload job without resume parses as before', () => {
    const upload = {
      kind: 'upload-youtube',
      ...common,
      videoS3Key: 'renders/master.mp4',
      accessToken: 'ya29.short-lived',
      title: 'T',
      description: '',
      tags: [],
      privacyStatus: 'private',
    }
    const job = MediaJobSchema.parse(upload)
    if (job.kind !== 'upload-youtube') throw new Error('expected upload')
    expect(job.resume).toBeUndefined()
    expect(job.budgetMs).toBeUndefined()
    const resumed = MediaJobSchema.parse({
      ...upload,
      resume: { uploadUrl: 'https://upload.example.com/s/1', offset: 1024 },
      budgetMs: 720_000,
    })
    if (resumed.kind !== 'upload-youtube') throw new Error('expected upload')
    expect(resumed.resume?.offset).toBe(1024)
  })

  it('reads an in-progress upload result and a finished one', () => {
    expect(UploadYoutubeResultSchema.parse({ videoId: 'abc', status: 'uploaded' })).toEqual({
      videoId: 'abc',
      status: 'uploaded',
    })
    const progress = UploadYoutubeResultSchema.parse({
      status: 'in-progress',
      uploadUrl: 'https://upload.example.com/s/1',
      offset: 2048,
      total: 4096,
    })
    expect('offset' in progress && progress.offset).toBe(2048)
    expect(
      UploadYoutubeResultSchema.safeParse({ status: 'in-progress', offset: 1, total: 2 }).success,
    ).toBe(false)
  })

  it('accepts a transcribe job with one key or a batch, never both or neither', () => {
    const t = { kind: 'transcribe', ...common }
    expect(MediaJobSchema.safeParse({ ...t, audioS3Key: 'a.wav' }).success).toBe(true)
    expect(MediaJobSchema.safeParse({ ...t, audioS3Keys: ['a.wav', 'b.wav'] }).success).toBe(true)
    expect(
      MediaJobSchema.safeParse({ ...t, audioS3Key: 'a.wav', audioS3Keys: ['b.wav'] }).success,
    ).toBe(false)
    expect(MediaJobSchema.safeParse(t).success).toBe(false)
    expect(
      MediaJobSchema.safeParse({ ...t, audioS3Keys: Array.from({ length: 9 }, () => 'a.wav') })
        .success,
    ).toBe(false)
    expect(TranscribeResultSchema.safeParse({ words: [] }).success).toBe(true)
    expect(
      TranscribeResultSchema.safeParse({ results: [{ audioS3Key: 'a.wav', words: [] }] }).success,
    ).toBe(true)
  })

  it('presigns only render-bucket keys', () => {
    expect(PresignRequestSchema.safeParse({ key: 'renders/x.mp4' }).success).toBe(true)
    expect(PresignRequestSchema.safeParse({ key: 'boom-busters/x' }).success).toBe(false)
  })
})
