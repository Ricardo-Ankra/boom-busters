import { readFileSync } from 'node:fs'

const dir = new URL('./fixtures/', import.meta.url)

export function fixture(name: string): string {
  return readFileSync(new URL(name, dir), 'utf8')
}

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, dir)))
}
