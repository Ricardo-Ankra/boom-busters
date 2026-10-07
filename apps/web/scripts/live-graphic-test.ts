#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  createDb,
  getSettings,
  listLogos,
  listShotSlots,
  llmCredentials,
  type ShotSlotWithChapter,
} from '@boom-busters/db'
import {
  anthropic,
  findModel,
  priceOf,
  resolveLlmModel,
  type KnownModel,
  type LLMTaskRequest,
} from '@boom-busters/providers'
import {
  canonicalModelId,
  GraphicBriefSchema,
  graphicIntentOf,
  resolveBrandKit,
  ValidationError,
} from '@boom-busters/schemas'
import type { BrandKitTokens, GraphicBrief, GraphicScene } from '@boom-busters/schemas'
import { designGraphicWith, loadGraphicContextFrom } from '@/lib/graphic-design-core'
import { BudgetExceeded, LiveBudget } from '@/lib/live-budget'
import { parseLiveGraphicArgs } from '@/lib/live-graphic-args'

/**
 * The live graphics harness (decision 289 follow-up): the real graphics
 * designer on real production graphic slots, so a prompt or vocabulary change
 * is judged on what the model actually draws for the producer's own films.
 *
 * Reads production and writes nothing to it: the session is read-only and is
 * checked before the first query; R2 is only signed for, never written; nothing
 * is recorded in the cost ledger. The one secret it touches is the stored
 * Anthropic key, decrypted in memory and handed to the adapter; it is never
 * printed, logged or written (a final scrub of run.json removes it even from
 * an error message that quoted it). Every paid call reserves its estimate first
 * under the owner's $1 cap.
 *
 * `run.json` in the output folder is the record; `pnpm render:graphics
 * <folder>` (packages/compositions) turns it into frames.
 */

/** The reserve's floor: a call never reserves less than this, whatever the estimate says. */
const MIN_CALL_RESERVE_USD = 0.02
const LOGO_URL_TTL_SEC = 60 * 60

interface SlotRecord {
  index: number
  slotId: string
  chapterTitle: string
  coversText: string
  intent: string
  /** The slot's own length on the film, which the frames are rendered to. */
  durationMs: number
  /** How long the design took on the wall clock. */
  designMs?: number
  /** The scene the slot stores today, if any. */
  before?: GraphicScene
  /** The scene the designer produced. */
  after?: GraphicScene
  /** Why there is no `after`. */
  issue?: string
  skipped?: boolean
  calls: number
  usd: number
  /** Logo element id to a presigned GET for `after`'s marks, valid one hour. */
  logos: Record<string, string>
  /** The same for `before`, where its marks differ from `after`'s. */
  beforeLogos: Record<string, string>
}

const sceneLogoIds = (scene: GraphicScene | undefined): [string, string][] =>
  (scene?.elements ?? []).flatMap((element) =>
    element.kind === 'logo' && element.assetId
      ? [[element.id, element.assetId] as [string, string]]
      : [],
  )

/** The decrypted key, in memory only; held here so nothing printed can carry it. */
let apiKey = ''

