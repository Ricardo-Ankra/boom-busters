/**
 * A file's SHA-256 as 64 hex characters, computed in the browser. Every
 * direct upload (a logo, a reference, its frames) is keyed on it: the server
 * recomputes the object key from the fingerprint, so a finalise can only ever
 * record an object this flow issued the URL for.
 */
export async function fingerprint(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
