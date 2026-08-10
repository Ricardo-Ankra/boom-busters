import { listProjects } from '@boom-busters/db'
import type { ProjectSummary } from '@boom-busters/db'
import type { Route } from 'next'
import Link from 'next/link'
import { MiniPipelineRail } from '@/components/pipeline-rail'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Projects · Boom-Busters' }

/**
 * The Projects list (build spec section 11.3): one row per project with a mini
 * pipeline rail, the current stage with its age, and a primary button whose
 * label depends on state.
 *
 * The `New project` case picker arrives with the Case Library in M3. Until
 * then the seeded fixture project is the one you drive.
 */
export default async function ProjectsPage() {
  const projects = await listProjects(db)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold">Projects</h1>
      </header>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-[15px]">No projects yet.</p>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              Run <span className="font-mono">pnpm db:seed</span> for the fixture project, or add
              cases once the Case Library lands in M3.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[8px] border border-[var(--color-border)]">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectRow project={project} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  const action = primaryAction(project)

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{project.title}</p>
        <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
          <span className="rounded-[4px] border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[11px]">
            {project.caseCategory}
          </span>{' '}
          <span className="capitalize">{project.stage}</span> · {statusLabel(project.stageStatus)} ·
          waiting {relativeAge(project.updatedAt)}
        </p>
      </div>

      <MiniPipelineRail stage={project.stage} stageStatus={project.stageStatus} />

      <span className="font-mono text-[13px] text-[var(--color-text-muted)] tabular-nums">
        {project.targetRuntimeMin} min
      </span>

      <Button asChild variant={action.primary ? 'primary' : 'outline'}>
        <Link href={`/projects/${project.id}` as Route}>{action.label}</Link>
      </Button>
    </div>
  )
}

function primaryAction(project: ProjectSummary): { label: string; primary: boolean } {
  switch (project.stageStatus) {
    case 'awaiting_review':
      return { label: 'Review', primary: true }
    case 'failed':
    case 'cancelled':
      return { label: 'Resume', primary: true }
    default:
      return { label: 'View', primary: false }
  }
}

function statusLabel(status: ProjectSummary['stageStatus']): string {
  return status === 'awaiting_review' ? 'awaiting review' : status
}

/** Coarse on purpose: "waiting 2 d" is the fact, not the exact minute. */
function relativeAge(since: Date): string {
  const ms = Date.now() - since.getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'moments'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}
