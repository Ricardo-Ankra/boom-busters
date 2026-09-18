import { describe, expect, it } from 'vitest'
import { assertSafeArticleUrl, isPrivateAddress } from './safe-url'

const PUBLIC = () => Promise.resolve([{ address: '93.184.216.34' }])

describe('isPrivateAddress', () => {
  it('names the ranges a fetch must never reach', () => {
    for (const address of [
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254', // the cloud metadata address
      '100.64.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
  })

  it('lets a public address through', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1::1']) {
      expect(isPrivateAddress(address), address).toBe(false)
    }
  })

  it('treats anything it cannot read as private', () => {
    expect(isPrivateAddress('')).toBe(true)
    expect(isPrivateAddress('not-an-address')).toBe(true)
  })
})

describe('assertSafeArticleUrl', () => {
  it('accepts an ordinary article address', async () => {
    const url = await assertSafeArticleUrl('https://news.example/business/story', {
      lookupImpl: PUBLIC,
    })
    expect(url.hostname).toBe('news.example')
  })

  it('refuses a scheme that is not the web', async () => {
    await expect(
      assertSafeArticleUrl('file:///etc/passwd', { lookupImpl: PUBLIC }),
    ).rejects.toThrow(/cannot be fetched over/)
  })

  it('refuses a port no publisher serves on', async () => {
    await expect(
      assertSafeArticleUrl('https://news.example:8080/x', { lookupImpl: PUBLIC }),
    ).rejects.toThrow(/port 8080/)
  })

  it('refuses a raw address and a hostname with no public suffix', async () => {
    await expect(
      assertSafeArticleUrl('https://10.0.0.5/story', { lookupImpl: PUBLIC }),
    ).rejects.toThrow(/not an IP address/)
    await expect(
      assertSafeArticleUrl('http://localhost/story', { lookupImpl: PUBLIC }),
    ).rejects.toThrow(/not a public hostname/)
    await expect(
      assertSafeArticleUrl('http://printer.local/story', { lookupImpl: PUBLIC }),
    ).rejects.toThrow(/not a public hostname/)
  })

  it('refuses a public hostname that resolves somewhere private', async () => {
    await expect(
      assertSafeArticleUrl('https://news.example/story', {
        lookupImpl: () => Promise.resolve([{ address: '127.0.0.1' }]),
      }),
    ).rejects.toThrow(/private network/)
  })

  it('refuses a host that answers from both sides', async () => {
    await expect(
      assertSafeArticleUrl('https://news.example/story', {
        lookupImpl: () =>
          Promise.resolve([{ address: '93.184.216.34' }, { address: '169.254.169.254' }]),
      }),
    ).rejects.toThrow(/private network/)
  })

  it('refuses a name that does not resolve at all', async () => {
    await expect(
      assertSafeArticleUrl('https://news.example/story', { lookupImpl: () => Promise.resolve([]) }),
    ).rejects.toThrow(/does not resolve/)
    await expect(
      assertSafeArticleUrl('https://news.example/story', {
        lookupImpl: () => Promise.reject(new Error('ENOTFOUND')),
      }),
    ).rejects.toThrow(/does not resolve/)
  })

  it('refuses text that is not an address at all', async () => {
    await expect(assertSafeArticleUrl('FT, June 2020', { lookupImpl: PUBLIC })).rejects.toThrow(
      /is not a web address/,
    )
  })
})
