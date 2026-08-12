import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { stageViews } from '@/lib/stage-view'
import { PipelineRail } from './pipeline-rail'

/**
 * The rail's job beyond decoration: spec section 11.3 says each segment "is
 * clickable", and it shipped as eight `<div>`s — so a project on the script
 * stage had no way back to the dossier its narration was written from.
 */

const PROJECT_ID = '01J0000000000000000000000A'

function renderRail(input: Parameters<typeof stageViews>[0], viewing: 'dossier' | 'script') {
  const views = stageViews(input)
  return render(<PipelineRail views={views} projectId={PROJECT_ID} viewing={viewing} />)
}

const midProject = {
  project: { stage: 'script' as const, stageStatus: 'awaiting_review' as const },
  dossier: { version: 1 },
  script: { version: 1, builtFromDossierVersion: 1 },
}

describe('PipelineRail', () => {
  it('links back to a completed earlier stage', () => {
    renderRail(midProject, 'script')

    expect(screen.getByRole('link', { name: /Dossier/ })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}?stage=dossier`,
    )
  })

  it('marks the segment on screen for assistive technology, not only with a ring', () => {
    renderRail(midProject, 'dossier')

    expect(screen.getByRole('link', { name: /Dossier/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Script/ })).not.toHaveAttribute('aria-current')
  })

  it('does not make a stage with nothing in it look pressable', () => {
    renderRail(midProject, 'script')

    // A control that looks like a link and goes nowhere is worse than plain
    // text — there is no voice work to read.
    expect(screen.queryByRole('link', { name: /Voice/ })).not.toBeInTheDocument()
    expect(screen.getByText('Voice')).toBeInTheDocument()
  })

  it('names each stage and its state without relying on colour', () => {
    renderRail(midProject, 'script')

    expect(screen.getByRole('link', { name: /Dossier/ })).toHaveAccessibleName(/approved/)
    expect(screen.getByRole('link', { name: /Script/ })).toHaveAccessibleName(/awaiting review/)
    expect(screen.getByText('Voice').closest('li')).toHaveTextContent(/not started/)
  })

  it('says which stage the project is actually on, for a screen reader', () => {
    // On a project navigated back through, the segment you are reading and the
    // segment the project is parked at are different, and both matter.
    renderRail(midProject, 'dossier')

    expect(screen.getByRole('link', { name: /Script/ })).toHaveAccessibleName(
      /the stage this project is on/,
    )
    expect(screen.getByRole('link', { name: /Dossier/ })).not.toHaveAccessibleName(
      /the stage this project is on/,
    )
  })

  /**
   * A spinner is a promise that something is happening. `stageStatus` reads
   * `running` from the moment a runner sets it until something sets it
   * otherwise — including every run that died — so a project untouched for a
   * day still turned a spinner, and the only way to learn nothing was running
   * was to keep waiting.
   */
  describe('the spinner', () => {
    const onScript = (liveRun: boolean) => ({
      project: { stage: 'script' as const, stageStatus: 'running' as const },
      liveRun,
      dossier: { version: 1 },
      script: { version: 1, builtFromDossierVersion: 1 },
    })

    it('turns only when the run mirror can see a run', () => {
      const { container } = renderRail(onScript(true), 'script')
      expect(container.querySelector('.animate-spin')).not.toBeNull()
      expect(screen.getByRole('link', { name: /Script/ })).toHaveAccessibleName(/running/)
    })

    it('is still when the column says running and nothing is', () => {
      const { container } = renderRail(onScript(false), 'script')

      expect(container.querySelector('.animate-spin')).toBeNull()
      // Still the stage in play, and said in words rather than only in colour.
      expect(screen.getByRole('link', { name: /Script/ })).toHaveAccessibleName(
        /the current stage, nothing running/,
      )
    })
  })

  it('calls an approved-but-outdated stage stale rather than approved', () => {
    // "Approved" is true and misleading in the same breath: it was approved,
    // and what it was approved against has since been replaced.
    renderRail(
      {
        project: { stage: 'script', stageStatus: 'approved' },
        dossier: { version: 2 },
        script: { version: 1, builtFromDossierVersion: 1 },
      },
      'script',
    )

    expect(screen.getByRole('link', { name: /Script/ })).toHaveAccessibleName(/needs re-running/)
  })

  it('lets a live status win over staleness, because it describes now', () => {
    renderRail(
      {
        project: { stage: 'script', stageStatus: 'running' },
        dossier: { version: 2 },
        script: { version: 1, builtFromDossierVersion: 1 },
      },
      'script',
    )

    expect(screen.getByRole('link', { name: /Script/ })).toHaveAccessibleName(/running/)
  })

  /**
   * The regression the positional derivation guaranteed: re-run the dossier of
   * a project that already has a script and the old rail called that script
   * "not started" while its chapters sat in the database.
   */
  it('still shows a script that exists after the project has gone back to the dossier', () => {
    renderRail(
      {
        project: { stage: 'dossier', stageStatus: 'running' },
        dossier: { version: 2 },
        script: { version: 1, builtFromDossierVersion: 1 },
      },
      'dossier',
    )

    const script = screen.getByRole('link', { name: /Script/ })
    expect(script).toBeInTheDocument()
    // And says it is not to be trusted, in words rather than a dashed border.
    expect(script).toHaveAccessibleName(/needs re-running/)
  })
})
