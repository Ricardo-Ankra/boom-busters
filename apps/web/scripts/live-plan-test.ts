#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import {
  createDb,
  getProject,
  getSettings,
  latestScriptParagraphSources,
  listCastMembers,
  listProjectSets,
  listVoiceTakes,
  scriptableClaims,
} from '@boom-busters/db'
import {
  findModel,
  geminiImageGen,
  google,
  imageGenPrice,
  priceOf,
  stillStyleAnchors,
} from '@boom-busters/providers'
import type { ImageReference, LLMTaskRequest, ScriptClaim } from '@boom-busters/providers'
import { DirectorsBookSchema, setForBrief, StillBriefSchema } from '@boom-busters/schemas'
import type { StillBrief } from '@boom-busters/schemas'
import { timedParagraphs } from '@/inngest/lib/shot-list'
import { BudgetExceeded, LiveBudget } from '@/lib/live-budget'
import type { PlanRunRecord, PlanRunStill } from '@/lib/live-compare'
import { parseLivePlanArgs } from '@/lib/live-plan-args'
import { planChapterWith } from '@/lib/plan-chapter'
import {
  assembleStillPrompt,
  depictedFrom,
  planStillReferences,
  referenceBudgets,
  routeForBrief,
  setFrom,
} from '@/lib/still-prompt'

/**
 * The live plan harness (decision 285, spec 10.1): the real planner on one
 * production chapter, then one image per still through the app's own prompt
 * assembly, so a prompt change is measured on what the app actually writes.
 *
 * Reads production and writes nothing to it: the session is read-only and is
 * checked before the first query; R2 is only read; nothing is recorded in the
 * cost ledger. `run.json` in the output folder is the record. Every paid call
 * reserves its estimate first under the owner's $1 cap.
 */

const FALLBACK_STILL_MODEL = 'gemini-3.1-flash-image'
const PLANNER_RESERVE_USD = 0.12

