import { ValidationError } from '@boom-busters/schemas'
import type { z } from 'zod'

/**
 * Getting structured data back out of a completion.
 *
 * Every model in this app is asked for JSON, and every model occasionally
 * wraps it in a ```json fence, prefixes it with "Here is the JSON you asked
 * for:", or appends a closing remark. None of that is a failure worth retrying
 * a $2 research call over, so this extracts the JSON object rather than
 * insisting the whole completion parse.
 *
 * What it deliberately does not do is repair malformed JSON — no quote
 * balancing, no trailing-comma stripping, no bracket guessing. A model that
 * produced broken JSON produced broken *content*, and silently patching the
 * syntax yields a dossier with half a claim in it. That case throws a
 * `ValidationError`, which the runner turns into a retry with the parse error
 * fed back in.
 */

/**
 * Find the outermost JSON object or array in a completion.
 *
 * Brace counting rather than a regex, because a regex either stops at the
 * first `}` (truncating nested objects) or is greedy to the last one (swallowing
 * trailing prose). String literals are tracked so a `}` inside a quoted claim
 * does not close the object early.
 */
export function extractJson(text: string): string | undefined {
  const start = text.search(/[[{]/)
  if (start === -1) return undefined
  const end = balancedEnd(text, start)
  return end === undefined ? undefined : text.slice(start, end + 1)
}

/** Where the object or array opening at `start` closes, or undefined when it never does. */
function balancedEnd(text: string, start: number): number | undefined {
  const opener = text[start]!
  const closer = opener === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === opener) depth += 1
    else if (char === closer) {
      depth -= 1
      if (depth === 0) return i
    }
  }

  return undefined
}

/**
 * The regions after the first, for when the first one is not the answer
 * (decision 472), longest first. A model answering through the subscription
 * bridge often writes a line or a fragment of code before its JSON, and the
 * first bracket was then a stray `[head.length - 1]` or `{top, right}`:
 * production read "malformed JSON" or "expected object, received array" off
 * a good answer behind it.
 *
 * Only regions side by side: each scan resumes after the region it found, so
 * a piece nested inside an answer is never a candidate, and the scan stops at
 * the first opener that never closes (an answer cut off), so nothing inside
 * that is either. Each character is scanned once.
 */
function laterRegions(text: string, after: number): string[] {
  const found: string[] = []
  let from = after
  while (from < text.length) {
    const offset = text.slice(from).search(/[[{]/)
    if (offset === -1) break
    const start = from + offset
    const end = balancedEnd(text, start)
    if (end === undefined) break
    found.push(text.slice(start, end + 1))
    from = end + 1
  }
  return found.sort((a, b) => b.length - a.length)
}

/** The value of the first candidate that parses and fits the schema, or undefined. */
function firstFitting<T>(candidates: readonly string[], schema: z.ZodType<T>): T | undefined {
  for (const json of candidates) {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      continue
    }
    const result = schema.safeParse(parsed)
    if (result.success) return result.data
  }
  return undefined
}

/**
 * Parse a completion into a validated value, or throw a `ValidationError`
 * carrying enough detail for the runner to feed back on a retry.
 */
export function parseJsonCompletion<T>(text: string, schema: z.ZodType<T>, what: string): T {
  try {
    return parseFirstJson(text, schema, what)
  } catch (error) {
    // The first region was not the answer: look for the answer after it
    // (decision 472). Only when it closed: an answer whose first region never
    // closes was cut off or holds no JSON, and says so. Nothing that fits,
    // and the first region's error stands.
    if (!(error instanceof ValidationError)) throw error
    const start = text.search(/[[{]/)
    const end = start === -1 ? undefined : balancedEnd(text, start)
    if (end === undefined) throw error
    const found = firstFitting(laterRegions(text, end + 1), schema)
    if (found !== undefined) return found
    throw error
  }
}

function parseFirstJson<T>(text: string, schema: z.ZodType<T>, what: string): T {
  const json = extractJson(text)
  if (!json) {
    /**
     * An answer that begins a JSON object and never closes it was cut off, not
     * malformed — and the two need completely different responses. "No JSON"
     * sends you to read the prompt; the prompt is fine, and `maxTokens` is the
     * thing to raise.
     *
     * The adapter already reports the case where the model wrote *nothing*.
     * This is its other half: the model wrote most of a brief and ran out mid
     * sentence, which in production read as "The model returned no JSON for
     * case brief. It answered: { "summary": "Carillion plc was the UK's..." —
     * an error message quoting a perfectly good answer while claiming there
     * wasn't one.
     */
    if (startsJson(text)) {
      throw new ValidationError(
        `The model's ${what} was cut off mid-answer — it opened a JSON object and never ` +
          `closed it, which means it ran out of output tokens. Raise maxTokens for this task. ` +
          `It got as far as: ${preview(text)}`,
        { field: 'maxTokens' },
      )
    }

    throw new ValidationError(
      `The model returned no JSON for ${what}. It answered: ${preview(text)}`,
      { field: what },
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (cause) {
    throw new ValidationError(
      `The model returned malformed JSON for ${what}: ${(cause as Error).message}`,
      { field: what, cause },
    )
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new ValidationError(
      `The model's ${what} did not match the expected shape: ${formatIssues(result.error)}`,
      { field: what },
    )
  }

  return result.data
}

/**
 * Did the model start writing JSON?
 *
 * Only reached when `extractJson` found no complete value, so an opener with
 * no matching closer means the answer stops in the middle of one. Prose that
 * merely mentions a brace ("use { and }") does not qualify — the opener has to
 * be the first non-whitespace thing after any prologue the model wrote, which
 * is what a model answering in JSON actually produces.
 */
function startsJson(text: string): boolean {
  const start = text.search(/[[{]/)
  if (start === -1) return false
  // Anything before the brace must be a short lead-in ("Here is the JSON:"),
  // not a paragraph that happens to contain one.
  return text.slice(0, start).trim().length <= 60
}

function preview(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed || '(nothing)'
}

/** Issue paths, not a dumped stack — this goes into a run event and a toast. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}
