import { mapNetworkError, throwForResponse } from '../llm/http'

export interface ListOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Injected by tests so a rate-limit wait does not make the suite sleep. */
  sleepImpl?: (ms: number) => Promise<void>
}

/** Every list endpoint pages; this caps a runaway cursor. */
export const MAX_PAGES = 20

/**
 * A 200 whose body is not the list this app expects: a body that is not
 * JSON, or JSON of the wrong shape. Both read the same to the owner.
 */
export function unreadableList(provider: string, cause: unknown): Error {
  return new Error(`${provider} returned a model list this app could not read`, { cause })
}

/** One authenticated GET, failures mapped to the shared taxonomy. */
export async function getJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  options: ListOptions,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (cause) {
    throw mapNetworkError(provider, cause)
  }
  if (!response.ok) await throwForResponse(provider, response)
  try {
    return (await response.json()) as unknown
  } catch (cause) {
    if (cause instanceof SyntaxError) throw unreadableList(provider, cause)
    throw cause
  }
}
