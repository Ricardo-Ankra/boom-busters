import { ValidationError } from '@boom-busters/schemas'

/**
 * What the article fetch is allowed to open (decision 257).
 *
 * The URL being fetched came from the research model, by way of a claim's
 * `sourceUrl`. That makes it the one piece of attacker-adjacent input in the
 * whole feature: a poisoned dossier could name an address on the infrastructure
 * the app runs on rather than a newspaper, and a fetch is a fetch. So every
 * address is checked before the socket opens, and again on every redirect hop,
 * because a public hostname is free to redirect anywhere it likes.
 *
 * Deliberately strict rather than clever. A news article is served over http or
 * https, on the default port, at a hostname. Anything else is refused, and the
 * cost of refusing a legitimate address is one line typed by hand on the board.
 */

export interface UrlGuardOptions {
  /** Injected by tests. Defaults to `dns.promises.lookup` with `all: true`. */
  lookupImpl?: (hostname: string) => Promise<{ address: string }[]>
}

/** Redirect chains end somewhere. Five hops is more than any publisher needs. */
export const MAX_REDIRECT_HOPS = 5

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** `[::1]` and friends arrive with the brackets still on from `URL.hostname`. */
function bareHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function looksLikeIpAddress(hostname: string): boolean {
  const host = bareHost(hostname)
  return IPV4.test(host) || host.includes(':')
}

function privateIpv4(address: string): boolean {
  const parts = IPV4.exec(address)
  if (!parts) return false
  const [a, b] = [Number(parts[1]), Number(parts[2])]
  if (a === undefined || b === undefined || a > 255 || b > 255) return true

  if (a === 0 || a === 127) return true // this host, loopback
  if (a === 10) return true // private
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a === 169 && b === 254) return true // link-local, and cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast and reserved
  return false
}

/**
 * Whether an address resolved from DNS is one the app must not talk to.
 * Unknown shapes are treated as private: the safe default for "I cannot tell
 * what this is" is not to open it.
 */
export function isPrivateAddress(address: string): boolean {
  const value = bareHost(address.trim().toLowerCase())
  if (value === '') return true

  if (IPV4.test(value)) return privateIpv4(value)
  if (!value.includes(':')) return true

  // IPv6. A mapped v4 address (::ffff:10.0.0.1) is a v4 address wearing a hat.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value)
  if (mapped?.[1]) return privateIpv4(mapped[1])

  if (value === '::' || value === '::1') return true
  const head = value.split(':')[0] ?? ''
  if (head === '') return false // a global address written as ::abcd is not one we expect
  const group = Number.parseInt(head.padEnd(4, '0'), 16)
  if (Number.isNaN(group)) return true
  if ((group & 0xfe00) === 0xfc00) return true // unique local, fc00::/7
  if ((group & 0xffc0) === 0xfe80) return true // link local, fe80::/10
  return false
}

async function defaultLookup(hostname: string): Promise<{ address: string }[]> {
  const { promises } = await import('node:dns')
  return promises.lookup(hostname, { all: true })
}

/**
 * Parse and vet one URL. Throws a `ValidationError` naming the reason, which
 * travels to the board as the article record's failure reason.
 */
export async function assertSafeArticleUrl(
  raw: string,
  options: UrlGuardOptions = {},
): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ValidationError(`"${raw}" is not a web address`, { field: 'article.url' })
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError(`An article cannot be fetched over ${url.protocol}`, {
      field: 'article.url',
    })
  }
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new ValidationError(`An article is not served on port ${url.port}`, {
      field: 'article.url',
    })
  }
  if (looksLikeIpAddress(url.hostname)) {
    throw new ValidationError('An article is published at a hostname, not an IP address', {
      field: 'article.url',
    })
  }
  if (url.hostname.endsWith('.local') || !url.hostname.includes('.')) {
    throw new ValidationError(`"${url.hostname}" is not a public hostname`, {
      field: 'article.url',
    })
  }

  const lookup = options.lookupImpl ?? defaultLookup
  let addresses: { address: string }[]
  try {
    addresses = await lookup(url.hostname)
  } catch {
    throw new ValidationError(`"${url.hostname}" does not resolve`, { field: 'article.url' })
  }

  if (addresses.length === 0) {
    throw new ValidationError(`"${url.hostname}" does not resolve`, { field: 'article.url' })
  }
  // Every address, not the first: a host that resolves to one public and one
  // private address is a host that can be made to answer from either.
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new ValidationError(`"${url.hostname}" resolves inside a private network`, {
      field: 'article.url',
    })
  }

  return url
}
