import { mapNetworkError, throwForResponse } from '../llm/http'

export interface ListOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/** Every list endpoint pages; this caps a runaway cursor. */
export const MAX_PAGES = 20

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
  return response.json()
}
