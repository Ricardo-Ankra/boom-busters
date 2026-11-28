import { randomUUID } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, statfsSync } from 'node:fs'
import { freemem, tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'

/**
 * The frames' browser as the host sees it: a process of its own.
 *
 * Vercel's packaged Chromium runs single-process, and its close does not
 * finish more often than it does (seven of twelve closes in the Lambda image,
 * 2026-11-27). A close that was given up on left the process running, with
 * some fifty threads and 20 to 40 MB of the temp folder, on an instance that
 * serves the next request too. So every launch carries a switch of its own
 * (Chromium ignores a switch it does not know), and a browser that will not
 * close is found by that switch in `/proc` and killed. Playwright sees the
 * exit and clears the profile folder as it does after a clean close.
 *
 * Where there is no `/proc` (Windows, macOS) nothing is found and nothing is
 * killed: the hang is the packaged browser's, and that runs on Linux.
 */

/** The switch every launch carries, followed by an id of its own. */
export const LAUNCH_MARK = '--boom-busters-launch='

export function launchMark(): string {
  return `${LAUNCH_MARK}${randomUUID()}`
}

/** The host's process list: `/proc` in the app, a table in the tests. */
export interface HostProcesses {
  /** The entries of the process list. */
  list(): string[]
  /** One file of it as text, `<pid>/cmdline` or `<pid>/status`. */
  read(path: string): string
}

const PROC: HostProcesses = {
  list: () => readdirSync('/proc'),
  read: (path) => readFileSync(`/proc/${path}`, 'utf8'),
}

export interface LaunchedBrowser {
  pid: number
  mark: string
  threads: number
}

/** The browsers this app launched that are still running; null where the host has no process list. */
export function launchedBrowsers(host: HostProcesses = PROC): LaunchedBrowser[] | null {
  let entries: string[]
  try {
    entries = host.list()
  } catch {
    return null
  }
  const found: LaunchedBrowser[] = []
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const mark = host
        .read(`${entry}/cmdline`)
        .split('\0')
        .find((arg) => arg.startsWith(LAUNCH_MARK))
      if (!mark) continue
      const threads = Number(/^Threads:\s*(\d+)/m.exec(host.read(`${entry}/status`))?.[1] ?? 0)
      found.push({ pid: Number(entry), mark, threads })
    } catch {
      // The process went away between the listing and the read.
    }
  }
  return found
}

/** Kills the browser of one launch; how many processes took the signal. */
export function killLaunched(
  mark: string,
  host: HostProcesses = PROC,
  kill: (pid: number) => void = (pid) => process.kill(pid, 'SIGKILL'),
): number {
  let killed = 0
  for (const browser of launchedBrowsers(host) ?? []) {
    if (browser.mark !== mark) continue
    try {
      kill(browser.pid)
      killed += 1
    } catch {
      // Already gone: there is nothing left to kill.
    }
  }
  return killed
}

/**
 * Closes a browser, and kills it when the close fails or does not finish in
 * `ms`. Never throws and never waits longer than `ms`: it runs in a `finally`.
 */
export async function closeOrKill(
  browser: { close(): Promise<void> },
  mark: string | undefined,
  ms: number,
  kill: (mark: string) => number = killLaunched,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const closed = await Promise.race([
    browser.close().then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((done) => {
      timer = setTimeout(() => done(false), ms)
    }),
  ]).finally(() => clearTimeout(timer))
  if (closed || mark === undefined) return
  try {
    kill(mark)
  } catch {
    // A host that cannot be read leaves the browser to the instance's end.
  }
}

function freeTempMb(): number | null {
  try {
    const stats = statfsSync(tmpdir())
    return Math.floor((stats.bavail * stats.bsize) / (1024 * 1024))
  } catch {
    return null
  }
}

/**
 * Under this much room the temp folder is named in the failure: the packaged
 * browser's own files take some 213 MB of Vercel's 500, and an open browser
 * some 16 more, so less than this free means something else has filled it.
 */