async function main(): Promise<void> {
  const args = parseLiveGraphicArgs(process.argv.slice(2))
  const url = process.env.DATABASE_URL_UNPOOLED
  const encryptionKey = process.env.SECRETS_ENCRYPTION_KEY
  if (!url) throw new Error('Set DATABASE_URL_UNPOOLED in .env.local. Nothing was spent.')
  if (!encryptionKey)
    throw new Error('Set SECRETS_ENCRYPTION_KEY in .env.local. Nothing was spent.')

  const { sql, db } = createDb(url, { max: 1, readOnly: true })
  const [guard] = await sql`show default_transaction_read_only`
  if (guard?.default_transaction_read_only !== 'on') {
    await sql.end()
    throw new Error('The database session is not read-only; refusing to go on. Nothing was spent.')
  }

  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = args.out ?? path.join(repoRoot, 'live-graphic-runs', `${stamp}-${args.label}`)
  const budget = new LiveBudget(args.cap)
  const slots: SlotRecord[] = []
  let model = args.model ?? ''
  let brand: BrandKitTokens | undefined
  /** Set only when the whole run failed outside a single slot's own handling. */
  let runError: string | undefined

  const writeRun = (): void => {
    const record = {
      label: args.label,
      project: args.project,
      model,
      createdAt: new Date().toISOString(),
      redesign: args.redesign,
      ...(args.steer ? { steer: args.steer } : {}),
      cap: args.cap,
      totalUsd: budget.spentUsd,
      budget: budget.entries,
      brand,
      slots,
      ...(runError ? { error: runError } : {}),
    }
    let text = JSON.stringify(record, null, 2)
    // Defence in depth: an error message that quoted the key must not carry it to disk.
    if (apiKey) text = text.split(apiKey).join('[redacted]')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(path.join(outDir, 'run.json'), text)
  }

  try {
    const settings = await getSettings(db)
    brand = resolveBrandKit(settings)

    // The model: production's graphics route, which must be Anthropic's, or an
    // Anthropic id given on the command line.
    const routing = settings.modelRouting.graphics
    if (!args.model && routing.provider !== 'anthropic') {
      throw new Error(
        `Graphics runs on ${routing.provider} in production; pass --model <an Anthropic id>. Nothing was spent.`,
      )
    }
    model = canonicalModelId('anthropic', args.model ?? routing.model)
    const priced: KnownModel | undefined =
      resolveLlmModel('anthropic', model, settings.modelPrices)?.model ??
      findModel(anthropic, model)
    if (!priced) {
      throw new Error(`"${model}" is not an Anthropic model this app can price. Nothing was spent.`)
    }

    const credentials = await llmCredentials(db, encryptionKey)
    const key = credentials.anthropic
    if (!key) throw new Error('No Anthropic key is stored in production. Nothing was spent.')
    apiKey = key

    // The graphic slots, in film order, whose briefs still parse.
    const graphics = (await listShotSlots(db, args.project))
      .filter((slot) => slot.type === 'graphic')
      .flatMap((slot: ShotSlotWithChapter) => {
        const parsed = GraphicBriefSchema.safeParse(slot.brief)
        return parsed.success ? [{ slot, brief: parsed.data }] : []
      })
    let chosen: { slot: ShotSlotWithChapter; brief: GraphicBrief }[]
    if (args.selection.kind === 'slots') {
      chosen = args.selection.ids.map((id) => {
        const found = graphics.find((entry) => entry.slot.id === id)
        if (!found) {
          throw new Error(
            `Slot ${id} is not a graphic of project ${args.project} with a readable brief. Nothing was spent.`,
          )
        }
        return found
      })
    } else {
      chosen = graphics.slice(0, args.selection.count)
    }
    if (chosen.length === 0) {
      throw new Error(`Project ${args.project} has no graphic slots to design. Nothing was spent.`)
    }

    // The marks' keys, so a logo element's asset id can be signed for the frames.
    const logoKeys = new Map((await listLogos(db)).map((row) => [row.id, row.r2Key]))
    const r2Ready = Boolean(
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
    )
    if (!r2Ready) console.warn('R2 is not configured here; the run will carry no logo URLs.')
    const r2 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      },
    })
    const signLogos = async (scene: GraphicScene | undefined): Promise<Record<string, string>> => {
      const urls: Record<string, string> = {}
      if (!r2Ready) return urls
      for (const [elementId, assetId] of sceneLogoIds(scene)) {
        const key = logoKeys.get(assetId)
        if (!key) continue
        urls[elementId] = await getSignedUrl(
          r2,
          new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
          { expiresIn: LOGO_URL_TTL_SEC },
        )
      }
      return urls
    }

    // Every chosen slot is on the record from the start, so a stop leaves the rest marked.
    for (const [index, { slot, brief }] of chosen.entries()) {
      slots.push({
        index,
        slotId: slot.id,
        chapterTitle: slot.chapterTitle,
        coversText: brief.coversText,
        intent: graphicIntentOf(brief).intent,
        durationMs: slot.durationMs,
        ...(brief.scene ? { before: brief.scene } : {}),
        calls: 0,
        usd: 0,
        logos: {},
        beforeLogos: {},
      })
    }
    writeRun()

    let stopped = false
    for (const [index, { slot, brief }] of chosen.entries()) {
      const record = slots[index]!
      if (stopped) {
        record.skipped = true
        record.issue = 'skipped: an earlier call took the run to its cap'
        continue
      }
      const labelPattern = new RegExp(`^slot-${index}-call-\\d+$`)
      let call = 0
      const complete = async (request: LLMTaskRequest, options: { signal?: AbortSignal }) => {
        const label = `slot-${index}-call-${(call += 1)}`
        const chars =
          request.system.length + request.messages.reduce((sum, m) => sum + m.content.length, 0)
        const estimate = Math.max(
          MIN_CALL_RESERVE_USD,
          priceOf(priced, { inputTokens: Math.ceil(chars / 4), outputTokens: request.maxTokens }),
        )
        budget.reserve(label, estimate)
        record.calls += 1
        try {
          const result = await anthropic.complete(request, {
            apiKey,
            model,
            ...(options.signal ? { signal: options.signal } : {}),
          })
          budget.record(label, priceOf(priced, result.usage))
          return { text: result.text }
        } catch (error) {
          // An answer cut off at its limit was produced and billed in full,
          // though the adapter throws before it reports usage: keep the
          // reservation (what a full answer costs) rather than understate the
          // spend. Any other failure (network, rejected key, rate limit)
          // bought nothing and settles at 0.
          const billed = error instanceof ValidationError && error.field === 'maxTokens'
          budget.record(label, billed ? estimate : 0)
          throw error
        }
      }

      const started = Date.now()
      try {
        const context = await loadGraphicContextFrom(db, args.project, slot.chapterId)
        const result = await designGraphicWith(
          complete,
          context,
          { chapterId: slot.chapterId, startMs: slot.startMs, durationMs: slot.durationMs, brief },
          {
            redesign: args.redesign,
            ...(args.steer ? { guidance: args.steer } : {}),
          },
        )
        if (result.ok) {
          record.after = result.scene
        } else {
          record.issue = result.issue
        }
      } catch (error) {
        if (error instanceof BudgetExceeded) {
          stopped = true
          record.issue = `stopped: ${error.message}`
        } else {
          record.issue = `error: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      record.designMs = Date.now() - started
      record.usd = budget.entries
        .filter((entry) => labelPattern.test(entry.label))
        .reduce((sum, entry) => sum + entry.usd, 0)
      record.logos = await signLogos(record.after)
      record.beforeLogos = await signLogos(record.before)
      writeRun()
    }

    writeRun()
    console.log(outDir)
    console.log(`Total spent: $${budget.spentUsd.toFixed(4)}`)
  } catch (error) {
    // Anything that escapes the per-slot handling (the settings or slot load,
    // a missing key) must still leave a readable run.json behind.
    runError = error instanceof Error ? error.message : String(error)
    writeRun()
    throw error
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(apiKey ? message.split(apiKey).join('[redacted]') : message)
  process.exit(1)
})
