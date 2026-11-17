import type {
  Options,
  query as sdkQuery,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { BridgeCompleteRequest, BridgeCompleteResponse } from '@boom-busters/providers/llm'
import { BridgeCallError } from './server'

/**
 * One Claude call on the owner's subscription, through the Claude Agent SDK
 * (decision 469).
 *
 * The SDK is Claude Code as a library: an agent with shell, file and web
 * tools. This app wants none of that, only text in and text out, and the
 * prompts it sends quote documents nobody here wrote (Wikipedia, court
 * filings, PDFs, transcripts). So every call is shut down to plain text
 * generation: no tools, no settings, skills, hooks or MCP servers from
 * disk, one turn, no saved session, an empty working folder, and a child
 * environment built from scratch that holds the subscription token and the
 * few variables a process needs to start, never ANTHROPIC_API_KEY or any of
 * the app's own secrets.
 */

export interface AgentDeps {
  query: typeof sdkQuery
  token: string
  /** An empty folder the Claude Code process runs in. */
  workDir: string
  /** Claude Code's own config folder for the bridge, apart from the owner's ~/.claude. */
  configDir: string
  /** Where PATH and the OS variables come from; normally process.env. */
  baseEnv: Record<string, string | undefined>
}

/** Every built-in tool, named so that none can come back through a default. */
const BUILT_IN_TOOLS = [
  'Agent',
  'Bash',
  'Edit',
  'Glob',
  'Grep',
  'NotebookEdit',
  'Read',
  'Task',
  'WebFetch',
  'WebSearch',
  'Write',
]

/** What a process needs to start on Windows, macOS or Linux. None of it is a secret. */
const PASSTHROUGH = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'WINDIR',
  'ComSpec',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'LANG',
]

/**
 * The Claude Code process's whole environment. Built from an allow-list, so
 * a key added to the PC's environment later cannot leak in by default.
 */
export function childEnv(
  deps: Pick<AgentDeps, 'token' | 'configDir' | 'baseEnv'>,
  maxTokens: number,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of PASSTHROUGH) {
    const value = deps.baseEnv[key]
    if (value !== undefined && value !== '') env[key] = value
  }
  return {
    ...env,
    CLAUDE_CODE_OAUTH_TOKEN: deps.token,
    CLAUDE_CONFIG_DIR: deps.configDir,
    // The API adapter's max_tokens, so a long answer is cut where it always was.
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxTokens),
    // Fail a busy minute fast: the app's own retry policy and Vercel's
    // 300 s step limit decide what happens next, not ten silent retries.
    CLAUDE_CODE_MAX_RETRIES: '2',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'boom-busters-llm-bridge',
  }
}

/**
 * The effort the API would have used. The API adapter sends none, so the
 * model's own default applies there: medium on Opus 5.5 and Haiku 5.5, high
 * on the other current models. Claude Code's default is higher, which would
 * make the same prompt slower and longer than it is today. Older models get
 * none, as on the API.
 */
export function effortFor(model: string): Options['effort'] {
  if (/^claude-(opus|haiku)-5-5/.test(model)) return 'medium'
  if (/^claude-(opus|sonnet|fable|mythos)-5/.test(model)) return 'high'
  return undefined
}

type Msg = BridgeCompleteRequest['request']['messages'][number]

/**
 * The SDK takes one user turn, so a multi-turn request becomes one message:
 * the earlier answers it carries (the dossier passes hand on the brief and
 * the scenes this way) are marked as the model's own, in order.
 */
export function flattenMessages(messages: readonly Msg[]): string {
  if (messages.length === 1 && messages[0]!.role === 'user') return messages[0]!.content
  const parts = messages.map((m) =>
    m.role === 'assistant'
      ? `<your_earlier_answer>\n${m.content}\n</your_earlier_answer>`
      : m.content,
  )
  const hasEarlier = messages.some((m) => m.role === 'assistant')
  return (
    (hasEarlier
      ? 'Earlier in this conversation you answered as shown in <your_earlier_answer>. Continue from it.\n\n'
      : '') + parts.join('\n\n')
  )
}

function promptFor(messages: readonly Msg[]): string | AsyncIterable<SDKUserMessage> {
  const images = messages.flatMap((m) => m.images ?? [])
  const text = flattenMessages(messages)
  if (images.length === 0) return text

  // Images first, then the words about them, as every adapter sends them.
  const message: SDKUserMessage = {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        ...images.map((image) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: image.mimeType, data: image.data },
        })),
        { type: 'text' as const, text },
      ],
    },
  }
  return (async function* () {
    yield message
  })()
}

