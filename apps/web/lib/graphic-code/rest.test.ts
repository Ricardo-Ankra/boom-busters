// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { restIssue } from './rest'

const WORDS = [
  { text: 'four', atMs: 900 },
  { text: 'billion.', atMs: 1200 },
]

/** One sample per 250 ms: `before` until `changeAtMs`, `after` from then on. */
function samples(durationMs: number, changeAtMs: number, before: string, after: string): string[] {
  const out: string[] = []
  for (let atMs = 0; atMs <= durationMs; atMs += 250) out.push(atMs < changeAtMs ? before : after)
  return out
}

describe('restIssue', () => {
  it('passes text that is constant once the last word has settled', () => {
    expect(restIssue(samples(6000, 1500, 'four', '$4bn'), WORDS, 250)).toBeNull()
  })

  it('refuses text that changes well after after the last word', () => {
    expect(restIssue(samples(6000, 2700, '$4bn', '$4bn Acme'), WORDS, 250)).toBe(
      'the graphic is still changing 1550 ms after its last word; after the last word lands, only the camera may move',
    )
  })

  it('allows a change inside the 700 ms settle after the last word', () => {
    expect(restIssue(samples(6000, 1850, '$4', '$4bn'), WORDS, 250)).toBeNull()
  })

  it('has nothing to say when there are no words', () => {
    expect(restIssue(samples(6000, 2700, 'a', 'b'), [], 250)).toBeNull()
  })
})
