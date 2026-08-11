import {
  getDossier,
  getLatestScript,
  getProject,
  hasLiveRun,
  listActivity,
  listOpenBudgetGates,
} from '@boom-busters/db'
import { notFound } from 'next/navigation'
import { ActivityList } from '@/components/activity-list'
import { BudgetGateCard } from '@/components/budget-gate-card'
import { LiveRefresh } from '@/components/live-refresh'
import { PipelineRail } from '@/components/pipeline-rail'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db'
import { approvalBlockedReason, blockingCount } from '@/lib/claim-review'
import { isGateOpen, isMoving, projectControl } from '@/lib/run-state'
import { DossierReview } from './dossier-review'
import { ScriptStudio } from './script-studio'
import { GateActionBar, RestartRunButton, StopButton } from './project-controls'

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
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const project = await getProject(db, id)
  if (!project) notFound()

  const [activity, budgetGates, liveRun, dossier, script] = await Promise.all([
    listActivity(db, { projectId: id, limit: 50 }),
    listOpenBudgetGates(db),
    hasLiveRun(db, id),
    getDossier(db, id),
    getLatestScript(db, id),
  ])
  const budgetGate = budgetGates.find((gate) => gate.projectId === id)

  // Whether a run exists is the run mirror's answer, not `stageStatus`'s. A
  // project can read `awaiting_review` with nothing waiting on it — the seeded
  // fixture does — and offering Approve there would send an event no run is
  // listening for, then claim the run had moved on.
  const atGate = isGateOpen(project, liveRun)
  const moving = isMoving(project, liveRun)
  // One answer to "what does the header offer, and why", so the two can never
  // disagree — a button whose caption contradicts the card beside it is how a
  // no-op demo run came to look like the way to start a project.
  const control = projectControl(project, liveRun)

  // The dossier is shown whenever one exists, not only at its gate: after
  // approval it is the reference the script was written from, and the claims
  // it was built on are what a later dispute turns on.
  const showDossier = dossier !== undefined && project.stage === 'dossier'
  const showScript = script !== undefined && project.stage === 'script'

  // The badge in the Studio header. A downgrade is recorded on the run, so a
  // chapter written by the fallback model can be labelled as such rather than
  // passing as the model you configured.
  const usedFallbackModel = activity.some((entry) => entry.kind === 'model.fallback')
  const blockedReason = dossier ? approvalBlockedReason(dossier.claims) : undefined

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
          {control.kind === 'restart' ? (
            <RestartRunButton projectId={project.id} label={control.label} />
          ) : null}
        </div>
      </header>

      {/* Why there is no button, when there is no button. An empty header on a
          project that is plainly not finished reads as a broken screen. */}
      {control.kind !== 'stop' ? (
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

      <PipelineRail stage={project.stage} stageStatus={project.stageStatus} />

      {budgetGate ? <BudgetGateCard gate={budgetGate} /> : null}

      {showScript ? (
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
            <CardTitle className="capitalize">{project.stage}</CardTitle>
            {/* Deliberately not repeating `control.message`, which is already
                on screen above: the same sentence twice reads as two problems. */}
            <CardDescription>{stageSummary(project.stageStatus, project.stage)}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              {project.stage === 'dossier'
                ? 'No dossier has been researched yet.'
                : 'The review screen for this stage arrives with its runner.'}
            </p>
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold">Activity</h2>
        <ActivityList entries={activity} emptyMessage="Nothing has happened on this project yet." />
      </section>

      {atGate && !budgetGate ? (
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
              : gateContext(project.stage, dossier)
          }
          {...(project.stage === 'dossier' && blockedReason ? { blockedReason } : {})}
        />
      ) : null}
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
