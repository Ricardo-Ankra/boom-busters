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
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return undefined
}

/**
 * Parse a completion into a validated value, or throw a `ValidationError`
 * carrying enough detail for the runner to feed back on a retry.
 */
export function parseJsonCompletion<T>(text: string, schema: z.ZodType<T>, what: string): T {
  const json = extractJson(text)
  if (!json) {
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

function preview(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed || '(nothing)'
}

/** Issue paths, not a dumped stack — this goes into a run event and a toast. */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}
