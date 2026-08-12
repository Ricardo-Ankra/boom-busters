import type { ProjectStage, StageStatus } from '@boom-busters/db'
import { describe, expect, it } from 'vitest'
import {
  downstreamOf,
  resolveViewedStage,
  stageViews,
  type StageInputs,
  type StageView,
} from './stage-view'

const at = (stage: ProjectStage, stageStatus: StageStatus = 'running'): StageInputs['project'] => ({
  stage,
  stageStatus,
})

const view = (views: StageView[], stage: ProjectStage): StageView =>
  views.find((candidate) => candidate.stage === stage)!

describe('stageViews', () => {
  it('calls a stage with nothing in it upcoming, wherever the project is', () => {
    const views = stageViews({ project: at('dossier', 'queued') })

    expect(view(views, 'script').availability).toBe('upcoming')
    expect(view(views, 'voice').availability).toBe('upcoming')
  })

  it('marks the stage the project is on, and gives only that one a status', () => {
    const views = stageViews({ project: at('script', 'awaiting_review'), dossier: { version: 1 } })

    expect(view(views, 'script')).toMatchObject({ current: true, status: 'awaiting_review' })
    expect(view(views, 'dossier')).toMatchObject({ current: false, status: null })
  })

  it('keeps an earlier stage viewable once it has produced something', () => {
    // The whole point: on the script stage, the dossier is still readable.
    const views = stageViews({
      project: at('script'),
      dossier: { version: 1 },
      script: { builtFromDossierVersion: 1 },
    })

    expect(view(views, 'dossier')).toMatchObject({ availability: 'ready', viewable: true })
  })

  it('keeps the current stage viewable even with nothing in it', () => {
    // It is where the run's status and its controls live.
    const views = stageViews({ project: at('dossier', 'queued') })
    expect(view(views, 'dossier')).toMatchObject({ availability: 'upcoming', viewable: true })
  })

  describe('staleness', () => {
    it('calls a script written from a replaced dossier stale, and says how far behind', () => {
      const views = stageViews({
        project: at('dossier', 'running'),
        dossier: { version: 3 },
        script: { builtFromDossierVersion: 1 },
      })

      const script = view(views, 'script')
      expect(script.availability).toBe('stale')
      expect(script.staleReason).toMatch(/2 times/)
      // Stale is not gone: the old script stays readable while the new
      // research runs. That is the whole decision behind this milestone.
      expect(script.viewable).toBe(true)
    })

    it('gets the singular right, because "replaced 1 times" reads as a bug', () => {
      const views = stageViews({
        project: at('dossier'),
        dossier: { version: 2 },
        script: { builtFromDossierVersion: 1 },
      })

      expect(view(views, 'script').staleReason).toMatch(/replaced once/)
    })

    it('is fresh when the script was written from the current dossier', () => {
      const views = stageViews({
        project: at('script'),
        dossier: { version: 4 },
        script: { builtFromDossierVersion: 4 },
      })

      expect(view(views, 'script').availability).toBe('ready')
      // Absent rather than present-and-empty: a banner keyed on truthiness
      // must not render for a script that is perfectly current.
      expect(view(views, 'script').staleReason).toBeUndefined()
    })

    it('never calls the dossier stale — nothing is upstream of it', () => {
      for (let version = 1; version < 5; version += 1) {
        const views = stageViews({ project: at('dossier'), dossier: { version } })
        expect(view(views, 'dossier').availability).toBe('ready')
      }
    })

    it('says provenance is unknown rather than assuming a script is fresh', () => {
      // Scripts written before the column existed. Guessing "1" would assert a
      // freshness nothing ever checked.
      const views = stageViews({
        project: at('script'),
        dossier: { version: 2 },
        script: { builtFromDossierVersion: null },
      })

      const script = view(views, 'script')
      expect(script.availability).toBe('unknown-provenance')
      expect(script.staleReason).toMatch(/not\s+recorded/)
    })

    it('says so when there is no dossier behind a script at all', () => {
      const views = stageViews({ project: at('script'), script: { builtFromDossierVersion: 1 } })

      expect(view(views, 'script')).toMatchObject({
        availability: 'unknown-provenance',
        staleReason: 'There is no dossier behind this script.',
      })
    })
  })

  it('describes every stage exactly once, in pipeline order', () => {
    const views = stageViews({ project: at('voice'), dossier: { version: 1 } })

    expect(views.map((v) => v.stage)).toEqual([
      'dossier',
      'script',
      'voice',
      'visuals',
      'assembly',
      'shorts',
      'publish',
      'done',
    ])
  })
})

describe('resolveViewedStage', () => {
  const views = stageViews({
    project: at('script'),
    dossier: { version: 1 },
    script: { builtFromDossierVersion: 1 },
  })

  it('honours a stage that has something to show', () => {
    expect(resolveViewedStage('dossier', views, 'script')).toBe('dossier')
  })

  it('falls back rather than 404ing on a stage with nothing in it', () => {
    // A bookmarked link to a stage whose work has since been cleared should
    // land somewhere sensible, not on an error.
    expect(resolveViewedStage('voice', views, 'script')).toBe('script')
    expect(resolveViewedStage('nonsense', views, 'script')).toBe('script')
    expect(resolveViewedStage(undefined, views, 'script')).toBe('script')
  })
})

describe('downstreamOf', () => {
  const views = stageViews({
    project: at('script'),
    dossier: { version: 1 },
    script: { builtFromDossierVersion: 1 },
  })

  it('names the stages a re-run would invalidate', () => {
    expect(downstreamOf('dossier', views).map((v) => v.stage)).toEqual(['script'])
  })

  it('lists nothing when the stage is the last one holding anything', () => {
    expect(downstreamOf('script', views)).toEqual([])
  })

  it('stays quiet about stages that have never run', () => {
    // Warning about a voice stage with nothing in it is noise, and noise in a
    // confirm dialog teaches people to dismiss it without reading.
    expect(downstreamOf('dossier', views).map((v) => v.stage)).not.toContain('voice')
  })

  it('never lists `done`, which is a marker rather than work', () => {
    const finished = stageViews({
      project: at('done', 'approved'),
      dossier: { version: 1 },
      script: { builtFromDossierVersion: 1 },
    })

    expect(downstreamOf('dossier', finished).map((v) => v.stage)).not.toContain('done')
  })
})
