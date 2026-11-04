// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { fingerprint } from './client-hash'

describe('fingerprint', () => {
  it('fingerprints a file as 64 hex characters, the same bytes the same way', async () => {
    const a = await fingerprint(new File([new Uint8Array([1, 2, 3])], 'a.bin'))
    const b = await fingerprint(new File([new Uint8Array([1, 2, 3])], 'b.bin'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(b).toBe(a)
    expect(await fingerprint(new File([new Uint8Array([4])], 'c.bin'))).not.toBe(a)
  })
})
