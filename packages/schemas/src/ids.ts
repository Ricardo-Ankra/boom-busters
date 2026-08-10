import { ulid } from 'ulid'
import { z } from 'zod'

/**
 * Every table in the data model (build spec section 5) is keyed by a ULID.
 * Ids are branded per entity so a `CaseId` can never be passed where a
 * `ProjectId` is expected — a real hazard once the pipeline starts threading
 * six kinds of id through Inngest step payloads.
 */

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

export const UlidSchema = z.string().regex(ULID_PATTERN, 'must be a 26-character ULID')

declare const brand: unique symbol
type Brand<T extends string> = { readonly [brand]: T }

export type Ulid<T extends string> = string & Brand<T>

export type CaseId = Ulid<'case'>
export type ProjectId = Ulid<'project'>
export type DossierId = Ulid<'dossier'>
export type ClaimId = Ulid<'claim'>
export type ScriptId = Ulid<'script'>
export type ChapterId = Ulid<'chapter'>
export type VoiceTakeId = Ulid<'voiceTake'>
export type ShotSlotId = Ulid<'shotSlot'>
export type AssetId = Ulid<'asset'>
export type TimelineId = Ulid<'timeline'>
export type RenderId = Ulid<'render'>
export type ShortId = Ulid<'short'>
export type PublishRecordId = Ulid<'publishRecord'>
export type RunId = Ulid<'run'>

/** Fresh, monotonically sortable id. */
export function newId<T extends string>(): Ulid<T> {
  return ulid() as Ulid<T>
}

/** Parse an untrusted string into a branded id, throwing if malformed. */
export function toId<T extends string>(value: string): Ulid<T> {
  return UlidSchema.parse(value) as Ulid<T>
}

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value)
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
