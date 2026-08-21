// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

/** The pulse route: authenticated, scoped by ?project, always no-store. */

const session = vi.hoisted(() => ({ value: null as { user: { email: string } } | null }))
vi.mock('@/auth', () => ({ auth: () => Promise.resolve(session.value) }))
vi.mock('@/lib/db', () => ({ db: {} }))

const pulses = vi.hoisted(() => ({
  projectPulse: vi.fn(),
  globalPulse: vi.fn(),
}))
vi.mock('@boom-busters/db', () => ({
  projectPulse: pulses.projectPulse,
  globalPulse: pulses.globalPulse,
}))

const PROJECT = '01HQ0000000000000000000PR1'

beforeEach(() => {
  vi.clearAllMocks()
  session.value = { user: { email: 'owner@example.com' } }
  pulses.projectPulse.mockResolvedValue('1787327000.123')
  pulses.globalPulse.mockResolvedValue('1787327111.456')
})

describe('GET /api/pulse', () => {
  it('requires a session', async () => {
    session.value = null
    const response = await GET(new Request('http://localhost/api/pulse'))
    expect(response.status).toBe(401)
  })

  it('answers the global pulse without a project param', async () => {
    const response = await GET(new Request('http://localhost/api/pulse'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ pulse: '1787327111.456' })
    expect(pulses.projectPulse).not.toHaveBeenCalled()
  })

  it('scopes to one project with ?project', async () => {
    const response = await GET(new Request(`http://localhost/api/pulse?project=${PROJECT}`))
    expect(await response.json()).toEqual({ pulse: '1787327000.123' })
    expect(pulses.projectPulse).toHaveBeenCalledWith({}, PROJECT)
  })

  it('rejects a malformed project id before touching the database', async () => {
    const response = await GET(new Request('http://localhost/api/pulse?project=nope'))
    expect(response.status).toBe(400)
    expect(pulses.projectPulse).not.toHaveBeenCalled()
    expect(pulses.globalPulse).not.toHaveBeenCalled()
  })
})
