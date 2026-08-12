import {
  getDossier,
  getLatestScript,
  getProject,
  hasLiveRun,
  listActivity,
  listOpenBudgetGates,
  projectDeletionSummary,
} from '@boom-busters/db'
import { voiceReviewModel } from '@/lib/voice-review'
import { notFound } from 'next/navigation'
import { ActivityList } from '@/components/activity-list'
import { BudgetGateCard } from '@/components/budget-gate-card'
import { LiveRefresh } from '@/components/live-refresh'
import { PipelineRail } from '@/components/pipeline-rail'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db'
import { approvalBlockedReason, blockingCount } from '@/lib/claim-review'
import { RESTARTABLE_STAGES, isGateOpen, isMoving, projectControl } from '@/lib/run-state'
import { downstreamOf, resolveViewedStage, stageViewsForProject } from '@/lib/stage-view'
import { DossierReview } from './dossier-review'
import { ScriptStudio } from './script-studio'
import { VoiceReview } from './voice-review'
import { StageBanner } from './stage-banner'
import {
  DeleteProjectButton,
  GateActionBar,
  RestartRunButton,
  StopButton,
} from './project-controls'

export const dynamic = 'force-dynamic'

/**
 * The project view (build spec section 11.3): the pipeline rail, the current
 * stage's screen, and a sticky gate action bar.
 *
 * In M2 the "current stage's screen" is a summary, because the demo pipeline
 * produces nothing to review. M3-M7 replace that middle section with the
 * dossier, Script Studio, voice review, visual board and preview screens; the
 * rail, gate bar and Stop control they hang from are what this milestone
 * proves.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ stage?: string }>
}) {
  const { id } = await params
  const { stage: requestedStage } = await searchParams

  const project = await getProject(db, id)
  if (!project) notFound()

  const [activity, budgetGates, liveRun, dossier, script, deletionSummary, voice] =
    await Promise.all([
      listActivity(db, { projectId: id, limit: 50 }),
      listOpenBudgetGates(db),
      hasLiveRun(db, id),
      getDossier(db, id),
      getLatestScript(db, id),
      projectDeletionSummary(db, id),
      voiceReviewModel(db, id),
    ])
  const budgetGate = budgetGates.find((gate) => gate.projectId === id)

  /**
   * Where the project is, and what you are looking at, are two different
   * things now.
   *
   * The rail is navigable (spec section 11.3), so a project on the script stage
   * can have its dossier on screen — which is the point: the research the
   * narration was written from, and the sources any later dispute turns on,
   * have to be reachable from the screen that needs them.
   */
  const views = stageViewsForProject(project, liveRun)
  const viewing = resolveViewedStage(requestedStage, views, project.stage)
  const viewingCurrent = viewing === project.stage
  const viewed = views.find((view) => view.stage === viewing)

  // Whether a run exists is the run mirror's answer, not `stageStatus`'s. A
  // project can read `awaiting_review` with nothing waiting on it — the seeded
  // fixture does — and offering Approve there would send an event no run is
  // listening for, then claim the run had moved on.
  const atGate = isGateOpen(project, liveRun)
  const moving = isMoving(project, liveRun)
  // One answer to "what does the header offer, and why", so the two can never
  // disagree — a button whose caption contradicts the card beside it is how a
  // no-op demo run came to look like the way to start a project.
  const control = projectControl(project, liveRun, {
    hasDossier: dossier !== undefined,
    hasScript: script !== undefined,
  })

  // Driven by the stage on screen rather than the stage the project is on, so
  // the dossier stays readable from anywhere. It is not only a gate screen:
  // after approval it is the reference the script was written from.
  const showDossier = dossier !== undefined && viewing === 'dossier'
  const showScript = script !== undefined && viewing === 'script'
  const showVoice = viewing === 'voice' && voice.expectedParagraphs > 0

  // The badge in the Studio header. A downgrade is recorded on the run, so a
  // chapter written by the fallback model can be labelled as such rather than
  // passing as the model you configured.
  const usedFallbackModel = activity.some((entry) => entry.kind === 'model.fallback')
  const blockedReason = dossier ? approvalBlockedReason(dossier.claims) : undefined

  /**
   * Re-running a stage you have navigated *back* to.
   *
   * Only for stages that are not the current one — for the current stage
   * `projectControl` already decides, and offering two restart buttons that
   * disagree about whether a re-run is possible would be worse than offering
   * none. A live run rules it out either way: two runs would race over the same
   * stage columns.
   */
  const canRerun =
    !viewingCurrent &&
    !liveRun &&
    RESTARTABLE_STAGES.includes(viewing) &&
    viewed?.availability !== 'upcoming' &&
    // The script is written from the dossier's claims; without one the run
    // would die on its first step.
    (viewing !== 'script' || dossier !== undefined) &&
    // And the narration is read from the script, for the same reason.
    (viewing !== 'voice' || script !== undefined)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold">{project.title}</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            <span className="font-mono">{project.caseCategory}</span> · {project.caseTitle} ·{' '}
            {project.targetRuntimeMin} min target
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LiveRefresh active={moving} />
          {control.kind === 'stop' ? <StopButton projectId={project.id} /> : null}
          {control.kind === 'restart' && viewingCurrent ? (
            <RestartRunButton
              projectId={project.id}
              stage={project.stage}
              label={control.label}
              downstream={downstreamOf(project.stage, views)}
            />
          ) : null}
        </div>
      </header>

      {/* Why there is no button, when there is no button. An empty header on a
          project that is plainly not finished reads as a broken screen. */}
      {control.kind !== 'stop' && viewingCurrent ? (
        <p
          className={
            control.kind === 'working'
              ? 'text-[13px] text-[var(--color-text-secondary)]'
              : 'text-[13px] text-[var(--color-warning)]'
          }
          role={control.kind === 'working' ? 'status' : undefined}
        >
          {control.message}
        </p>
      ) : null}

      {/* Directly under the header, beside where Stop and the re-run controls
          live — not stuck along the bottom edge. On the Script Studio the
          sticky version permanently covered the last lines of the chapter you
          were reading, on the one screen whose whole job is reading. */}
      {atGate && !budgetGate && viewingCurrent ? (
        <GateActionBar
          /* One bar per gate. The bar keeps a little state about the approval
             it just handed over, and without a key that state would follow the
             component from the dossier gate to the script gate. */
          key={project.stage}
          projectId={project.id}
          stage={project.stage}
          context={
            project.stage === 'script' && script
              ? `${script.chapters.length} chapters · ${script.chapters.reduce(
                  (total, chapter) => total + chapter.warnings.length,
                  0,
                )} self-check warnings. Approving sends this to the voice stage.`
              : project.stage === 'voice'
                ? `${voice.coverage.paragraphs} of ${voice.expectedParagraphs} paragraphs narrated · ` +
                  `${voice.coverage.flagged} flagged. Approving sends this to the visuals stage.`
                : gateContext(project.stage, dossier)
          }
          {...(project.stage === 'dossier' && blockedReason ? { blockedReason } : {})}
          {...(project.stage === 'voice' && voice.blockedReason
            ? { blockedReason: voice.blockedReason }
            : {})}
        />
      ) : null}

      <PipelineRail views={views} projectId={project.id} viewing={viewing} />

      <StageBanner
        projectId={project.id}
        projectStage={project.stage}
        viewed={viewed}
        viewingCurrent={viewingCurrent}
        canRerun={canRerun}
        downstream={downstreamOf(viewing, views)}
      />

      {budgetGate ? <BudgetGateCard gate={budgetGate} /> : null}

      {showVoice ? (
        <VoiceReview model={voice} />
      ) : showScript ? (
        <ScriptStudio
          projectId={project.id}
          chapters={script.chapters}
          targetRuntimeMin={project.targetRuntimeMin}
          scriptId={script.script.id}
          shorts={script.script.shortsCandidates}
          usedFallbackModel={usedFallbackModel}
        />
      ) : showDossier ? (
        <DossierReview
          projectId={project.id}
          contentMd={dossier.contentMd}
          claims={dossier.claims}
        />
      ) : (
        <Card className={control.kind === 'blocked' ? 'border-[var(--color-warning)]' : undefined}>
          <CardHeader>
            <CardTitle className="capitalize">{viewing}</CardTitle>
            {/* Deliberately not repeating `control.message`, which is already
                on screen above: the same sentence twice reads as two problems. */}
            <CardDescription>
              {viewingCurrent ? stageSummary(project.stageStatus, project.stage) : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              {viewing === 'dossier'
                ? 'No dossier has been researched yet.'
                : viewing === 'voice'
                  ? 'Nothing has been narrated yet. Narration is read from the approved script.'
                  : 'The review screen for this stage arrives with its runner.'}
            </p>
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold">Activity</h2>
        <ActivityList entries={activity} emptyMessage="Nothing has happened on this project yet." />
      </section>

      {/* Last on the page and a long way from Approve. A destructive control
          that sits near the one you press every day is a control you will
          eventually press by accident. */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--color-border)] p-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold">Delete this project</h2>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {liveRun
              ? 'Not while a run is in flight — stop it first.'
              : 'Removes the project and everything produced under it. The case is kept.'}
          </p>
        </div>
        {liveRun ? null : <DeleteProjectButton projectId={project.id} summary={deletionSummary} />}
      </section>
    </div>
  )
}

function gateContext(
  stage: string,
  dossier: { claims: { confidence: string; quarantined: boolean }[] } | undefined,
): string {
  if (stage === 'dossier' && dossier) {
    const blocking = blockingCount(dossier.claims)
    const quarantined = dossier.claims.filter((claim) => claim.quarantined).length
    return (
      `${dossier.claims.length} claims · ${blocking} unsourced · ${quarantined} quarantined. ` +
      'Approving sends this to the script runner.'
    )
  }
  return `${stage} gate`
}

function stageSummary(status: string, stage: string): string {
  switch (status) {
    case 'queued':
      return 'Queued — waiting for Inngest to pick the run up.'
    case 'running':
      return `Running the ${stage} stage.`
    case 'awaiting_review':
      return 'Waiting for you. Approve or request changes below.'
    case 'approved':
      return 'Approved. Nothing is running.'
    case 'failed':
      return 'This stage failed.'
    case 'cancelled':
      return 'Stopped.'
    default:
      return ''
  }
}
