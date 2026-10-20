/**
 * The case-finder back-test CLI (plan Task 13). Thin on purpose: it parses
 * the arguments, wires live or mock sources and calls src/backtest/run.ts.
 *
 *   pnpm --filter @boom-busters/case-finder backtest <hitlist|subjects|run> [flags]
 *
 * Without --live every source is a mock and nothing touches the network.
 * The baseline LLM call is the one paid call: it needs --live and --baseline
 * with a provider and model, and its key from env.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  buildScoreNamedCasesRequest,
  knownModel,
  LIVE_ADAPTERS,
  mockProvidersEnabled,
  priceOf,
} from '@boom-busters/providers'
import { PROVIDER_ENV_SEEDS, readCaseFinderEnv } from '@boom-busters/schemas'
import { parseCliArgs, type CliArgs } from '../src/backtest/cli-args'
import {
  runBacktest,
  runHitlist,
  runSubjects,
  type BaselineScorer,
  type CliContext,
  type GitAdapter,
} from '../src/backtest/run'
import type { Sources } from '../src/evidence'
import { liveCourtListener } from '../src/sources/courtlistener'
import { liveEdgar } from '../src/sources/edgar'
import { createPoliteClient } from '../src/sources/http'
import {
  mockCourtListener,
  mockEdgar,
  mockPageviews,
  mockSecReleases,
  mockWikidata,
  mockWikipedia,
  mockYoutube,
} from '../src/sources/mock'
import { livePageviews } from '../src/sources/pageviews'
import { createQuotaLedger, QuotaExhaustedError } from '../src/sources/quota'
import { liveSecReleases } from '../src/sources/sec-releases'
import { liveWikidata } from '../src/sources/wikidata'
import { liveWikipedia } from '../src/sources/wikipedia'
import { liveYoutube } from '../src/sources/youtube'

const run = promisify(execFile)

function repoRoot(from: string): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    if (path.dirname(dir) === dir) throw new Error('No pnpm-workspace.yaml above ' + from)
  }
}

function gitAt(root: string): GitAdapter {
  const git = async (...args: string[]) => (await run('git', args, { cwd: root })).stdout
  return {
    porcelain: (relPath) => git('status', '--porcelain', '--', relPath),
    isTracked: async (relPath) => {
      try {
        await git('ls-files', '--error-unmatch', '--', relPath)
        return true
      } catch {
        return false
      }
    },
    head: async () => (await git('rev-parse', '--short', 'HEAD')).trim(),
    blob: async (relPath) => (await git('rev-parse', `HEAD:${relPath}`)).trim(),
  }
}

const MOCK_SOURCES: Sources = {
  pageviews: mockPageviews,
  wikidata: mockWikidata,
  wikipedia: mockWikipedia,
  youtube: mockYoutube,
  courtlistener: mockCourtListener,
  edgar: mockEdgar,
  secReleases: mockSecReleases,
}

/** The paid call, checked before any other work so a bad key or model id costs nothing. */
function baselineScorer(baseline: NonNullable<CliArgs['baseline']>): BaselineScorer {
  const { provider, model } = baseline
  const keyName = PROVIDER_ENV_SEEDS[provider]
  const apiKey = process.env[keyName]?.trim()
  if (!apiKey) throw new Error(`--baseline needs ${keyName} in .env.local. Nothing was spent.`)
  const known = knownModel(provider, model)
  if (known === undefined) {
    throw new Error(`Unknown ${provider} model "${model}". Nothing was spent.`)
  }
  return {
    model,
    async ask(names) {
      const result = await LIVE_ADAPTERS[provider].complete(buildScoreNamedCasesRequest(names), {
        apiKey,
        model,
      })
      return {
        text: result.text,
        costUsd: priceOf(known, result.usage),
        answeredBy: `${result.provider}/${result.model}`,
      }
    },
  }
}

async function main(): Promise<number> {
  const args = parseCliArgs(process.argv.slice(2))
  if (args.live && mockProvidersEnabled(process.env)) {
    throw new Error('MOCK_PROVIDERS=1 is set: unset it for a --live run')
  }
  const root = repoRoot(import.meta.dirname)
  const now = new Date()
  const baseline = args.baseline === null ? null : baselineScorer(args.baseline)

  let sources = MOCK_SOURCES
  let fetchText = async (_url: string) => 'rank,company\n'
  let quotaNote = () => 'mock run: no YouTube units spent'
  let spentNote = () => ''
  if (args.live) {
    const env = readCaseFinderEnv()
    const missing = (
      ['DATA_CONTACT_EMAIL', 'YOUTUBE_DATA_API_KEY', 'COURTLISTENER_TOKEN'] as const
    ).filter((key) => env[key] === undefined)
    if (missing.length > 0) throw new Error(`--live needs ${missing.join(', ')} in .env.local`)
    const client = createPoliteClient({
      contact: env.DATA_CONTACT_EMAIL!,
      cacheDir: path.join(root, '.cache', 'case-finder'),
      now: () => now,
    })
    const ledger = createQuotaLedger(args.dailyUnits, args.spentToday)
    sources = {
      pageviews: livePageviews(client),
      wikidata: liveWikidata(client),
      wikipedia: liveWikipedia(client),
      youtube: liveYoutube(client, env.YOUTUBE_DATA_API_KEY!, ledger),
      courtlistener: liveCourtListener(client, env.COURTLISTENER_TOKEN!),
      edgar: liveEdgar(client),
      secReleases: liveSecReleases(client),
    }
    fetchText = async (url) => {
      const res = await client.getText(url)
      if (res.status < 200 || res.status >= 300) throw new Error(`status ${res.status}`)
      return res.data
    }
    const spent = () => args.dailyUnits - ledger.remaining()
    quotaNote = () =>
      `${ledger.remaining().toLocaleString('en-US')} of ${args.dailyUnits.toLocaleString('en-US')} ` +
      `YouTube units left today after this run`
    spentNote = () =>
      `YouTube units spent today: ${spent()}. Pass --spent-today ${spent()} to another run today.`
  } else {
    console.log('MOCK: every source is a mock and nothing touches the network.')
  }

  const ctx: CliContext = {
    root,
    mock: !args.live,
    sources,
    git: gitAt(root),
    now,
    log: (line) => console.log(line),
    quotaNote: () => quotaNote(),
  }
  try {
    if (args.command === 'hitlist')
      return await runHitlist(ctx, { fetchText, loPuckiCsv: args.lopucki })
    if (args.command === 'subjects') return await runSubjects(ctx)
    return await runBacktest(ctx, baseline)
  } catch (error) {
    if (!(error instanceof QuotaExhaustedError)) throw error
    console.error(
      `${error.message}. Everything fetched so far is cached; rerun tomorrow to resume.`,
    )
    return 2
  } finally {
    const note = spentNote()
    if (note !== '') console.log(note)
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  },
)
