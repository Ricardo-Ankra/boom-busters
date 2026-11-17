import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { BridgeCompleteRequest } from '@boom-busters/providers/llm'
import { describe, expect, it, vi } from 'vitest'
import {
  childEnv,
  completeOnSubscription,
  effortFor,
  flattenMessages,
  type AgentDeps,
} from './agent'
import { BridgeCallError } from './server'

const TOKEN = 'sk-ant-oat01-subscription-token'

const input: BridgeCompleteRequest = {
  model: 'claude-opus-5',
  request: {
    task: 'research',
    system: 'You research collapses.',
    messages: [{ role: 'user', content: 'Enron' }],
    maxTokens: 4000,
  },
}

function success(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '{"answer":true}',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 20,
    },
    ...overrides,
  } as unknown as SDKMessage
}

interface Captured {
  prompt: string | AsyncIterable<SDKUserMessage>
  options: Options
}

function deps(messages: SDKMessage[], baseEnv: Record<string, string> = {}) {
  const captured: Captured[] = []
  const query = vi.fn((params: Captured) => {
    captured.push(params)
    return (async function* () {
      for (const message of messages) yield message
    })()
  })
  const value: AgentDeps = {
    query: query as unknown as AgentDeps['query'],
    token: TOKEN,
    workDir: '/tmp/empty',
    configDir: '/home/me/.boom-busters-llm-bridge/claude',
    baseEnv: { PATH: '/usr/bin', ...baseEnv },
  }
  return { deps: value, captured }
}

describe('completeOnSubscription (decision 469)', () => {
  it('runs plain text generation: no tools, no settings, one turn, no saved session', async () => {
    const { deps: d, captured } = deps([success()])

    await completeOnSubscription(d, input, new AbortController().signal)

    const options = captured[0]!.options
    expect(options).toMatchObject({
      model: 'claude-opus-5',
      systemPrompt: 'You research collapses.',
      tools: [],
      allowedTools: [],
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      maxTurns: 1,
      persistSession: false,
      cwd: '/tmp/empty',
      effort: 'high',
    })
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Write', 'WebFetch']))
    expect(captured[0]!.prompt).toBe('Enron')
  })

  it('gives Claude Code a fresh environment with the token, and never the API key or app secrets', async () => {
    const { deps: d, captured } = deps([success()], {
      ANTHROPIC_API_KEY: 'sk-ant-api03-must-not-leak',
      ANTHROPIC_AUTH_TOKEN: 'must-not-leak',
      DATABASE_URL: 'postgres://must-not-leak',
      SECRETS_ENCRYPTION_KEY: 'must-not-leak',
      SystemRoot: 'C:\\Windows',
    })

    await completeOnSubscription(d, input, new AbortController().signal)

    const env = captured[0]!.options.env!
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe(TOKEN)
    expect(env['CLAUDE_CODE_MAX_OUTPUT_TOKENS']).toBe('4000')
    expect(env['CLAUDE_CONFIG_DIR']).toBe('/home/me/.boom-busters-llm-bridge/claude')
    expect(env['PATH']).toBe('/usr/bin')
    expect(env['SystemRoot']).toBe('C:\\Windows')
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(env).not.toHaveProperty('DATABASE_URL')
    expect(env).not.toHaveProperty('SECRETS_ENCRYPTION_KEY')
    expect(JSON.stringify(env)).not.toContain('must-not-leak')
  })

  it('returns the answer with usage counted as the API adapter counts it', async () => {
    const { deps: d } = deps([success()])

    const result = await completeOnSubscription(d, input, new AbortController().signal)

    expect(result).toEqual({
      text: '{"answer":true}',
      usage: {
        inputTokens: 1020,
        outputTokens: 50,
        cachedInputTokens: 900,
        cacheWriteInputTokens: 20,
      },
      model: 'claude-opus-5',
      truncated: false,
    })
  })

  it('reports a cut-off answer as truncated', async () => {
    const { deps: d } = deps([success({ stop_reason: 'max_tokens' })])
    const result = await completeOnSubscription(d, input, new AbortController().signal)
    expect(result.truncated).toBe(true)
  })

  it('sends images ahead of the text in one user message', async () => {
    const { deps: d, captured } = deps([success()])
    const withImage: BridgeCompleteRequest = {
      ...input,
      request: {
        ...input.request,
        messages: [
          {
            role: 'user',
            content: 'Who is this?',
            images: [{ mimeType: 'image/png', data: 'AAAA' }],
          },
        ],
      },
    }

    await completeOnSubscription(d, withImage, new AbortController().signal)

    const sent: SDKUserMessage[] = []
    for await (const m of captured[0]!.prompt as AsyncIterable<SDKUserMessage>) sent.push(m)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'Who is this?' },
    ])
  })

  it('stops and parks when the plan limit is reached', async () => {
    const { deps: d } = deps([
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' },
      } as unknown as SDKMessage,
      success(),
    ])

    const error = await completeOnSubscription(d, input, new AbortController().signal).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(BridgeCallError)
    expect(error).toMatchObject({ kind: 'plan-limit' })
    expect((error as Error).message).toContain('five_hour')
  })

  it('stops rather than run into paid extra usage', async () => {
    const { deps: d, captured } = deps([
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed', isUsingOverage: true },
      } as unknown as SDKMessage,
      success(),
    ])

    await expect(
      completeOnSubscription(d, input, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'plan-limit' })
    expect(captured[0]!.options.abortController?.signal.aborted).toBe(true)
  })

  it('carries on through an ordinary allowed rate-limit notice', async () => {
    const { deps: d } = deps([
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed_warning', utilization: 0.8 },
      } as unknown as SDKMessage,
      success(),
    ])
    await expect(
      completeOnSubscription(d, input, new AbortController().signal),
    ).resolves.toMatchObject({ text: '{"answer":true}' })
  })

  it('names a refused token as auth', async () => {
    const { deps: d } = deps([
      {
        type: 'assistant',
        parent_tool_use_id: null,
        error: 'authentication_failed',
        message: { content: [] },
      } as unknown as SDKMessage,
      success({ is_error: true, result: 'Invalid API key' }),
    ])
    await expect(
      completeOnSubscription(d, input, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'auth' })
  })

  it('maps an API error status on the result', async () => {
    const overloaded = deps([
      success({
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Overloaded'],
        api_error_status: 529,
      }),
    ])
    await expect(
      completeOnSubscription(overloaded.deps, input, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'upstream', status: 529 })

    const limited = deps([
      success({
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['429'],
        api_error_status: 429,
      }),
    ])
    await expect(
      completeOnSubscription(limited.deps, input, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'plan-limit' })
  })

  it('fails as upstream when Claude Code ends without a result', async () => {
    const { deps: d } = deps([])
    await expect(
      completeOnSubscription(d, input, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'upstream' })
  })
})

