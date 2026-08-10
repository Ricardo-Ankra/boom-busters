import { getProject, hasLiveRun, listActivity, listOpenBudgetGates } from '@boom-busters/db'
import { notFound } from 'next/navigation'
import { ActivityList } from '@/components/activity-list'
import { BudgetGateCard } from '@/components/budget-gate-card'
import { LiveRefresh } from '@/components/live-refresh'
import { PipelineRail } from '@/components/pipeline-rail'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db'
import { isGateOpen, isMoving, isStranded } from '@/lib/run-state'
import { GateActionBar, StartRunButton, StopButton } from './project-controls'

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

  const [activity, budgetGates, liveRun] = await Promise.all([
    listActivity(db, { projectId: id, limit: 50 }),
    listOpenBudgetGates(db),
    hasLiveRun(db, id),
  ])
  const budgetGate = budgetGates.find((gate) => gate.projectId === id)

  // Whether a run exists is the run mirror's answer, not `stageStatus`'s. A
  // project can read `awaiting_review` with nothing waiting on it — the seeded
  // fixture does — and offering Approve there would send an event no run is
  // listening for, then claim the run had moved on.
  const atGate = isGateOpen(project, liveRun)
  const stranded = isStranded(project, liveRun)
  const moving = isMoving(project, liveRun)

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
          {liveRun ? (
            <StopButton projectId={project.id} />
          ) : (
            <StartRunButton projectId={project.id} />
          )}
        </div>
      </header>

      <PipelineRail stage={project.stage} stageStatus={project.stageStatus} />

      {budgetGate ? <BudgetGateCard gate={budgetGate} /> : null}

      <Card className={stranded ? 'border-[var(--color-warning)]' : undefined}>
        <CardHeader>
          <CardTitle className="capitalize">{project.stage}</CardTitle>
          <CardDescription>
            {stranded
              ? 'Marked awaiting review, but no run is waiting on it — nothing would receive an approval. Start a run.'
              : stageSummary(project.stageStatus, project.stage)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            The demo pipeline does no real work — it exists to prove that gates park, resume and
            cancel on the deployment the real runners will use. The dossier and script review
            screens arrive with their runners in M3.
          </p>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold">Activity</h2>
        <ActivityList entries={activity} emptyMessage="Nothing has happened on this project yet." />
      </section>

      {atGate && !budgetGate ? (
        <GateActionBar
          projectId={project.id}
          stage={project.stage}
          context={`${project.stage} gate · demo run · nothing was generated`}
        />
      ) : null}
    </div>
  )
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
      return 'This stage failed. Start a new run when the cause is fixed.'
    case 'cancelled':
      return 'Stopped. Start a new run when you are ready.'
    default:
      return ''
  }
}
