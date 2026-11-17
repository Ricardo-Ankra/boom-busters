import { describe, expect, it } from 'vitest'
import { BridgeConfigError, readBridgeEnv } from './env'

const TOKEN = 'sk-ant-oat01-a-token-that-must-never-be-printed'
const SECRET = 'a-secret-that-is-long-enough-for-hmac-0123'

describe('the bridge start-up check (decision 469)', () => {
  it('starts with the token and secret, on the default port and concurrency', () => {
    expect(readBridgeEnv({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN, LLM_BRIDGE_SECRET: SECRET })).toEqual({
      token: TOKEN,
      secret: SECRET,
      port: 8787,
      concurrency: 3,
    })
  })

  it('refuses to start when ANTHROPIC_API_KEY is set, because it would bill the API', () => {
    expect(() =>
      readBridgeEnv({
        CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
        LLM_BRIDGE_SECRET: SECRET,
        ANTHROPIC_API_KEY: 'sk-ant-api03-x',
      }),
    ).toThrow(/ANTHROPIC_API_KEY is set/)
  })

  it('refuses ANTHROPIC_AUTH_TOKEN for the same reason', () => {
    expect(() =>
      readBridgeEnv({
        CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
        LLM_BRIDGE_SECRET: SECRET,
        ANTHROPIC_AUTH_TOKEN: 'x',
      }),
    ).toThrow(/ANTHROPIC_AUTH_TOKEN is set/)
  })

  it('refuses to start without the subscription token, saying how to get one', () => {
    expect(() => readBridgeEnv({ LLM_BRIDGE_SECRET: SECRET })).toThrow(/claude setup-token/)
  })

  it('refuses a short secret and a nonsense port, listing every problem at once', () => {
    let message = ''
    try {
      readBridgeEnv({
        CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
        LLM_BRIDGE_SECRET: 'x',
        LLM_BRIDGE_PORT: '80',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(BridgeConfigError)
      message = (error as Error).message
    }
    expect(message).toContain('LLM_BRIDGE_SECRET')
    expect(message).toContain('LLM_BRIDGE_PORT')
  })

  it('never prints the token in its complaints', () => {
    try {
      readBridgeEnv({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN, ANTHROPIC_API_KEY: 'k' })
    } catch (error) {
      expect((error as Error).message).not.toContain(TOKEN)
    }
  })
})
