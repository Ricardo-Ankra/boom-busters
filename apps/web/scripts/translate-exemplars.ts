#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  anthropic,
  buildGraphicRequest,
  findModel,
  MANIFEST,
  mockProvidersEnabled,
  parseGraphicCode,
  priceOf,
  vendoredPath,
} from '@boom-busters/providers'
import type { ExemplarEntry, LLMTaskRequest } from '@boom-busters/providers'
import { FIRST_CHANNEL_IN_USE, ValidationError } from '@boom-busters/schemas'
import { callForAnswer } from '@/lib/answer'
import {
  exemplarBrief,
  exemplarContext,
  exemplarInput,
  parseExemplarArgs,
  renderDesignFile,
  renderRegistry,
  staleDesign,
  vendoredHash,
} from '@/lib/exemplar-translate'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import { BudgetExceeded, LiveBudget } from '@/lib/live-budget'

/**
 * The exemplar translation job (decision 305): for each manifest entry with
 * no stored design, or whose vendored template changed, ask the graphics
 * model to translate the template into a sandbox design through the
 * designer's own prompt and ladder, check the answer with the real
 * `graphicCodeIssue`, and write a passing design to `designs/<id>.ts`.
 *
 * Never part of `pnpm test`: it needs a real Anthropic key and spends
 * money, under a `LiveBudget` cap (default $1, at most $5). It writes
 * nothing to any database and does not record to the app's cost ledger;
 * the console is the record. It never edits the manifest and never writes
 * a design the checks refused.
 */

/** A reserve never drops below this: a translation reads a long template and writes a long design. */
const MIN_RESERVE_USD = 0.05

const EXEMPLARS_DIR = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'providers',
  'src',
  'exemplars',
)
const DESIGNS_DIR = path.join(EXEMPLARS_DIR, 'designs')

function designFileOf(entry: ExemplarEntry): string | undefined {
  const file = path.join(DESIGNS_DIR, `${entry.id}.ts`)
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined
}

function storedIds(): string[] {
  return readdirSync(DESIGNS_DIR)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .map((name) => name.slice(0, -3))
}

/**
 * Three characters a token, over the system prompt and every message: a
 * margin over the usual four, so the last call cannot pass the cap by a cent.
 */
function promptTokens(request: LLMTaskRequest): number {
  const chars = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0)
  return Math.ceil(chars / 3)
}

async function main(): Promise<void> {
  const args = parseExemplarArgs(process.argv.slice(2))
  if (mockProvidersEnabled())
    throw new Error(
      'MOCK_PROVIDERS is set; the translation needs the real model. Nothing was spent.',
    )
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY in .env.local. Nothing was spent.')
  const model = findModel(anthropic, args.model)
  if (!model)
    throw new Error(`${args.model} is not an Anthropic model this build knows. Nothing was spent.`)
  const budget = new LiveBudget(args.cap)

  const entries = MANIFEST.filter((entry) => args.only === undefined || entry.id === args.only)
  const failed: string[] = []
  // The summary prints however the run ends: the console is the only record of the spend.
  try {
    for (const entry of entries) {
      const vendoredText = readFileSync(path.join(EXEMPLARS_DIR, vendoredPath(entry)), 'utf8')
      const existing = designFileOf(entry)
      const stale = staleDesign(entry, vendoredText, existing)
      if (existing !== undefined && stale === null && args.only === undefined) {
        console.log(`${entry.id}: stored and current, skipped`)
        continue
      }
      if (stale !== null) console.log(stale)
      const context = exemplarContext(entry)
      const brief = exemplarBrief(entry, context)
      const words = entry.slot.words.map((word) => ({ text: word.text, atMs: word.atMs }))
      const input = exemplarInput(entry, vendoredText, FIRST_CHANNEL_IN_USE)
      let calls = 0
      try {
        const answer = await callForAnswer({
          request: buildGraphicRequest(input),
          parse: (text, note) => {
            const checked = graphicCodeIssue(parseGraphicCode(text, note), context, {
              brief,
              durationMs: entry.slot.durationMs,
              words,
            })
            if ('issue' in checked)
              throw new ValidationError(checked.issue, { field: 'graphic code' })
            return checked.code
          },
          complete: async (request, call) => {
            calls += 1
            const label = `${entry.id} ${call}`
            const estimate = priceOf(model, {
              inputTokens: promptTokens(request),
              outputTokens: request.maxTokens,
            })
            const reserved = Math.max(MIN_RESERVE_USD, estimate)
            budget.reserve(label, reserved)
            try {
              const result = await anthropic.complete(request, { apiKey, model: model.id })
              budget.record(label, priceOf(model, result.usage))
              return { text: result.text, truncated: result.truncated }
            } catch (error) {
              // A reply that spent its whole output budget on reasoning and wrote
              // no text throws a maxTokens ValidationError, yet is billed in
              // full: it keeps its reservation, so the cap still counts it. Any
              // other failure (network, a rejected key) cost nothing.
              const billed = error instanceof ValidationError && error.field === 'maxTokens'
              budget.record(label, billed ? reserved : 0)
              throw error
            }
          },
          retryWithReason: (reason) => buildGraphicRequest({ ...input, rejection: reason }),
        })
        if (!answer.ok) {
          failed.push(entry.id)
          console.log(`${entry.id}: refused after ${answer.calls} call(s): ${answer.issue}`)
          continue
        }
        // The stored design keeps its facts as claim numbers against the derived
        // claims, which are deterministic per entry, so the corpus gate can
        // re-run the facts check without the model.
        const file = renderDesignFile(entry, vendoredHash(vendoredText), {
          title: answer.value.title,
          source: answer.value.source,
          facts: answer.value.facts.map((fact) => ({
            text: fact.text,
            claim: context.claims.findIndex((claim) => claim.id === fact.claimId) + 1,
          })),
        })
        writeFileSync(path.join(DESIGNS_DIR, `${entry.id}.ts`), file)
        writeFileSync(path.join(DESIGNS_DIR, 'index.ts'), renderRegistry(storedIds()))
        console.log(
          `${entry.id}: stored "${answer.value.title}" after ${calls} call(s); spent so far $${budget.spentUsd.toFixed(2)}`,
        )
      } catch (error) {
        if (error instanceof BudgetExceeded) {
          console.log(`${entry.id}: ${error.message}`)
          failed.push(entry.id)
          break
        }
        throw error
      }
    }
  } finally {
    console.log(`Done. Spent $${budget.spentUsd.toFixed(2)} of $${args.cap.toFixed(2)}.`)
    for (const item of budget.entries)
      console.log(`  ${item.label}: $${item.usd.toFixed(4)}${item.settled ? '' : ' (reserved)'}`)
    if (failed.length > 0) {
      console.log(`Not stored: ${failed.join(', ')}`)
      process.exitCode = 1
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
