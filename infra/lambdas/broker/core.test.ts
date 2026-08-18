import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { MediaJob, RenderCallback, Timeline } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it } from 'vitest'
import { estimateRenderCostUsd, handleBrokerRequest, materialiseTimeline } from './core'
import type { BrokerDeps, BrokerRequest, RenderRecord } from './core'

const PROJECT = '01HQ0000000000000000000PR1'
const RENDER = '01HQ0000000000000000000RD1'
const JOB = '01HQ0000000000000000000JB1'
const CHAPTER = '01HQ0000000000000000000CH1'
const TOKEN = 'broker-token-under-test'

function canonicalTimeline(): Timeline {
  return {
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: [
      {
        r2Key: 'boom-busters/voice/p0.wav',
        startMs: 0,
        durationMs: 8000,
        chapterId: CHAPTER,
        paragraphIndex: 0,
      },
    ],
    music: {
      r2Key: 'boom-busters/music/bed.mp3',
      gainDb: -25,
      duckingCurve: [{ tMs: 0, gainDb: -25 }],
      cuePoints: [],
    },
    captions: { words: [], style: 'none' },
    slots: [
      {
        type: 'still',
        startMs: 0,
        durationMs: 4000,
        transition: 'cut',
        motion: { kind: 'static' },
        payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/a.png' } },
      },
      {
        type: 'stock',
        startMs: 4000,
        durationMs: 4000,
        transition: 'cut',
        motion: { kind: 'static' },
        payload: {
          kind: 'video',
          src: { externalUrl: 'https://images.pexels.com/clip.mp4' },
          muted: true,
        },
      },
    ],
    overlays: [],
  }
}

interface TestWorld {
  deps: BrokerDeps
  records: Map<string, RenderRecord>
  tombstones: Set<string>
  callbacks: RenderCallback[]
  dispatched: MediaJob[]
  logs: Record<string, unknown>[]
  stored: Map<string, unknown>
  renderCalls: number
  discards: string[]
  signatureOk: boolean
}

function world(overrides: Partial<BrokerDeps> = {}): TestWorld {
  const records = new Map<string, RenderRecord>()
  const tombstones = new Set<string>()
  const callbacks: RenderCallback[] = []
  const dispatched: MediaJob[] = []
  const logs: Record<string, unknown>[] = []
  const stored = new Map<string, unknown>([['boom-busters/timelines/t1.json', canonicalTimeline()]])
  const state: TestWorld = {
    records,
    tombstones,
    callbacks,
    dispatched,
    logs,
    stored,
    renderCalls: 0,
    discards: [],
    signatureOk: true,
    deps: {
      token: TOKEN,
      renderCap: 2,
      store: {
        getRender: (id) => Promise.resolve(records.get(id) ?? null),
        putRender: (record) => {
          records.set(record.renderId, record)
          return Promise.resolve()
        },
        listRunning: () =>
          Promise.resolve([...records.values()].filter((r) => r.status === 'running')),
        findByRemotionId: (remotionId) =>
          Promise.resolve(
            [...records.values()].find((r) => r.remotionRenderId === remotionId) ?? null,
          ),
        isTombstoned: (id) => Promise.resolve(tombstones.has(id)),
        tombstone: (id) => {
          tombstones.add(id)
          return Promise.resolve()
        },
      },
      remotion: {
        render: () => {
          state.renderCalls += 1
          return Promise.resolve({
            remotionRenderId: `rem-${state.renderCalls}`,
            bucketName: 'remotionlambda-test',
          })
        },
        progress: () =>
          Promise.resolve({
            done: false,
            overallProgress: 0.4,
            outputFile: null,
            costUsd: null,
            fatalError: null,
          }),
        discard: (id) => {
          state.discards.push(id)
          return Promise.resolve()
        },
      },
      storage: {
        getJson: (key) => Promise.resolve(stored.get(key)),
        putJson: (key, value) => {
          stored.set(key, value)
          return Promise.resolve()
        },
        presign: (key) => Promise.resolve(`https://r2.example.com/${key}?sig=fresh`),
        presignRender: (bucketName, key) =>
          Promise.resolve(`https://s3.example.com/${bucketName}/${key}?sig=render`),
      },
      dispatchMediaJob: (job) => {
        dispatched.push(job)
        return Promise.resolve()
      },
      postCallback: (payload) => {
        callbacks.push(payload)
        return Promise.resolve()
      },
      verifyRemotionSignature: () => state.signatureOk,
      log: (entry) => {
        logs.push(entry)
      },
      ...overrides,
    },
  }
  return state
}

function post(path: string, body: unknown, token = TOKEN): BrokerRequest {
  return {
    method: 'POST',
    path,
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }
}

const renderRequest = {
  projectId: PROJECT,
  renderId: RENDER,
  kind: 'master',
  timelineS3Key: 'boom-busters/timelines/t1.json',
  composition: 'DocumentaryMaster',
  expectedDurationSec: 900,
}

