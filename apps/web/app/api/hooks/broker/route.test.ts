import { BROKER_SIGNATURE_HEADER, brokerSignature } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.fn()
vi.mock('@/inngest/client', () => ({ inngest: { send: (...args: unknown[]) => send(...args) } }))

import { POST } from './route'

const TOKEN = 'hook-test-token'
const PROJECT = '01HQ0000000000000000000PR1'
const RENDER = '01HQ0000000000000000000RD1'
const JOB = '01HQ0000000000000000000JB1'

function signedRequest(payload: unknown, token = TOKEN): Request {
  const body = JSON.stringify(payload)
  return new Request('http://localhost/api/hooks/broker', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [BROKER_SIGNATURE_HEADER]: brokerSignature(body, token),
    },
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  send.mockResolvedValue(undefined)
  process.env['AWS_BROKER_URL'] = 'https://broker.example.com'
  process.env['AWS_BROKER_TOKEN'] = TOKEN
})

describe('POST /api/hooks/broker', () => {
  it('rejects a body signed under the wrong token', async () => {
    const response = await POST(signedRequest({ source: 'broker', anything: true }, 'other-token'))
    expect(response.status).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects an unsigned body', async () => {
    const response = await POST(
      new Request('http://localhost/api/hooks/broker', { method: 'POST', body: '{}' }),
    )
    expect(response.status).toBe(401)
  })

  it('turns a completed render callback into render/completed', async () => {
    const response = await POST(
      signedRequest({
        source: 'broker',
        projectId: PROJECT,
        renderId: RENDER,
        kind: 'master',
        result: 'completed',
        outputS3Key: 'renders/x/out.mp4',
        costUsd: 0.23,
      }),
    )
    expect(response.status).toBe(200)
    expect(send).toHaveBeenCalledWith({
      name: 'render/completed',
      data: {
        projectId: PROJECT,
        renderId: RENDER,
        outputS3Key: 'renders/x/out.mp4',
        costUsd: 0.23,
      },
    })
  })

  it('turns a failed render callback into render/failed with the reason', async () => {
    await POST(
      signedRequest({
        source: 'broker',
        projectId: PROJECT,
        renderId: RENDER,
        kind: 'master',
        result: 'failed',
        reason: 'timeout',
        message: 'render timed out',
      }),
    )
    expect(send).toHaveBeenCalledWith({
      name: 'render/failed',
      data: {
        projectId: PROJECT,
        renderId: RENDER,
        reason: 'timeout',
        message: 'render timed out',
      },
    })
  })

  it('turns a media job callback into media/job.completed', async () => {
    await POST(
      signedRequest({
        source: 'media-utils',
        kind: 'transcribe',
        jobId: JOB,
        projectId: PROJECT,
        ok: true,
        result: { words: [] },
      }),
    )
    expect(send).toHaveBeenCalledWith({
      name: 'media/job.completed',
      data: {
        projectId: PROJECT,
        jobId: JOB,
        kind: 'transcribe',
        ok: true,
        result: { words: [] },
      },
    })
  })

  it('answers 200 to a signed but unreadable payload — no retry storm', async () => {
    const response = await POST(signedRequest({ source: 'martian' }))
    expect(response.status).toBe(200)
    expect(send).not.toHaveBeenCalled()
  })
})