function classifyStatus(status: number | null | undefined, message: string): BridgeCallError {
  if (
    status === 401 ||
    status === 403 ||
    /oauth|authenticat|log ?in|unauthori[sz]ed/i.test(message)
  ) {
    return new BridgeCallError('auth', message, status ?? undefined)
  }
  if (status === 429 || /usage limit|hit your limit|rate.?limit/i.test(message)) {
    return new BridgeCallError('plan-limit', message, status ?? undefined)
  }
  if (status === 400 || status === 404) {
    return new BridgeCallError('invalid', message, status)
  }
  return new BridgeCallError('upstream', message, status ?? undefined)
}

const ASSISTANT_ERRORS: Record<string, BridgeCallError['kind']> = {
  authentication_failed: 'auth',
  oauth_org_not_allowed: 'auth',
  account_on_hold: 'auth',
  verification_required: 'auth',
  billing_error: 'plan-limit',
  rate_limit: 'plan-limit',
  overloaded: 'upstream',
  server_error: 'upstream',
  invalid_request: 'invalid',
  model_not_found: 'invalid',
}

function resetText(resetsAt: number | undefined): string {
  if (resetsAt === undefined) return ''
  const ms = resetsAt < 1e12 ? resetsAt * 1000 : resetsAt
  return ` It resets at ${new Date(ms).toLocaleString()}.`
}

export async function completeOnSubscription(
  deps: AgentDeps,
  input: BridgeCompleteRequest,
  signal: AbortSignal,
): Promise<BridgeCompleteResponse> {
  const { request, model } = input
  const abortController = new AbortController()
  const onAbort = () => abortController.abort()
  signal.addEventListener('abort', onAbort)

  const effort = effortFor(model)
  const options: Options = {
    model,
    systemPrompt: request.system,
    tools: [],
    allowedTools: [],
    disallowedTools: BUILT_IN_TOOLS,
    settingSources: [],
    mcpServers: {},
    strictMcpConfig: true,
    maxTurns: 1,
    persistSession: false,
    cwd: deps.workDir,
    env: childEnv(deps, request.maxTokens),
    abortController,
    ...(effort ? { effort } : {}),
  }

  let result: SDKResultMessage | undefined
  let assistantError: string | undefined
  let limit: BridgeCallError | undefined

  try {
    const stream = deps.query({ prompt: promptFor(request.messages), options })
    for await (const message of stream as AsyncIterable<SDKMessage>) {
      if (message.type === 'assistant' && message.parent_tool_use_id === null) {
        if (message.error && message.error !== 'max_output_tokens') assistantError = message.error
      } else if (message.type === 'rate_limit_event') {
        const info = message.rate_limit_info
        if (info.status === 'rejected') {
          limit = new BridgeCallError(
            'plan-limit',
            `your Claude plan's ${info.rateLimitType ?? 'usage'} limit is reached.${resetText(info.resetsAt)}`,
            429,
          )
        } else if (info.isUsingOverage || info.overageInUse) {
          // Past the plan's limit and into paid extra usage. The owner chose
          // parking over paying, so stop here rather than run up a bill.
          limit = new BridgeCallError(
            'plan-limit',
            `your Claude plan's limit is spent and this call would use paid extra usage.${resetText(info.resetsAt)}`,
            429,
          )
        }
        if (limit) {
          abortController.abort()
          break
        }
      } else if (message.type === 'result') {
        result = message
      }
    }
  } catch (error) {
    if (limit) throw limit
    if (signal.aborted) throw error
    const text = error instanceof Error ? error.message : String(error)
    throw classifyStatus(undefined, text)
  } finally {
    signal.removeEventListener('abort', onAbort)
  }

  if (limit) throw limit
  if (assistantError) {
    const kind = ASSISTANT_ERRORS[assistantError] ?? 'upstream'
    throw new BridgeCallError(kind, `Claude Code reported ${assistantError}`)
  }
  if (!result) throw new BridgeCallError('upstream', 'Claude Code ended without a result')

  if (result.subtype !== 'success' || result.is_error) {
    const status = 'api_error_status' in result ? result.api_error_status : undefined
    const message =
      result.subtype === 'success'
        ? result.result
        : result.errors.length > 0
          ? result.errors.join('; ')
          : result.subtype
    throw classifyStatus(status, message || result.subtype)
  }

  const usage = result.usage
  const cached = usage.cache_read_input_tokens ?? 0
  const written = usage.cache_creation_input_tokens ?? 0
  return {
    text: result.result,
    usage: {
      // Counted as the API adapter counts them: cache reads and writes are
      // part of the input, so the ledger reads the same either way.
      inputTokens: usage.input_tokens + cached + written,
      outputTokens: usage.output_tokens,
      ...(cached > 0 ? { cachedInputTokens: cached } : {}),
      ...(written > 0 ? { cacheWriteInputTokens: written } : {}),
    },
    model,
    truncated: result.stop_reason === 'max_tokens',
  }
}
