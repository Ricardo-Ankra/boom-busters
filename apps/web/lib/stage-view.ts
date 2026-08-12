import { PIPELINE_STAGES } from '@boom-busters/db'
import type { ProjectStage, StageStatus } from '@boom-busters/db'

/**
 * What each stage of a project has, and whether it is still trustworthy.
 *
 * The rail used to answer this by position: every stage before the current one
 * was `approved`, every stage after it `upcoming`. That is only true of a
 * project that has moved forwards and never back. The moment you re-run the
 * dossier of a project that already has a script, position says the script is
 * "not started" while its six chapters sit in the database — and says the
 * dossier is "running" with no hint that the narration downstream was written
 * from the research being replaced.
 *
 * So state comes from what actually exists, and staleness is **derived**: an
 * artefact records the version of the input it was built from, and it is stale
 * when that number is behind. Nothing stores an `isStale` flag, because a
 * stored flag is a second version of the truth and the first write that forgets
 * to set it starts a quiet lie about which dossier the narration came from.
 *
 * M4-M7 extend this by adding their artefact to `StageInputs` and their rule to
 * `stageOf`. The shape is deliberately one function: the alternative is
 * staleness logic spread across seven screens, each subtly disagreeing.
 */

export type StageAvailability =
  /** Nothing here yet. */
  | 'upcoming'
  /** Has output, built from current inputs. */
  | 'ready'
  /** Has output, but an input has been replaced since. */
  | 'stale'
  /** Has output whose provenance predates version tracking. */
  | 'unknown-provenance'

export interface StageView {
  stage: ProjectStage
  availability: StageAvailability
  /** The live status, for the stage the project is actually on. */
  status: StageStatus | null
  /** True for the stage the project is on right now. */
  current: boolean
  /**
   * Whether a run is genuinely executing on this stage — the run mirror's
   * answer, not the project row's.
   *
   * These come apart, and the rail was reading the wrong one. `stageStatus`
   * says `running` from the moment a runner sets it until something sets it to
   * anything else, which includes every run that died, was cancelled, or was
   * superseded. Spinning an icon on that told the user work was in progress
   * when nothing at all was happening.
   */
  live: boolean
  /** Whether there is a screen worth opening. */
  viewable: boolean
  /** Why it is stale, in words, when it is. */
  staleReason?: string
}

export interface StageInputs {
  project: { stage: ProjectStage; stageStatus: StageStatus }
  /** From the run mirror: is anything actually executing on this project? */
  liveRun?: boolean
  dossier?: { version: number } | undefined
  script?: { builtFromDossierVersion: number | null } | undefined
}

/**
 * The dossier is the root of the traceability chain, so it is never stale —
 * there is nothing upstream of it to have changed. Everything else is measured
 * against it, directly or through the stage above.
 */
interface Derived {
  availability: StageAvailability
  staleReason?: string
}

function dossierView(input: StageInputs): Derived {
  return { availability: input.dossier ? 'ready' : 'upcoming' }
}

function scriptView(input: StageInputs): Derived {
  if (!input.script) return { availability: 'upcoming' }
  if (!input.dossier) {
    // A script with no dossier behind it at all. Rare, and worth saying rather
    // than quietly calling fresh.
    return {
      availability: 'unknown-provenance',
      staleReason: 'There is no dossier behind this script.',
    }
  }

  const builtFrom = input.script.builtFromDossierVersion
  if (builtFrom === null) {
    return {
      availability: 'unknown-provenance',
      staleReason:
        'This script predates provenance tracking, so which dossier it was written from is not ' +
        'recorded. Re-run it if that matters.',
    }
  }

  if (builtFrom < input.dossier.version) {
    const behind = input.dossier.version - builtFrom
    return {
      availability: 'stale',
      staleReason:
        `Written from an older dossier — the research has been replaced ` +
        `${behind === 1 ? 'once' : `${behind} times`} since. Re-run the script stage to ` +
        'rewrite it from the current research.',
    }
  }

  return { availability: 'ready' }
}

/** One view per stage, in pipeline order. */
export function stageViews(input: StageInputs): StageView[] {
  const currentIndex = PIPELINE_STAGES.indexOf(input.project.stage)

  return PIPELINE_STAGES.map((stage, index) => {
    const current = stage === input.project.stage

    const derived: Derived =
      stage === 'dossier'
        ? dossierView(input)
        : stage === 'script'
          ? scriptView(input)
          : // M4 onwards. Until a stage has a runner it can only be described
            // by where the project has got to, which is what position gives.
            { availability: index < currentIndex ? 'ready' : 'upcoming' }

    return {
      stage,
      availability: derived.availability,
      status: current ? input.project.stageStatus : null,
      current,
      live: current && (input.liveRun ?? false),
      // The current stage is always worth opening, even with nothing in it —
      // that is where the run's status and its controls live.
      viewable: current || derived.availability !== 'upcoming',
      ...(derived.staleReason ? { staleReason: derived.staleReason } : {}),
    }
  })
}

/**
 * The same thing from a `ProjectSummary`, which already carries the provenance
 * columns. One helper so the Projects list and the project screen cannot
 * disagree about what a rail segment means.
 */
export function stageViewsForProject(
  project: {
    stage: ProjectStage
    stageStatus: StageStatus
    dossierVersion: number | null
    hasScript: boolean
    scriptBuiltFromDossierVersion: number | null
  },
  liveRun = false,
): StageView[] {
  return stageViews({
    project: { stage: project.stage, stageStatus: project.stageStatus },
    liveRun,
    ...(project.dossierVersion === null ? {} : { dossier: { version: project.dossierVersion } }),
    ...(project.hasScript
      ? { script: { builtFromDossierVersion: project.scriptBuiltFromDossierVersion } }
      : {}),
  })
}

/** The stage a `?stage=` parameter selects, falling back to where the project is. */
export function resolveViewedStage(
  requested: string | undefined,
  views: readonly StageView[],
  fallback: ProjectStage,
): ProjectStage {
  const match = views.find((view) => view.stage === requested)
  // An unviewable stage is not an error worth a 404 — a bookmarked link to a
  // stage whose work has since been cleared should land somewhere sensible.
  return match?.viewable ? match.stage : fallback
}

/**
 * What re-running `stage` costs the stages after it.
 *
 * Named in the confirm dialog, because "this will invalidate downstream work"
 * is not something anyone can act on. Only stages that actually hold something
 * are listed: warning about a voice stage that has never run is noise that
 * teaches people to dismiss the dialog without reading it.
 */
export function downstreamOf(stage: ProjectStage, views: readonly StageView[]): StageView[] {
  const index = PIPELINE_STAGES.indexOf(stage)
  return views.filter(
    (view) =>
      PIPELINE_STAGES.indexOf(view.stage) > index &&
      view.stage !== 'done' &&
      view.availability !== 'upcoming',
  )
}
