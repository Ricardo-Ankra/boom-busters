#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { graphicBrand } from '@boom-busters/compositions/graphic-code-pure'
import { resolveBrandKit, resolveMotionIdentity } from '@boom-busters/schemas'
import type { Settings } from '@boom-busters/schemas'
import { checkHandDesign, handEntry, parseHandFiles, type HandChecked } from '@/lib/exemplar-hand'
import { browserFrames } from '@/lib/graphic-code/frames'
import { readRawFlags } from '@/lib/live-set-args'

/**
 * A channel exemplar written by hand (decision 462). A design folder holds
 * `plan.json` (an ExemplarPlan), `design.jsx` (the source) and `meta.json`
 * (`{ "title": "...", "facts": [{ "text": "...", "claim": 1 }] }`).
 *
 *   check: every check a derived version passes, under the channel settings
 *   in --settings (a JSON file of the channel's settings), offline; the
 *   frames, the sheets and a report land in <dir>/out for review.
 *
 *     tsx --import ./scripts/stub-server-only.mjs scripts/hand-exemplar.ts check \
 *       --technique lower-third --dir <folder> --settings <settings.json>
 *
 *   upload: the same checks under the channel's live settings, then the
 *   version stored as a draft for the owner to approve on the Exemplars tab,
 *   its frames stored to R2 as the deriver stores them, at no cost.
 *
 *     tsx --import ./scripts/stub-server-only.mjs --env-file=<.env.local> \
 *       scripts/hand-exemplar.ts upload --channel boom-busters --technique lower-third --dir <folder>
 */

const ORIENTATIONS = ['landscape', 'portrait'] as const

function readDesign(dir: string) {
  const json = (name: string): unknown => JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
  const meta = json('meta.json') as { title: string; facts?: unknown }
  return parseHandFiles({
    plan: json('plan.json'),
    source: readFileSync(path.join(dir, 'design.jsx'), 'utf8'),
    title: meta.title,
    facts: meta.facts,
  })
}

async function check(technique: string, dir: string, settings: Settings) {
  const entry = handEntry(technique)
  const { plan, answer } = readDesign(dir)
  return {
    entry,
    plan,
    result: await checkHandDesign({
      entry,
      plan,
      answer,
      motion: resolveMotionIdentity(settings),
      brand: graphicBrand(resolveBrandKit(settings)),
      frames: browserFrames(),
    }),
  }
}

function writeOut(dir: string, checked: HandChecked): string {
  const out = path.join(dir, 'out')
  mkdirSync(out, { recursive: true })
  const jpeg = (name: string, base64: string) =>
    writeFileSync(path.join(out, name), Buffer.from(base64, 'base64'))
  for (const shot of checked.shots) jpeg(`${shot.orientation}-${shot.atMs}.jpg`, shot.jpeg)
  for (const orientation of ORIENTATIONS) {
    const board = checked.sheets.storyboard[orientation]
    if (board) jpeg(`sheet-storyboard-${orientation}.jpg`, board)
    const even = checked.sheets.even[orientation]
    if (even) jpeg(`sheet-even-${orientation}.jpg`, even)
  }
  writeFileSync(
    path.join(out, 'report.json'),
    JSON.stringify(
      {
        words: checked.words,
        shots: checked.shots.map((shot) => `${shot.orientation}-${shot.atMs}.jpg`),
        findings: checked.findings,
        metrics: checked.metrics,
      },
      null,
      2,
    ),
  )
  return out
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2)
  const raw = readRawFlags(rest)
  if (!raw.technique || !raw.dir) throw new Error('--technique and --dir are required')
  const dir = path.resolve(raw.dir)

  if (mode === 'check') {
    if (!raw.settings) throw new Error('--settings <channel settings JSON> is required')
    const settings = JSON.parse(readFileSync(raw.settings, 'utf8')) as Settings
    const { result } = await check(raw.technique, dir, settings)
    if ('issue' in result) {
      console.log(`REFUSED ${raw.technique}: ${result.issue}`)
      process.exitCode = 1
      return
    }
    console.log(`PASSED ${raw.technique}; frames in ${writeOut(dir, result)}`)
    return
  }

  if (mode === 'upload') {
    if (!raw.channel) throw new Error('--channel <slug> is required')
    // The app's database and storage, loaded only here: `check` runs without either.
    const { db } = await import('@/lib/db')
    const { getChannelBySlug, insertExemplarVersion, updateExemplarDraft } =
      await import('@boom-busters/db')
    const { loopChannel, photographVersion } = await import('@/inngest/lib/exemplar-loop')
    const channel = await getChannelBySlug(db, raw.channel)
    if (!channel) throw new Error(`no channel "${raw.channel}"`)
    const { entry, plan, result } = await check(raw.technique, dir, channel.settings)
    if ('issue' in result) {
      console.log(`REFUSED ${raw.technique}: ${result.issue}`)
      process.exitCode = 1
      return
    }
    // Everything that can refuse runs before the first write: the loop's channel read
    // requires a complete bible, as a derivation does.
    const loop = await loopChannel(channel.id)
    const row = await insertExemplarVersion(db, {
      channelId: channel.id,
      technique: raw.technique,
      plan,
      code: result.code,
    })
    console.log(`STORED ${raw.technique} v${row.version} (${row.id}) as a draft`)
    try {
      const photographed = await photographVersion({
        channel: loop,
        entry,
        plan,
        versionId: row.id,
        round: 1,
        code: result.code,
        frames: browserFrames(),
      })
      await updateExemplarDraft(db, row.id, {
        costUsd: 0,
        ...('none' in photographed
          ? {}
          : { frames: photographed.frames, metrics: photographed.metrics }),
      })
      console.log(
        'none' in photographed ? `no frames stored: ${photographed.none}` : 'frames stored',
      )
    } catch (error) {
      // The draft plays without frames, as one derived without storage does.
      console.error(
        `the draft is kept without frames: ${error instanceof Error ? error.message : String(error)}`,
      )
      process.exitCode = 1
    }
    process.exit(process.exitCode ?? 0)
  }

  throw new Error('the mode is check or upload')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exit(1)
})