describe('flattenMessages', () => {
  it('passes a single user message through untouched', () => {
    expect(flattenMessages([{ role: 'user', content: 'hello' }])).toBe('hello')
  })

  it('marks earlier answers as the model’s own, in order', () => {
    const text = flattenMessages([
      { role: 'user', content: 'corpus' },
      { role: 'assistant', content: '{"brief":1}' },
      { role: 'user', content: 'Now the scenes.' },
    ])
    expect(text).toContain('<your_earlier_answer>\n{"brief":1}\n</your_earlier_answer>')
    expect(text.indexOf('corpus')).toBeLessThan(text.indexOf('{"brief":1}'))
    expect(text.indexOf('{"brief":1}')).toBeLessThan(text.indexOf('Now the scenes.'))
  })
})

describe('effortFor', () => {
  it('matches the API default for each model family', () => {
    expect(effortFor('claude-opus-5-5')).toBe('medium')
    expect(effortFor('claude-haiku-5-5')).toBe('medium')
    expect(effortFor('claude-opus-5')).toBe('high')
    expect(effortFor('claude-sonnet-5-5')).toBe('high')
    expect(effortFor('claude-fable-5-1')).toBe('high')
    expect(effortFor('claude-haiku-4-5-20251001')).toBeUndefined()
  })
})

describe('childEnv', () => {
  it('skips variables that are unset or empty', () => {
    const env = childEnv(
      { token: TOKEN, configDir: '/c', baseEnv: { PATH: '', HOME: '/home/me' } },
      10,
    )
    expect(env).not.toHaveProperty('PATH')
    expect(env['HOME']).toBe('/home/me')
  })
})