describe('bearer auth', () => {
  it('rejects a wrong token and logs it', async () => {
    const w = world()
    const response = await handleBrokerRequest(post('/renders', renderRequest, 'wrong'), w.deps)
    expect(response.status).toBe(401)
    expect(w.logs.some((entry) => entry['event'] === 'auth-rejected')).toBe(true)
  })

  it('404s unknown routes once authenticated', async () => {
    const response = await handleBrokerRequest(post('/nope', {}), world().deps)
    expect(response.status).toBe(404)
  })
})

describe('POST /renders', () => {
  it('materialises, records and starts the render', async () => {
    const w = world()
    const response = await handleBrokerRequest(post('/renders', renderRequest), w.deps)
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      brokerRenderId: RENDER,
      remotionRenderId: 'rem-1',
      estimatedCostUsd: 0.25,
    })
    // The materialised audit copy exists and carries fresh URLs everywhere.
    const copy = w.stored.get(`renders/${RENDER}/timeline.json`) as Timeline
    expect(copy.narration[0]!.url).toContain('sig=fresh')
    expect(copy.music?.url).toContain('sig=fresh')
    expect(w.records.get(RENDER)?.status).toBe('running')
  })

  it('refuses past the concurrency cap — preventive, not reactive', async () => {
    const w = world()
    w.records.set('a', running('a'))
    w.records.set('b', running('b'))
    const response = await handleBrokerRequest(post('/renders', renderRequest), w.deps)
    expect(response.status).toBe(409)
    expect(w.renderCalls).toBe(0)
  })

  it('refuses a non-canonical timeline — presigned URLs must never be stored', async () => {
    const w = world()
    const leaked = canonicalTimeline()
    leaked.narration[0]!.url = 'https://r2.example.com/expired?sig=old'
    w.stored.set('boom-busters/timelines/t1.json', leaked)
    const response = await handleBrokerRequest(post('/renders', renderRequest), w.deps)
    expect(response.status).toBe(422)
    expect(w.renderCalls).toBe(0)
  })

  it('400s a malformed request without spending anything', async () => {
    const w = world()
    const response = await handleBrokerRequest(
      post('/renders', { ...renderRequest, renderId: 'not-a-ulid' }),
      w.deps,
    )
    expect(response.status).toBe(400)
    expect(w.renderCalls).toBe(0)
  })
})

function running(id: string): RenderRecord {
  return {
    renderId: id,
    projectId: PROJECT,
    kind: 'master',
    composition: 'DocumentaryMaster',
    remotionRenderId: `rem-${id}`,
    bucketName: 'remotionlambda-test',
    status: 'running',
  }
}

describe('cancel and the tombstone (section 8.1)', () => {
  it('tombstones immediately and reports whether spend was sunk', async () => {
    const w = world()
    w.records.set(RENDER, running(RENDER))
    const response = await handleBrokerRequest(post(`/renders/${RENDER}/cancel`, {}), w.deps)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'cancelled', wasRunning: true })
    expect(w.tombstones.has(RENDER)).toBe(true)
  })

  it('a tombstoned render’s webhook discards artefacts and emits NOTHING', async () => {
    const w = world()
    w.records.set(RENDER, running(RENDER))
    await handleBrokerRequest(post(`/renders/${RENDER}/cancel`, {}), w.deps)

    const webhook: BrokerRequest = {
      method: 'POST',
      path: '/webhooks/remotion',
      headers: {},
      body: JSON.stringify({ type: 'success', renderId: `rem-${RENDER}`, outputFile: 'out.mp4' }),
    }
    const response = await handleBrokerRequest(webhook, w.deps)
    expect(response.status).toBe(200)
    expect(w.discards).toEqual([`rem-${RENDER}`])
    expect(w.callbacks).toEqual([])
  })
})

describe('GET /renders/:id', () => {
  it('proxies live progress while running', async () => {
    const w = world()
    w.records.set(RENDER, running(RENDER))
    const response = await handleBrokerRequest(
      {
        method: 'GET',
        path: `/renders/${RENDER}`,
        headers: { authorization: `Bearer ${TOKEN}` },
        body: '',
      },
      w.deps,
    )
    expect(response.body).toMatchObject({ status: 'running', overallProgress: 0.4 })
  })

  it('serves terminal states from the record without touching Remotion', async () => {
    const w = world()
    w.records.set(RENDER, {
      ...running(RENDER),
      status: 'completed',
      outputS3Key: 'renders/x/out.mp4',
      costUsd: 0.21,
    })
    const response = await handleBrokerRequest(
      {
        method: 'GET',
        path: `/renders/${RENDER}`,
        headers: { authorization: `Bearer ${TOKEN}` },
        body: '',
      },
      w.deps,
    )
    expect(response.body).toMatchObject({
      status: 'completed',
      outputS3Key: 'renders/x/out.mp4',
      // Playable straight from the response: the app holds no AWS
      // credentials, so this presign is the master player's only src.
      outputUrl: 'https://s3.example.com/remotionlambda-test/renders/x/out.mp4?sig=render',
    })
  })

  it('never presigns an output for a failed or cancelled render', async () => {
    const w = world()
    w.records.set(RENDER, { ...running(RENDER), status: 'failed', message: 'boom' })
    const response = await handleBrokerRequest(
      {
        method: 'GET',
        path: `/renders/${RENDER}`,
        headers: { authorization: `Bearer ${TOKEN}` },
        body: '',
      },
      w.deps,
    )
    expect(response.body).toMatchObject({ status: 'failed', message: 'boom' })
    expect(response.body).not.toHaveProperty('outputUrl')
  })

  it('404s an unknown render', async () => {
    const response = await handleBrokerRequest(
      {
        method: 'GET',
        path: '/renders/unknown',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: '',
      },
      world().deps,
    )
    expect(response.status).toBe(404)
  })
})