export const LOW_TEMP_MB = 100

/** A name in a failure message is cut at this length. */
const TEMP_NAME_MAX = 48
/** No more than this many files are sized: the listing runs on a failing request. */
const TEMP_WALK_MAX = 20_000

export interface TempEntry {
  name: string
  mb: number
}

/**
 * The largest things directly in a folder, a sub-folder counted whole, largest
 * first. Null where the folder cannot be read. A lost browser on Vercel was
 * traced to a temp folder with 6 MB free and nothing of ours running
 * (2026-11-28), and only the instance itself can say what filled it.
 */
export function largestTempEntries(dir: string = tmpdir(), limit = 4): TempEntry[] | null {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return null
  }
  let walked = 0
  const bytesOf = (path: string): number => {
    if (walked >= TEMP_WALK_MAX) return 0
    walked += 1
    try {
      const stats = lstatSync(path)
      if (!stats.isDirectory()) return stats.size
      return readdirSync(path).reduce((sum, name) => sum + bytesOf(join(path, name)), 0)
    } catch {
      // Gone, or not ours to read: it counts for nothing.
      return 0
    }
  }
  return names
    .map((name) => ({ name, bytes: bytesOf(join(dir, name)) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit)
    .map(({ name, bytes }) => ({
      name: name.slice(0, TEMP_NAME_MAX),
      mb: Math.round(bytes / (1024 * 1024)),
    }))
}

/**
 * A nearly full temp folder in words: how large it is, the largest things in
 * it, and the memory the instance has left (a temp folder held in memory
 * shrinks with it). Each part is left out where the host does not tell it.
 */
export function tempDetail(input: {
  totalMb: number | null
  largest: TempEntry[] | null
  memory: { freeMb: number; totalMb: number } | null
}): string {
  const parts: string[] = []
  if (input.totalMb !== null) parts.push(`of ${input.totalMb} MB`)
  const listed = (input.largest ?? []).map((entry) => `${entry.name} ${entry.mb} MB`).join(', ')
  if (listed !== '') parts.push(`largest there: ${listed}`)
  if (input.memory !== null) {
    parts.push(`memory ${input.memory.freeMb} of ${input.memory.totalMb} MB free`)
  }
  return parts.join('; ')
}

function hostTempDetail(): string {
  let totalMb: number | null = null
  try {
    const stats = statfsSync(tmpdir())
    totalMb = Math.floor((stats.blocks * stats.bsize) / (1024 * 1024))
  } catch {
    // The folder's size stays unsaid.
  }
  const mb = (bytes: number) => Math.floor(bytes / (1024 * 1024))
  return tempDetail({
    totalMb,
    largest: largestTempEntries(),
    memory: { freeMb: mb(freemem()), totalMb: mb(totalmem()) },
  })
}

/**
 * What the host can say when a browser is lost, for the failure's own words:
 * a browser that dies tells Playwright nothing of why, and the function's log
 * is gone in an hour. Empty where the host tells nothing. A temp folder that
 * is nearly full is described: its size, its largest things, the memory left.
 */
export function hostFacts(
  host: HostProcesses = PROC,
  freeMb: () => number | null = freeTempMb,
  detail: () => string = hostTempDetail,
): string {
  const facts: string[] = []
  const browsers = launchedBrowsers(host)
  if (browsers !== null) {
    const threads = browsers.reduce((sum, browser) => sum + browser.threads, 0)
    facts.push(
      browsers.length === 0
        ? 'no browser still running'
        : `${browsers.length} ${browsers.length === 1 ? 'browser' : 'browsers'} still running with ${threads} threads`,
    )
  }
  const free = freeMb()
  if (free !== null) {
    const more = free < LOW_TEMP_MB ? detail() : ''
    facts.push(`${free} MB free in the temp folder${more === '' ? '' : ` (${more})`}`)
  }
  return facts.join(', ')
}
