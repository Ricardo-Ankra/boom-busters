import { monotonicFactory } from 'ulid'
import { z } from 'zod'

/**
 * Every table in the data model (build spec section 5) is keyed by a ULID.
 * Ids travel through the codebase as plain strings; `UlidSchema` is the
 * check applied to untrusted id strings at the server-action and webhook
 * boundaries.
 */

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

export const UlidSchema = z.string().regex(ULID_PATTERN, 'must be a 26-character ULID')

declare const brand: unique symbol
type Brand<T extends string> = { readonly [brand]: T }

export type Ulid<T extends string> = string & Brand<T>

/**
 * The monotonic factory, not the plain `ulid()` (decision 267).
 *
 * A plain ULID's random half is fresh on every call, so two ids minted in
 * the same millisecond sort by coin flip. Rows created in one loop, which is
 * how the Director's Book seeds its principals and its locations, then share
 * a `created_at` to the millisecond, and every list query breaks that tie on
 * the id. The order the producer sees, and the order the reference photos
 * reach the image model in, was whichever way the coin landed. The factory
 * increments the random half instead while the millisecond lasts, so ids
 * mint in creation order.
 *
 * One process at a time: two of them minting in the same millisecond can
 * still tie. That is not the case this protects, and no code path creates a
 * single ordered set of rows from two processes at once.
 */
const nextId = monotonicFactory()

/** Fresh id, sorting in creation order. */
export function newId<T extends string>(): Ulid<T> {
  return nextId() as Ulid<T>
}

/**
 * Deterministic id for fixtures. The seed script and golden tests need stable
 * ids across runs; `newId()` is random by design, so fixtures use this instead.
 * `slot` must be 0-999.
 */
export function fixtureId<T extends string>(prefix: string, slot: number): Ulid<T> {
  if (!Number.isInteger(slot) || slot < 0 || slot > 999) {
    throw new RangeError(`fixtureId slot must be an integer 0-999, got ${slot}`)
  }
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const body = prefix
    .toUpperCase()
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, '')
    .slice(0, 22)
    .padEnd(22, '0')
  const suffix = slot
    .toString()
    .padStart(3, '0')
    .replace(/\d/g, (d) => alphabet[Number(d)]!)
  return `0${body}${suffix}` as Ulid<T>
}
