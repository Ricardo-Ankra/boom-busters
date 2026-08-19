import type { ProjectStage, StageStatus } from '@boom-busters/db'

/**
 * Is anything expected to change on this screen without the user doing
 * something?
 *
 * Two sources, because neither alone is right. `liveRun` comes from the run
 * mirror and is the truth once Inngest has picked the work up — but there is a
 * window after Start where the event has been sent and no run row exists yet,
 * and a screen that waited for `liveRun` would sit frozen on "Queued" through
 * it. `stageStatus` covers that window.
 */
export function isMoving(project: { stageStatus: StageStatus }, liveRun: boolean): boolean {
  // `queued` and nothing else, because that is the one window the mirror
  // genuinely cannot see: the event has been sent and Inngest has not picked it
  // up. Once a runner is executing it has a mirror row — `ensureRun` happens on
  // run start, before any step — so `stageStatus === 'running'` with no live run
  // does not mean "starting", it means a runner set that column and then
  // stopped existing. Polling on it forever told the user something was
  // happening when nothing was.
  return liveRun || project.stageStatus === 'queued'
}

/**
 * Whether the gate action bar should be offered.
 *
 * A gate needs both halves: the project parked at a review, and a run actually
 * waiting on it. Offering Approve without the second is offering to send an
 * event nothing is listening for.
 */
export function isGateOpen(project: { stageStatus: StageStatus }, liveRun: boolean): boolean {
  return project.stageStatus === 'awaiting_review' && liveRun
}

// ---------------------------------------------------------------------------
// What the project header should offer
// ---------------------------------------------------------------------------

/**
 * How long a project may sit at `queued` before we stop calling it "starting".
 *
 * `project/created` is sent by the server action and picked up by Inngest in
 * about a second. Three minutes is far beyond that, so a project still queued
 * at three minutes is a project whose event never arrived — the send failed,
 * the app is not synced with Inngest, or the keys are wrong. At that point the
 * honest thing is to stop showing a soothing "starting shortly" and offer the
 * button that re-sends it.
 */
export const QUEUED_STUCK_AFTER_MS = 3 * 60_000

/**
 * The stages whose runner exists and can be re-entered from a single event.
 *
 * `dossier` re-enters on `project/created`, `script` on `gate/dossier.approved`,
 * `voice` on `gate/script.approved`, `visuals` on `gate/voice.approved`,
 * `assembly` on `gate/visuals.approved` (M6.7) — the events those runners
 * trigger on. Nothing else is listed because nothing else has a runner yet
 * (M7 onwards), and a Restart button that sends an event no function is
 * subscribed to is a button that reports success and does nothing.
 */
export const RESTARTABLE_STAGES: readonly ProjectStage[] = [
  'dossier',
  'script',
  'voice',
  'visuals',
  'assembly',
]

export type ProjectControl =
  /** A run is live: the only useful control is to stop it. */
  | { kind: 'stop' }
  /** Something is under way and no button belongs here. `message` says what. */
  | { kind: 'working'; message: string }
  /** Nothing is running and a human has to start it. */
  | { kind: 'restart'; label: string; message: string }
  /** Nothing is running and this milestone cannot restart it. */
  | { kind: 'blocked'; message: string }

/**
 * The single answer to "what does this project's header offer, and why".
 *
 * This exists as one pure function rather than a chain of ternaries in the page
 * because the bug it replaces was invisible in the page and would have been
 * obvious here: a fresh project — the state *every* real project starts in —
 * fell through to the same branch as a finished one and was offered the M2 demo
 * pipeline, a no-op that resets the stage and starts a competing run. The
 * project screen's E2E only ever drove the seeded fixture, which is parked at a
 * gate with a live run, so no test ever loaded a project in the state a human
 * actually meets first.
 *
 * The rule underneath: **the console never offers a start button for work that
 * starts itself.** Research begins when the project is created. Anything the
 * human can press before that is a way to interfere with it.
 */
export interface ControlInputs {
  /**
   * Whether a dossier exists.
   *
   * Required rather than defaulted, because defaulting it to `true` is exactly
   * the assumption that shipped the bug: the script stage's first step loads
   * the dossier and gives up without one, so a `script`/`failed` project with
   * no dossier was offered a re-run button that could only ever fail. It did,
   * in production, on `load-dossier`.
   */
  hasDossier: boolean
  /**
   * Whether a script exists. Required for the same reason as `hasDossier`: the
   * voice runner's first step loads the script and gives up without one, so a
   * `voice`/`failed` project with no script would be offered a button that can
   * only fail.
   */
  hasScript: boolean
  now?: Date
}

