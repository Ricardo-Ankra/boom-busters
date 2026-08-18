import { describe, expect, it } from 'vitest'
import {
  brokerSignature,
  CancelAcceptedSchema,
  MediaJobCallbackSchema,
  MediaJobSchema,
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
