import {
  getProject,
  getSettings,
  latestScriptParagraphSources,
  listProjectSets,
  listShotSlots,
  listVoiceTakes,
  replaceShotList,
  scriptableClaims,
  setSlotRetype,
  listCastMembers,
  listLogos,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import { stillStyleAnchors } from '@boom-busters/providers'
import type { ScriptClaim } from '@boom-busters/providers'
import {
  BudgetExceededError,
  DirectorsBookSchema,
  mayBecomeStill,
  parseEventData,
  repairTargets,
  serialiseError,
  SlotDraftStateSchema,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { inngest } from '../client'
import { events } from '../events'
import {
  chapterShotListRequest,
  draftDirectorsBook,
  planChapterSlots,
  planFindings,
  rewriteStoredBriefs,
} from '../lib/direction'
import { budgetGateData, markSideJobFailed, type GateContext } from '../lib/gates'
import { timedParagraphs } from '../lib/shot-list'

/**
 * visuals-replanner (decision 252). The plan screen's two model-backed
 * buttons: Redraft direction (replaces the book; the owner's edits go) and
 * Re-plan shot list (replaces every slot from the stored book; anything
 * pre-fetched during plan review is discarded). Both run only while the
 * project sits at the plan checkpoint, and the parked visuals-runner is
 * untouched: it re-reads the slots when the plan is approved, exactly as the
 * staged-visuals design already requires.
 *
 * A separate function rather than a wait in the runner, for the reason the
 * slot-retyper is: the main run stays parked throughout.
 */

const FUNCTION_ID = 'visuals-replanner'

export const visualsReplanner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Visual re-plan',
    retries: 2,
    // One re-plan per project at a time; a double click cancels the re-plan
    // it duplicates, so it is never paid for twice (decision 233, amended).
    singleton: { key: 'event.data.projectId', mode: 'cancel' },
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      // Words, not a stage failure: the plan park stays open (decision 234).
      // The Fix button's job names itself, so a failed fix does not read as a
      // failed re-plan.
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        event.data.event.data['op'] === 'repair' ? 'The fix failed' : 'The re-plan failed',
        serialiseError(event.data.error),
      )
    },
    triggers: [events.visualsReplanRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, op } = parseEventData('visuals/replan.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const inPlan = await step.run('check-phase', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
      return project.visualsPhase === 'plan'
    })
    if (!inPlan) return { projectId, op, outcome: 'not-in-plan' as const }

    // -----------------------------------------------------------------------
    // Redraft the book, and nothing else
    // -----------------------------------------------------------------------

    if (op === 'direction') {
      const drafted = await step.run('redraft-book', async () => {
        try {
          await draftDirectorsBook(projectId)
          return { ok: true as const }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          throw error
        }
      })
      if (!drafted.ok) {
        await step.run('redraft-over-budget', () =>
          markSideJobFailed(ctx, 'The redraft stopped', drafted.gate),
        )
        return { projectId, op, outcome: 'over-budget' as const }
      }
      return { projectId, op, outcome: 'redrafted' as const }
    }

    // -----------------------------------------------------------------------
    // Re-plan every chapter from the stored book
    // -----------------------------------------------------------------------

    const setup = await step.run('load-plan-inputs', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
      const book = DirectorsBookSchema.safeParse(project.direction)
      const sources = await latestScriptParagraphSources(db, projectId)
      const takes = await listVoiceTakes(db, projectId)
      const claims = await scriptableClaims(db, projectId)
      const settings = await getSettings(db)
      const cast = await listCastMembers(db, projectId)
      // Loaded once for the whole re-plan: the shot-list prompt lists the
      // film's rooms, and the craft notes count how often each is used.
      const sets = await listProjectSets(db, projectId)
      // The logo library (decision 268, Plan B), threaded exactly like `sets`.
      const logos = await listLogos(db)
      return {
        caseTitle: project.title,
        direction: book.success ? book.data : null,
        chapters: sources.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
        paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
        claims: claims.map((claim) => ({
          id: claim.id,
          text: claim.text,
          sourceUrl: claim.sourceUrl,
          confidence: claim.confidence,
          // Which claims a headline card may cite (decision 257).
          sourceType: claim.sourceType,
        })) satisfies ScriptClaim[],
        styleAnchors: stillStyleAnchors(settings.brandKit),
        // Who the producer has photographed (decision 253, amended). Their
        // prompts name them and carry no physical description, because the
        // photograph is the likeness.
        photographed: cast
          .filter((member) => member.photos.length > 0)
          .map((member) => member.name),
        // Every member, photographed or not (decision 271): the Fix button
        // weighs an unphotographed person as a manual finding.
        cast: cast.map((member) => ({ name: member.name, photographed: member.photos.length > 0 })),
        // The film's rooms: named, described and inventoried for the
        // shot-list prompt (decision 275), and counted by the craft notes
        // below (decision 264).
        sets: sets.map(({ name, look, layout }) => ({ name, look, layout })),
        logos: logos.map((row) => ({ id: row.id, title: row.title ?? '' })),
      }
    })

    // -----------------------------------------------------------------------
    // Fix the flagged slots, and nothing else (decision 271)
    // -----------------------------------------------------------------------

    if (op === 'repair') {
      const loadSlots = async () =>
        (await listShotSlots(db, projectId)).map((row) => ({
          id: row.id,
          chapterId: row.chapterId,
          brief: row.brief,
          reuseOfSlotId: row.reuseOfSlotId,
          retype: row.retype,
        }))
      const stored = await step.run('load-slots', loadSlots)

      // Findings over the whole film, exactly as the board computes them, so
      // the button fixes the slots the screen counted.
      const context = {
        chapters: setup.chapters,
        direction: setup.direction,
        cast: setup.cast,
        sets: setup.sets,
      }
      const { findings, slots: briefs } = planFindings({ rows: stored, ...context })
      const targets = repairTargets(findings, ['auto', 'manual'])

      const rewrittenIds: string[] = []
      const kept: { id: string; reason: string }[] = []
      for (const [index, chapter] of setup.chapters.entries()) {
        const mine = targets.filter((target) => briefs[target.slotIndex]!.chapterId === chapter.id)
        if (mine.length === 0) continue
        const fixed = await step.run(`repair-${index}`, async () => {
          const request = chapterShotListRequest({
            caseTitle: setup.caseTitle,
            chapter: { id: chapter.id, title: chapter.title, number: index + 1 },
            paragraphs: setup.paragraphs,
            claims: setup.claims,
            styleAnchors: setup.styleAnchors,
            direction: setup.direction,
            photographed: setup.photographed,
            sets: setup.sets,
            logos: setup.logos,
          })
          if (!request) return { ok: true as const, rewritten: [], kept: [] }
          try {
            const outcome = await rewriteStoredBriefs({
              projectId,
              request,
              targets: mine.map((target) => ({
                id: stored[briefs[target.slotIndex]!.row]!.id,
                brief: briefs[target.slotIndex]!.brief,
                problems: target.findings.map((finding) => finding.message),
                mayBecomeStill: mayBecomeStill(briefs[target.slotIndex]!.brief, target.findings),
              })),
              claims: setup.claims,
              logos: setup.logos,
            })
            return { ok: true as const, ...outcome }
          } catch (error) {
            if (error instanceof BudgetExceededError) {
              return { ok: false as const, gate: budgetGateData(error) }
            }
            throw error
          }
        })
        if (!fixed.ok) {
          await step.run(`repair-${index}-over-budget`, () =>
            markSideJobFailed(ctx, 'The fix stopped', fixed.gate),
          )
          return { projectId, op, outcome: 'over-budget' as const }
        }
        rewrittenIds.push(...fixed.rewritten)
        kept.push(...fixed.kept)
      }
      const rewritten = rewrittenIds.length

      // Per slot, what the Fix did (decision 277): a slot it cleared carries
      // no note; one it kept says why; one it rewrote that is still flagged
      // says what is left. The same findings as the board, re-read after the
      // rewrite, so the card and the notes agree.
      const report = await step.run('repair-report', async () => {
        const after = await loadSlots()
        const now = planFindings({ rows: after, ...context })
        const left = new Map<string, string[]>()
        for (const finding of now.findings) {
          const id = after[now.slots[finding.slotIndex]!.row]!.id
          left.set(id, [...(left.get(id) ?? []), finding.message])
        }
        const reasons = new Map(kept.map((entry) => [entry.id, entry.reason]))
        let cleared = 0
        let flagged = 0
        for (const row of after) {
          const reason = reasons.get(row.id)
          if (reason === undefined && !rewrittenIds.includes(row.id)) continue
          // A model already rewriting this brief owns the card's state.
          const current = SlotDraftStateSchema.safeParse(row.retype)
          if (current.success && ['drafting', 'rebriefing'].includes(current.data.state)) continue
          const remaining = left.get(row.id) ?? []
          const note =
            reason !== undefined
              ? `Fix kept this brief: ${reason}.`
              : remaining.length > 0
                ? `Fix rewrote this brief, but it is still flagged: ${remaining.join('; ')}.`
                : null
          if (note === null) cleared += 1
          else if (reason === undefined) flagged += 1
          if (note !== null) await setSlotRetype(db, row.id, { state: 'fix-note', note })
          else if (current.success && current.data.state === 'fix-note') {
            await setSlotRetype(db, row.id, null)
          }
        }
        return { cleared, flagged, kept: kept.length }
      })

      await step.run('repair-notify', () =>
        notify({
          kind: 'heads-up',
          title: 'Flagged slots fixed',
          body:
            rewritten + report.kept === 0
              ? 'No flagged brief was rewritten: nothing the check flagged could be repaired.'
              : [
                  `${report.cleared} fixed`,
                  report.flagged > 0 ? `${report.flagged} rewritten but still flagged` : null,
                  report.kept > 0 ? `${report.kept} kept` : null,
                ]
                  .filter((part): part is string => part !== null)
                  .join(', ') + (report.flagged + report.kept > 0 ? '. Each card says why.' : '.'),
          href: `/projects/${projectId}`,
        }),
      )
      return { projectId, op, outcome: 'repaired' as const, rewritten }
    }

    const rows: NewShotSlot[] = []
    let rejected = 0
    for (const [index, chapter] of setup.chapters.entries()) {
      const planned = await step.run(`replan-${index}`, async () => {
        try {
          const result = await planChapterSlots({
            projectId,
            caseTitle: setup.caseTitle,
            chapter: { id: chapter.id, title: chapter.title, number: index + 1 },
            paragraphs: setup.paragraphs,
            claims: setup.claims,
            styleAnchors: setup.styleAnchors,
            direction: setup.direction,
            photographed: setup.photographed,
            sets: setup.sets,
            logos: setup.logos,
          })
          return { ok: true as const, ...result }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          throw error
        }
      })
      if (!planned.ok) {
        await step.run(`replan-${index}-over-budget`, () =>
          markSideJobFailed(ctx, 'The re-plan stopped', planned.gate),
        )
        return { projectId, op, outcome: 'over-budget' as const }
      }
      rows.push(...planned.rows)
      rejected += planned.rejected
    }

    if (rows.length === 0) {
      await step.run('replan-empty', () =>
        markSideJobFailed(ctx, 'The re-plan produced no slots', {
          message: 'The shot-list model produced no usable slots; the old plan was kept.',
        }),
      )
      return { projectId, op, outcome: 'empty' as const }
    }

    await step.run('replace-plan', async () => {
      // No route is stored (decision 264): a re-plan replaces the slot rows
      // and with them every override, and the derived route is re-computed
      // wherever it is needed rather than frozen onto a row here.
      await replaceShotList(db, projectId, rows)

      // The same findings the plan screen lists (decision 277).
      const warnings = planFindings({
        rows,
        chapters: setup.chapters,
        direction: setup.direction,
        cast: setup.cast,
        sets: setup.sets,
      }).findings
      await notify({
        kind: 'heads-up',
        title: 'Shot plan re-planned',
        body:
          `${rows.length} slots planned from the saved direction` +
          (rejected > 0 ? `, ${rejected} dropped as malformed` : '') +
          (warnings.length > 0 ? `, ${warnings.length} craft notes` : '') +
          '.',
        href: `/projects/${projectId}`,
      })
    })

    return { projectId, op, outcome: 'replanned' as const, slots: rows.length }
  },
)
