import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  closeOrKill,
  hostFacts,
  killLaunched,
  largestTempEntries,
  LAUNCH_MARK,
  launchedBrowsers,
  launchMark,
  LOW_TEMP_MB,
  tempDetail,
  type HostProcesses,
} from './browser-process'

/** A `/proc` of the given processes: `cmdline` is NUL-separated, as the kernel writes it. */
function procOf(
  processes: Record<string, { args: string[]; threads: number } | 'gone'>,
  extra: string[] = [],
): HostProcesses {
  return {
    list: () => [...Object.keys(processes), ...extra],
    read: (path) => {
      const [pid, file] = path.split('/')
      const found = processes[pid ?? '']
      if (!found || found === 'gone') throw new Error('ENOENT')
      if (file === 'cmdline') return `${found.args.join('\0')}\0`
      return `Name:\tchromium\nState:\tS (sleeping)\nThreads:\t${found.threads}\n`
    },
  }
}

const MARK_A = `${LAUNCH_MARK}aaaa`
const MARK_B = `${LAUNCH_MARK}bbbb`

describe('launchMark', () => {
  it('is a switch of its own for every launch', () => {
    const first = launchMark()
    expect(first.startsWith(LAUNCH_MARK)).toBe(true)
    expect(first.length).toBeGreaterThan(LAUNCH_MARK.length + 8)
    expect(launchMark()).not.toBe(first)
  })
})

describe('launchedBrowsers', () => {
  it('finds the processes that carry a launch mark, with their threads', () => {
    const host = procOf(
      {
        '12': { args: ['node', 'server.js'], threads: 11 },
        '40': { args: ['/tmp/chromium', '--single-process', MARK_A], threads: 49 },
        '41': { args: ['/tmp/chromium', MARK_B, '--no-zygote'], threads: 48 },
        '42': 'gone',
      },
      ['self', 'meminfo'],
    )
    expect(launchedBrowsers(host)).toEqual([
      { pid: 40, mark: MARK_A, threads: 49 },
      { pid: 41, mark: MARK_B, threads: 48 },
    ])
  })

  it('is null where the host has no process list to read', () => {
    const host: HostProcesses = {
      list: () => {
        throw new Error('ENOENT: no such file or directory, scandir /proc')
      },
      read: () => '',
    }
    expect(launchedBrowsers(host)).toBeNull()
  })
})

describe('killLaunched', () => {
  it('kills the browser of that launch and no other', () => {
    const host = procOf({
      '40': { args: ['/tmp/chromium', MARK_A], threads: 49 },
      '41': { args: ['/tmp/chromium', MARK_B], threads: 48 },
    })
    const kill = vi.fn()
    expect(killLaunched(MARK_B, host, kill)).toBe(1)
    expect(kill.mock.calls).toEqual([[41]])
  })

  it('counts nothing for a browser that is already gone', () => {
    const host = procOf({ '40': { args: ['/tmp/chromium', MARK_A], threads: 49 } })
    const kill = vi.fn(() => {
      throw new Error('ESRCH')
    })
    expect(killLaunched(MARK_A, host, kill)).toBe(0)
    expect(killLaunched(MARK_B, host, kill)).toBe(0)
  })
})

describe('closeOrKill', () => {
  it('leaves a browser that closes in time alone', async () => {
    const kill = vi.fn(() => 1)
    await closeOrKill({ close: async () => undefined }, MARK_A, 50, kill)
    expect(kill).not.toHaveBeenCalled()
  })

  it('kills a browser whose close does not finish', async () => {
    const kill = vi.fn(() => 1)
    const started = Date.now()
    await closeOrKill({ close: () => new Promise<void>(() => undefined) }, MARK_A, 30, kill)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(kill.mock.calls).toEqual([[MARK_A]])
  })

  it('kills what is left of a browser whose close fails', async () => {
    const kill = vi.fn(() => 0)
    await closeOrKill({ close: () => Promise.reject(new Error('Target closed')) }, MARK_A, 50, kill)
    expect(kill.mock.calls).toEqual([[MARK_A]])
  })

  it('has nothing to kill for a launch that was given no mark', async () => {
    const kill = vi.fn(() => 1)
    await closeOrKill({ close: () => new Promise<void>(() => undefined) }, undefined, 20, kill)
    expect(kill).not.toHaveBeenCalled()
  })
})