describe('POST /webhooks/remotion', () => {
  const webhook = (payload: unknown): BrokerRequest => ({
    method: 'POST',
    path: '/webhooks/remotion',
    headers: {},
    body: JSON.stringify(payload),
  })

  it('rejects and logs bad signatures — a possible probe (section 12)', async () => {
    const w = world()
    w.signatureOk = false
    const response = await handleBrokerRequest(
      webhook({ type: 'success', renderId: 'rem-x' }),
      w.deps,
    )
    expect(response.status).toBe(401)
    expect(w.logs.some((entry) => entry['event'] === 'signature-rejected')).toBe(true)
  })

  it('answers 200 to an unknown renderId — never a retry storm', async () => {
    const w = world()
    const response = await handleBrokerRequest(
      webhook({ type: 'success', renderId: 'rem-ghost' }),
      w.deps,
    )
    expect(response.status).toBe(200)
    expect(w.callbacks).toEqual([])
  })

  it('normalises success into one completed callback', async () => {
    const w = world()
    w.records.set(RENDER, running(RENDER))
    await handleBrokerRequest(
      webhook({
        type: 'success',
        renderId: `rem-${RENDER}`,
        outputFile: 'renders/rem/out.mp4',
        costs: { estimatedCost: 0.23 },
      }),
      w.deps,
    )
    expect(w.callbacks).toEqual([
      {
        source: 'broker',
        projectId: PROJECT,
        renderId: RENDER,
        kind: 'master',
        result: 'completed',
        outputS3Key: 'renders/rem/out.mp4',
        costUsd: 0.23,
      },
    ])
    expect(w.records.get(RENDER)?.status).toBe('completed')
  })

  it('normalises timeout into a failed callback with the reason', async () => {
    const w = world()
    w.records.set(RENDER, running(RENDER))
    await handleBrokerRequest(webhook({ type: 'timeout', renderId: `rem-${RENDER}` }), w.deps)
    expect(w.callbacks[0]).toMatchObject({ result: 'failed', reason: 'timeout' })
    expect(w.records.get(RENDER)?.status).toBe('failed')
  })
})

describe('media job dispatch', () => {
  const job = {
    kind: 'transcribe',
    jobId: JOB,
    projectId: PROJECT,
    callbackUrl: 'https://app.example.com/api/hooks/broker',
    audioS3Key: 'boom-busters/voice/ch1.wav',
  }

  it('202s and dispatches asynchronously', async () => {
    const w = world()
    const response = await handleBrokerRequest(post('/media/transcribe', job), w.deps)
    expect(response.status).toBe(202)
    expect(w.dispatched).toHaveLength(1)
    expect(w.dispatched[0]!.kind).toBe('transcribe')
  })

  it('refuses a job posted to the wrong route', async () => {
    const w = world()
    const response = await handleBrokerRequest(post('/media/qc', job), w.deps)
    expect(response.status).toBe(400)
    expect(w.dispatched).toHaveLength(0)
  })
})

describe('materialiseTimeline', () => {
  it('presigns keys, passes stable URLs through, never mutates the original', async () => {
    const original = canonicalTimeline()
    const copy = await materialiseTimeline(original, (key) =>
      Promise.resolve(`https://signed/${key}`),
    )
    expect(copy.narration[0]!.url).toBe('https://signed/boom-busters/voice/p0.wav')
    const video = copy.slots[1]!.payload
    if (video.kind === 'video') expect(video.src.url).toBe(video.src.externalUrl)
    expect(original.narration[0]!.url).toBeUndefined()
  })
})

describe('estimateRenderCostUsd', () => {
  it('anchors on ≈$0.25 per 15-minute master', () => {
    expect(estimateRenderCostUsd(900)).toBe(0.25)
    expect(estimateRenderCostUsd(60)).toBeCloseTo(0.0167, 3)
  })
})

beforeEach(() => {
  // Each test constructs its own world; nothing shared, nothing leaks.
})
