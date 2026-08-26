import {
  getDossier,
  getLatestScript,
  getProject,
  getSettings,
  hasLiveRun,
  listActivity,
  listOpenBudgetGates,
  projectDeletionSummary,
  projectPulse,
} from '@boom-busters/db'
import type { ProjectStage } from '@boom-busters/db'
import { emptyVoiceModel, voiceReviewModel } from '@/lib/voice-review'
import { emptyVisualsModel, visualsReviewModel } from '@/lib/visuals-review'
import { emptyPreviewModel, previewModel } from '@/lib/preview-review'
import { emptyShortsModel, shortsModel } from '@/lib/shorts-review'
import { emptyPublishModel, publishModel } from '@/lib/publish-review'
import { materialiseForPreview } from '@/lib/materialise'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { presignGet, storageConfigured } from '@/lib/storage'
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
import { PreviewScreen } from './preview-screen'
import type { PreviewRenderProp } from './preview-screen'
import { PublishScreen } from './publish-screen'
import { ScriptStudio } from './script-studio'
import { ShortsScreen } from './shorts-screen'
import { VisualBoard } from './visual-board'
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

  const [project, liveRun] = await Promise.all([getProject(db, id), hasLiveRun(db, id)])
  if (!project) notFound()

  /**
   * Where the project is, and what you are looking at, are two different
   * things now.
   *
   * The rail is navigable (spec section 11.3), so a project on the script stage
   * can have its dossier on screen — which is the point: the research the
   * narration was written from, and the sources any later dispute turns on,
   * have to be reachable from the screen that needs them.
   *
   * Resolved BEFORE the review models are fetched, because it decides which
   * of them are fetched at all (decision 186): each stage's model loads only
   * when that stage is on screen, or is the project's own stage (the gate
   * action bar needs its context and blockers). Fetching all of them on
   * every render — the full dossier with claims, the script, the takes, the
   * board, the timeline JSON — multiplied every refresh by roughly four, on
   * a database whose data transfer is metered (decision 185).
   */
  const views = stageViewsForProject(project, liveRun)
  const viewing = resolveViewedStage(requestedStage, views, project.stage)
  const viewingCurrent = viewing === project.stage
  const viewed = views.find((view) => view.stage === viewing)
  const wants = (stage: ProjectStage): boolean => viewing === stage || project.stage === stage

  const [
    activity,
    budgetGates,
    dossier,
    script,
    deletionSummary,
    voice,
    visuals,
    settings,
    preview,
    shortCards,
    pulse,
    publish,
  ] = await Promise.all([
    listActivity(db, { projectId: id, limit: 50 }),
    listOpenBudgetGates(db),
    wants('dossier') ? getDossier(db, id) : Promise.resolve(undefined),
    wants('script') ? getLatestScript(db, id) : Promise.resolve(undefined),
    projectDeletionSummary(db, id),
    wants('voice') ? voiceReviewModel(db, id) : Promise.resolve(emptyVoiceModel()),
    wants('visuals')
      ? visualsReviewModel(db, id, { phase: project.visualsPhase })
      : Promise.resolve(emptyVisualsModel()),
    getSettings(db),
    // The preview model also loads while the project SITS at assembly but
    // another stage is on screen: the header's Stop needs to know whether a
    // master render is in flight, whatever you happen to be looking at.
    wants('assembly') ? previewModel(db, id) : Promise.resolve(emptyPreviewModel()),
    viewing === 'shorts' ? shortsModel(db, id) : Promise.resolve(emptyShortsModel()),
    projectPulse(db, id),
    viewing === 'publish'
      ? publishModel(db, id, {
          presign: storageConfigured() ? (key) => presignGet(key) : null,
        })
      : Promise.resolve(emptyPublishModel()),
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
  // Presence flags come from the summary row, not from whether the full
  // models were fetched — after decision 186 those load per-view, and "not
  // loaded" must never read as "does not exist".
  const control = projectControl(project, liveRun, {
    hasDossier: project.dossierVersion !== null,
    hasScript: project.hasScript,
  })

  // Driven by the stage on screen rather than the stage the project is on, so
  // the dossier stays readable from anywhere. It is not only a gate screen:
  // after approval it is the reference the script was written from.
  const showDossier = dossier !== undefined && viewing === 'dossier'
  const showScript = script !== undefined && viewing === 'script'
  const showVoice = viewing === 'voice' && voice.expectedParagraphs > 0
  const showVisuals = viewing === 'visuals' && visuals.coverage.slots > 0
  const showPreview = viewing === 'assembly' && preview.timeline !== null
  const showShorts = viewing === 'shorts' && shortCards.shorts.length > 0
  const showPublish = viewing === 'publish' && publish.items.length > 0

  /**
   * The preview copy is materialised server-side with short-lived URLs
   * (spec section 8.2) — mock narration resolves to the app's own audio
   * route, real keys presign when R2 exists, and anything unresolvable is
   * dropped and counted rather than crashing the player.
   */
  const previewMaterialised = showPreview
    ? await materialiseForPreview(preview.timeline!, {
        origin: (process.env['AUTH_URL'] ?? 'http://localhost:3000').replace(/\/$/, ''),
        presign: storageConfigured() ? (key) => presignGet(key) : null,
      })
    : null

  const toRenderProp = (row: NonNullable<typeof preview.render>): PreviewRenderProp => ({
    id: row.id,
    status: row.status,
    progressPct: row.progressPct,
    costUsd: row.costUsd,
    qcReport: (row.qcReport ?? null) as PreviewRenderProp['qcReport'],
    error: (row.error ?? null) as PreviewRenderProp['error'],
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  })
  const previewRender: PreviewRenderProp | null = preview.render
    ? toRenderProp(preview.render)
    : null
  const previewDraft = preview.draft
    ? { ...toRenderProp(preview.draft), timelineVersion: preview.draft.timelineVersion }
    : null

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
    // would die on its first step. Summary flags, not model presence — the
    // models are per-view now (decision 186).
    (viewing !== 'script' || project.dossierVersion !== null) &&
    // And the narration is read from the script, for the same reason —
    // as is the visual board.
    ((viewing !== 'voice' && viewing !== 'visuals') || project.hasScript)

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold">{project.title}</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            <span className="font-mono">{project.caseCategory}</span> · {project.caseTitle} ·{' '}
            {project.targetRuntimeMin} min target
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LiveRefresh
            active={moving}
            pulseUrl={`/api/pulse?project=${project.id}`}
            initialPulse={pulse}
          />
          {control.kind === 'stop' ? (
            <StopButton
              projectId={project.id}
              renderInFlight={
                preview.render !== undefined &&
                ['queued', 'invoking', 'rendering', 'qc'].includes(preview.render.status)
              }
            />
          ) : null}
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
      {/* The visuals PLAN checkpoint has its own primary button inside the
          board ("Fetch visuals · est $"); the generic Approve here would
          send gate/visuals.approved at a runner parked on plan.approved —
          two buttons, two meanings, one of them lost. */}
      {atGate &&
      !budgetGate &&
      viewingCurrent &&
      project.stage !== 'assembly' &&
      !(project.stage === 'visuals' && project.visualsPhase === 'plan') ? (
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
                ? `${voice.coverage.paragraphs} of ${voice.expectedParagraphs} ` +
                  `paragraphs narrated · ` +
                  `${voice.coverage.flagged} flagged. Approving sends this to the visuals stage.`
                : project.stage === 'visuals'
                  ? `${visuals.coverage.slots} slots · ${visuals.coverage.resolved} resolved · ` +
                    `${visuals.coverage.placeholder} placeholders. Approving locks the board for assembly (M6).`
                  : gateContext(project.stage, dossier)
          }
          {...(project.stage === 'dossier' && blockedReason ? { blockedReason } : {})}
          {...(project.stage === 'voice' && voice.blockedReason
            ? { blockedReason: voice.blockedReason }
            : {})}
          {...(project.stage === 'visuals' && visuals.blockedReason
            ? { blockedReason: visuals.blockedReason }
            : {})}
          {...(project.stage === 'visuals' ? { placeholders: visuals.placeholders } : {})}
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

      {showPreview && previewMaterialised ? (
        <PreviewScreen
          projectId={project.id}
          timeline={previewMaterialised.timeline}
          dropped={previewMaterialised.dropped}
          chapters={preview.stats.chapters}
          version={preview.version}
          slotCount={preview.stats.slotCount}
          beds={preview.beds}
          currentBedKey={preview.currentBedKey}
          estimatedCostUsd={preview.estimatedCostUsd}
          estimatedDraftCostUsd={preview.estimatedDraftCostUsd}
          live={!mockProvidersEnabled()}
          atGate={atGate && project.stage === 'assembly'}
          render={previewRender}
          draft={previewDraft}
        />
      ) : showPublish ? (
        <PublishScreen projectId={project.id} model={publish} live={!mockProvidersEnabled()} />
      ) : showShorts ? (
        <ShortsScreen
          projectId={project.id}
          shorts={shortCards.shorts}
          live={!mockProvidersEnabled()}
          canAdvance={project.stage === 'shorts' && !liveRun}
        />
      ) : showVisuals ? (
        <VisualBoard
          projectId={project.id}
          model={visuals}
          colors={{
            accent: settings.brandKit.colors.accent,
            surface: settings.brandKit.colors.surface,
            textPrimary: settings.brandKit.colors.textPrimary,
            textSecondary: settings.brandKit.colors.textSecondary,
            chartSeries: settings.brandKit.colors.chartSeries,
            collapse: settings.brandKit.colors.semantic.collapse,
          }}
        />
      ) : showVoice ? (
        <VoiceReview projectId={project.id} model={voice} />
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
                  : viewing === 'visuals'
                    ? 'No shot list has been planned yet. The board is planned from the approved narration.'
                    : viewing === 'assembly'
                      ? 'No timeline has been compiled yet. Assembly cuts the approved takes and board into one.'
                      : viewing === 'shorts'
                        ? 'No Shorts yet. They are cut from the rendered master, from the segments marked on the script.'
                        : viewing === 'publish'
                          ? 'Nothing to schedule yet. Publishing opens once there is a rendered master.'
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
      'Approving sends this to the script stage.'
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