describe('hostFacts', () => {
  it('counts the browsers still running and the room left in the temp folder', () => {
    const host = procOf({
      '40': { args: ['/tmp/chromium', MARK_A], threads: 49 },
      '41': { args: ['/tmp/chromium', MARK_B], threads: 48 },
    })
    expect(hostFacts(host, () => 212)).toBe(
      '2 browsers still running with 97 threads, 212 MB free in the temp folder',
    )
  })

  it('says one browser in the singular and none plainly', () => {
    const one = procOf({ '40': { args: ['/tmp/chromium', MARK_A], threads: 49 } })
    expect(hostFacts(one, () => null)).toBe('1 browser still running with 49 threads')
    expect(hostFacts(procOf({}), () => 300)).toBe(
      'no browser still running, 300 MB free in the temp folder',
    )
  })

  it('is empty where the host tells it nothing', () => {
    const host: HostProcesses = {
      list: () => {
        throw new Error('ENOENT')
      },
      read: () => '',
    }
    expect(hostFacts(host, () => null)).toBe('')
  })

  it('describes a temp folder that is nearly full', () => {
    const detail = vi.fn(() => 'of 512 MB; largest there: chromium 200 MB')
    expect(hostFacts(procOf({}), () => 6, detail)).toBe(
      'no browser still running, 6 MB free in the temp folder (of 512 MB; largest there: chromium 200 MB)',
    )
  })

  it('says nothing more of the folder while there is room', () => {
    const detail = vi.fn(() => 'of 512 MB')
    expect(hostFacts(procOf({}), () => LOW_TEMP_MB, detail)).toBe(
      `no browser still running, ${LOW_TEMP_MB} MB free in the temp folder`,
    )
    expect(detail).not.toHaveBeenCalled()
  })

  it('adds nothing where the host has no more to say', () => {
    const none = () => ''
    expect(hostFacts(procOf({}), () => 6, none)).toBe(
      'no browser still running, 6 MB free in the temp folder',
    )
  })

  it('describes the real temp folder without throwing', () => {
    // The real host, whatever it is: the words are the host's, the shape is ours.
    const facts = hostFacts(procOf({}), () => 6)
    expect(facts.startsWith('no browser still running, 6 MB free in the temp folder')).toBe(true)
    expect(facts).toMatch(/memory \d+ of \d+ MB free\)$/)
  })
})

describe('tempDetail', () => {
  it("gives the folder's size, its largest things and the memory left", () => {
    expect(
      tempDetail({
        totalMb: 512,
        largest: [
          { name: 'chromium', mb: 200 },
          { name: 'core.1234', mb: 180 },
        ],
        memory: { freeMb: 1430, totalMb: 2048 },
      }),
    ).toBe(
      'of 512 MB; largest there: chromium 200 MB, core.1234 180 MB; memory 1430 of 2048 MB free',
    )
  })

  it('leaves out what the host does not tell', () => {
    expect(tempDetail({ totalMb: null, largest: null, memory: null })).toBe('')
    expect(tempDetail({ totalMb: 512, largest: [], memory: null })).toBe('of 512 MB')
    expect(tempDetail({ totalMb: null, largest: [{ name: 'a', mb: 3 }], memory: null })).toBe(
      'largest there: a 3 MB',
    )
  })
})

describe('largestTempEntries', () => {
  it('sizes files and whole folders, largest first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-temp-facts-'))
    try {
      const mb = (count: number) => Buffer.alloc(count * 1024 * 1024)
      writeFileSync(join(dir, 'binary'), mb(3))
      mkdirSync(join(dir, 'profile', 'cache'), { recursive: true })
      writeFileSync(join(dir, 'profile', 'a'), mb(1))
      writeFileSync(join(dir, 'profile', 'cache', 'b'), mb(1))
      writeFileSync(join(dir, 'note.txt'), 'small')
      expect(largestTempEntries(dir, 2)).toEqual([
        { name: 'binary', mb: 3 },
        { name: 'profile', mb: 2 },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cuts a long name short', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-temp-facts-'))
    try {
      writeFileSync(join(dir, 'x'.repeat(90)), Buffer.alloc(1024 * 1024))
      const [entry] = largestTempEntries(dir, 1) ?? []
      expect(entry?.name).toBe('x'.repeat(48))
      expect(entry?.mb).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is null for a folder that is not there', () => {
    expect(largestTempEntries(join(tmpdir(), 'bb-no-such-folder-here'), 3)).toBeNull()
  })
})