async function main(): Promise<void> {
  const args = parseLivePlanArgs(process.argv.slice(2))
  const apiKey = process.env.GEMINI_API_KEY
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!apiKey) throw new Error('Set GEMINI_API_KEY in .env.local. Nothing was spent.')
  if (!url) throw new Error('Set DATABASE_URL_UNPOOLED in .env.local. Nothing was spent.')

  const { sql, db } = createDb(url, { max: 1, readOnly: true })
  const [guard] = await sql`show default_transaction_read_only`
  if (guard?.default_transaction_read_only !== 'on') {
    await sql.end()
    throw new Error('The database session is not read-only; refusing to go on. Nothing was spent.')
  }

  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  })
  const bytesOf = async (key: string): Promise<string> => {
    const object = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
    const bytes = await object.Body?.transformToByteArray()
    if (!bytes) throw new Error(`R2 object ${key} has no body.`)
    return Buffer.from(bytes).toString('base64')
  }

  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = args.out ?? path.join(repoRoot, 'live-plan-runs', `${stamp}-${args.label}`)
  mkdirSync(outDir, { recursive: true })
  const budget = new LiveBudget(args.cap)
  const stills: PlanRunStill[] = []
  let briefs: StillBrief[] = []
  let plannerModel = args.plannerModel ?? ''
  let skipped = 0

  const writeRun = (): void => {
    const record: PlanRunRecord & { briefs: StillBrief[]; entries: unknown } = {
      label: args.label,
      project: args.project,
      chapter: args.chapter,
      createdAt: new Date().toISOString(),
      plannerModel,
      stills,
      skipped,
      budget: { capUsd: args.cap, totalUsd: budget.spentUsd },
      briefs,
      entries: budget.entries,
    }
    writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(record, null, 2))
  }

  try {
    const project = await getProject(db, args.project)
    if (!project) throw new Error(`No project ${args.project}.`)
    const settings = await getSettings(db)
    const cast = await listCastMembers(db, args.project)
    const sets = await listProjectSets(db, args.project)
    const book = DirectorsBookSchema.safeParse(project.direction)

    if (args.briefsFrom) {
      const previous = JSON.parse(readFileSync(path.join(args.briefsFrom, 'run.json'), 'utf8')) as {
        briefs: unknown[]
        plannerModel: string
      }
      briefs = previous.briefs.map((brief) => StillBriefSchema.parse(brief))
      plannerModel = `reused from ${args.briefsFrom} (${previous.plannerModel})`
    } else {
      const routing = settings.modelRouting.shotlist
      plannerModel = args.plannerModel ?? (routing.provider === 'google' ? routing.model : '')
      if (!plannerModel) {
        throw new Error(
          `The shot list runs on ${routing.provider} in production; pass --planner-model <a Google id>. Nothing was spent.`,
        )
      }
      const model = findModel(google, plannerModel)
      if (!model)
        throw new Error(`--planner-model "${plannerModel}" is not a Google model this app knows.`)

      const sources = await latestScriptParagraphSources(db, args.project)
      const chapter = sources.chapters[args.chapter]
      if (!chapter) throw new Error(`The script has no chapter at index ${args.chapter}.`)
      const takes = await listVoiceTakes(db, args.project)
      const claims = (await scriptableClaims(db, args.project)).map((claim) => ({
        id: claim.id,
        text: claim.text,
        sourceUrl: claim.sourceUrl,
        confidence: claim.confidence,
        sourceType: claim.sourceType,
      })) satisfies ScriptClaim[]

      let call = 0
      const planned = await planChapterWith(
        async (request: LLMTaskRequest, purpose) => {
          const label = `planner-${purpose}-${(call += 1)}`
          budget.reserve(label, PLANNER_RESERVE_USD)
          const result = await google.complete(request, { apiKey, model: plannerModel })
          budget.record(label, priceOf(model, result.usage))
          return { text: result.text }
        },
        {
          caseTitle: project.title,
          chapter: { id: chapter.id, title: chapter.title, number: args.chapter + 1 },
          paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
          claims,
          styleAnchors: stillStyleAnchors(settings.brandKit),
          direction: book.success ? book.data : null,
          photographed: cast.filter((m) => m.photos.length > 0).map((m) => m.name),
          sets: sets.map(({ name, look, layout }) => ({ name, look, layout })),
        },
      )
      briefs = (planned?.slots ?? [])
        .map((slot) => slot.brief)
        .filter((brief): brief is StillBrief => brief.type === 'still')
    }
    writeRun()

    for (const [index, brief] of briefs.entries()) {
      const members = depictedFrom(brief, cast)
      const set = setFrom(brief, sets)
      const route = routeForBrief(brief, cast, sets, settings.modelRouting)
      const imageModel = route.provider === 'google' ? route.model : FALLBACK_STILL_MODEL
      const plan = planStillReferences(
        members,
        set,
        referenceBudgets(geminiImageGen.referenceLimits(imageModel)),
        brief.camera?.facing,
      )
      const prompt = assembleStillPrompt({
        scene: brief.prompt,
        ...(brief.shotSize ? { shotSize: brief.shotSize } : {}),
        ...(brief.camera ? { camera: brief.camera } : {}),
        layout: setForBrief(brief.set, sets)?.layout ?? '',
        people: plan.people,
        set: plan.setName === null ? null : { name: plan.setName, plates: plan.plates.length },
      })
      const entry: PlanRunStill = {
        index,
        coversText: brief.coversText,
        prompt,
        ...(brief.set ? { set: brief.set } : {}),
        ...(brief.shotSize ? { shotSize: brief.shotSize } : {}),
      }
      stills.push(entry)
      try {
        budget.reserve(`still-${index}`, imageGenPrice(geminiImageGen, 1, imageModel, '1K'))
      } catch (error) {
        if (!(error instanceof BudgetExceeded)) throw error
        entry.error = 'skipped: the next image would pass the cap'
        skipped = briefs.length - index
        break
      }
      const references: ImageReference[] = []
      for (const { member, photo } of plan.photos) {
        references.push({
          name: member.name,
          kind: 'character',
          mimeType: photo.mimeType,
          data: await bytesOf(photo.r2Key),
        })
      }
      for (const plate of plan.plates) {
        references.push({
          name: plan.setName ?? '',
          kind: 'object',
          mimeType: plate.mimeType,
          data: await bytesOf(plate.r2Key),
          ...(plate.view === 'other' ? {} : { facing: plate.view }),
        })
      }
      try {
        const result = await geminiImageGen.generate(
          {
            prompt,
            ...(brief.negativePrompt ? { negativePrompt: brief.negativePrompt } : {}),
            count: 1,
            model: imageModel,
            size: '1K',
            ...(references.length > 0 ? { references } : {}),
          },
          { apiKey },
        )
        budget.record(`still-${index}`, result.estimatedCostUsd)
        const image = result.images[0]
        if (image) {
          entry.file = `still-${index}.png`
          writeFileSync(
            path.join(outDir, entry.file),
            Buffer.from(image.url.slice(image.url.indexOf(',') + 1), 'base64'),
          )
        } else {
          entry.error = 'Gemini returned no image'
        }
      } catch (error) {
        budget.record(`still-${index}`, 0)
        entry.error = error instanceof Error ? error.message : String(error)
      }
      writeRun()
    }
    writeRun()
    console.log(outDir)
    console.log(`Total spent: $${budget.spentUsd.toFixed(4)}`)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
