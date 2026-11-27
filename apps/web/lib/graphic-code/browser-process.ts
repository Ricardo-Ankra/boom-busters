import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statfsSync } from 'node:fs'
import { tmpdir } from 'node:os'

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
 * What the host can say when a browser is lost, for the failure's own words:
 * a browser that dies tells Playwright nothing of why, and the function's log
 * is gone in an hour. Empty where the host tells nothing.
 */
export function hostFacts(
  host: HostProcesses = PROC,
  freeMb: () => number | null = freeTempMb,
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
  if (free !== null) facts.push(`${free} MB free in the temp folder`)
  return facts.join(', ')
}