export function projectControl(
  project: { stage: ProjectStage; stageStatus: StageStatus; updatedAt: Date },
  liveRun: boolean,
  inputs: ControlInputs,
): ProjectControl {
  if (liveRun) return { kind: 'stop' }

  const now = inputs.now ?? new Date()
  // A stage is only restartable if its runner exists *and* the thing it runs
  // from exists. The script is written from the dossier's claims.
  const restartable =
    RESTARTABLE_STAGES.includes(project.stage) &&
    (project.stage !== 'script' || inputs.hasDossier) &&
    // Narration is read from the script, the board is planned against it,
    // and assembly compiles takes cut to its paragraphs.
    ((project.stage !== 'voice' && project.stage !== 'visuals' && project.stage !== 'assembly') ||
      inputs.hasScript)
  const stalled = now.getTime() - project.updatedAt.getTime() > QUEUED_STUCK_AFTER_MS

  const cannotRestart = (why: string): ProjectControl => ({
    kind: 'blocked',
    message:
      project.stage === 'script' && !inputs.hasDossier
        ? `${why} There is no dossier to write this script from — run the dossier stage first.`
        : project.stage === 'voice' && !inputs.hasScript
          ? `${why} There is no script to narrate — run the script stage first.`
          : project.stage === 'visuals' && !inputs.hasScript
            ? `${why} There is no script to plan visuals for — run the script stage first.`
            : project.stage === 'assembly' && !inputs.hasScript
              ? `${why} There is no script to assemble — run the script stage first.`
              : `${why} Restarting the ${project.stage} stage arrives with its runner.`,
  })

  switch (project.stageStatus) {
    case 'queued':
      // Queued and young is the normal first second of a project's life, and
      // it is not a state to put a button in front of.
      if (!stalled) {
        return {
          kind: 'working',
          message: 'Queued. The pipeline picks this up within a few seconds — nothing to press.',
        }
      }
      return restartable
        ? {
            kind: 'restart',
            label: 'Send it to the pipeline again',
            message:
              'Queued for several minutes with no run behind it, so the pipeline never received ' +
              'it. Check that the app is synced with Inngest, then send it again.',
          }
        : cannotRestart('Queued for several minutes with no run behind it.')

    case 'running':
      // Reaching this line already means no live run — a live one returned
      // `stop` above — and a genuinely running runner always has a mirror row,
      // because `ensureRun` fires before any step. So `running` with nothing
      // behind it is a runner that set the column and stopped existing. The one
      // honest window is the handoff: closing a gate stamps the *next* stage
      // `running` a beat before that stage's runner has mirrored itself. Past
      // the same threshold `queued` uses, the handoff plainly never happened —
      // production's case was a voice gate approved on a deployment whose
      // visuals runner did not exist yet, leaving the project "running" a stage
      // nothing had picked up, with the screen promising it would update
      // itself.
      if (!stalled) {
        return {
          kind: 'working',
          message: `Running the ${project.stage} stage. This screen updates itself.`,
        }
      }
      return restartable
        ? {
            kind: 'restart',
            label: `Run the ${project.stage} stage again`,
            message:
              'Marked running, but no run is behind it — the stage was handed over and nothing ' +
              'picked it up. Running the stage again is the way out.',
          }
        : cannotRestart('Marked running, but no run is behind it.')

    case 'approved':
      return { kind: 'working', message: 'Approved. The next stage starts on its own.' }

    case 'awaiting_review':
      // Stranded: `isGateOpen` refused the gate bar because no run is waiting,
      // so this is the only branch that can offer a way out.
      return restartable
        ? {
            kind: 'restart',
            label: `Run the ${project.stage} stage again`,
            message:
              'Marked awaiting review, but no run is waiting on it — an approval would reach ' +
              'nothing. Running the stage again is the way out.',
          }
        : cannotRestart('Marked awaiting review, but no run is waiting on it.')

    case 'failed':
      return restartable
        ? {
            kind: 'restart',
            label: `Run the ${project.stage} stage again`,
            message: 'This stage failed. Fix the cause, then run it again.',
          }
        : cannotRestart('This stage failed.')

    case 'cancelled':
      return restartable
        ? {
            kind: 'restart',
            label: `Run the ${project.stage} stage again`,
            message: 'Stopped. Work already done is kept; running it again replaces it.',
          }
        : cannotRestart('Stopped.')
  }
}
