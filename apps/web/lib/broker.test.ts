import { NonRetriableError } from 'inngest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRenderProgress } from './broker'

/**
 * The broker client's refusals (decision 282): a master render failed four
 * times with only "broker answered 422", because the deployed broker's
 * timeline rules predated headline and graphic slots, and nothing said so.
 */

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv('AWS_BROKER_URL', 'https://broker.example')
  vi.stubEnv('AWS_BROKER_TOKEN', 'token')
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function answer(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

describe('brokerFetch refusals', () => {
  it('says what the broker refused, and does not retry a refusal', async () => {
    fetchMock.mockImplementation(async () =>
      answer(
        422,
        JSON.stringify({
          error: 'timeline does not validate',
          issues: ['slots.12.payload.kind: Invalid input', 'slots.12.type: Invalid option'],
        }),
      ),
    )
    const refused = fetchRenderProgress('01J0000000000000000000000A')
    await expect(refused).rejects.toBeInstanceOf(NonRetriableError)
    await expect(fetchRenderProgress('01J0000000000000000000000A')).rejects.toThrow(
      'broker answered 422 for GET /renders/01J0000000000000000000000A: timeline does not validate: ' +
        'slots.12.payload.kind: Invalid input; slots.12.type: Invalid option',
    )
  })

  it('retries what can pass on its own: the concurrency cap and a server error', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(409, JSON.stringify({ error: 'render concurrency cap (4) reached' })),
    )
    const capped = await fetchRenderProgress('01J0000000000000000000000A').catch(
      (error: unknown) => error,
    )
    expect(capped).not.toBeInstanceOf(NonRetriableError)
    expect(String(capped)).toContain('render concurrency cap (4) reached')

    fetchMock.mockResolvedValueOnce(answer(502, 'Bad gateway'))
    const down = await fetchRenderProgress('01J0000000000000000000000A').catch(
      (error: unknown) => error,
    )
    expect(down).not.toBeInstanceOf(NonRetriableError)
    expect(String(down)).toContain('502 for GET')
  })
})
