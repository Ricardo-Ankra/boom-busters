import { e2eDatabaseUrl } from './database'

/** Named here and asserted on in `project-lifecycle.spec.ts`. */
export const QUEUED_PROJECT_TITLE = 'Just created, nothing mirrored yet (E2E)'
export const STOPPED_PROJECT_TITLE = 'Stopped, needs a way back (E2E)'
export const STALE_PROJECT_TITLE = 'Script written from an older dossier (E2E)'
export const BEYOND_RUNNERS_TITLE = 'Past the last runner we have built (E2E)'
export const NO_DOSSIER_TITLE = 'Script stage, no dossier to write from (E2E)'
export const DENSE_WARNINGS_TITLE = 'A chapter with every warning kind (E2E)'
export const NARRATED_PROJECT_TITLE = 'Narration ready for review (E2E)'
export const FLAGGED_TAKE_TITLE = 'Narration with a flagged take (E2E)'
export const VISUAL_BOARD_TITLE = 'Visual board ready for review (E2E)'

/**
 * Twenty-two warnings across all three kinds, which is what the self-check
 * really produces.
 *
 * Production's densest chapter carries 22; the kinds run `missing-alleged` 31,
 * `unsourced-claim` 18, `unsupported-attribution` 4. Fixtures with two clean
 * chapters never exercise the gutter at the density where it has to work.
 */
type WarningKind = 'unsourced-claim' | 'missing-alleged' | 'unsupported-attribution'

function denseWarnings(): { kind: WarningKind; sentence: string; message: string }[] {
  const sentences = Array.from(
    { length: 22 },
    (_, index) => `Sentence ${index + 1} of the chapter, which the self-check took issue with.`,
  )

  return sentences.map((sentence, index) => {
    const kind: WarningKind =
      index % 5 === 4
        ? 'unsupported-attribution'
        : index % 2 === 0
          ? 'missing-alleged'
          : 'unsourced-claim'
    return {
      kind,
      sentence,
      message:
        kind === 'missing-alleged'
          ? 'States as fact something no court has adjudicated.'
          : kind === 'unsourced-claim'
            ? 'No claim in the dossier supports this sentence.'
            : 'Attributes a statement to someone without a source for it.',
    }
  })
}

/**
 * Put the database into a known state before the suite runs.
 *
 * Without this the E2E suite inherits whatever the Inngest integration tests
 * left behind — a fixture project that is `done`, a ledger full of demo rows,
 * a run mirror with old events. Assertions written against "the fixture
 * project awaits review" would then pass or fail depending on test order,
 * which is the worst kind of flake.
 */
export default async function globalSetup(): Promise<void> {
  const url = e2eDatabaseUrl()

  const {
    createDb,
    createProjectFromCase,
    createScriptVersion,
    ensureRun,
    recordRunEvent,
    claimTake,
    flagTake,
    mockVoiceTakeKey,
    saveChapter,
    saveDossier,
    seed,
    storeTakeAudio,
    setChapterWarnings,
    setProjectStage,
    setRunStatus,
    truncateRunMirror,
    FIXTURE_CASE_ID,
    FIXTURE_PROJECT_ID,
    deleteCasesExcept,
    deleteProjectsExcept,
    updateSettings,
  } = await import('@boom-busters/db')
  const { truncateLedger } = await import('@boom-busters/cost')
  const { takeIdempotencyKey } = await import('@boom-busters/schemas')

  const connection = createDb(url, { max: 2 })
  try {
    await seed(connection.db)
    // Rows the previous run's tests created, before re-seeding leaves them
    // beside the fixture and every exact assertion starts matching twice.
    await deleteCasesExcept(connection.db, [FIXTURE_CASE_ID])
    // Including the projects seeded below, which hang off the fixture case and
    // so survive the line above. Two per run, accumulating silently, until a
    // title that should appear once appears four times.
    await deleteProjectsExcept(connection.db, [FIXTURE_PROJECT_ID])
    await truncateRunMirror(connection.db)
    await truncateLedger(connection.db)
    // A project parked at a gate, as the runner would leave it: the project
    // row *and* a mirrored run waiting on it. Setting only the project row
    // would produce the stranded state the project screen deliberately
    // refuses to offer gate buttons for.
    await setProjectStage(connection.db, FIXTURE_PROJECT_ID, {
      stage: 'dossier',
      stageStatus: 'awaiting_review',
      inngestRunId: null,
    })
    const runId = await ensureRun(connection.db, {
      inngestRunId: '01E2ESETUP0000000000000001',
      functionName: 'demo-runner',
      projectId: FIXTURE_PROJECT_ID,
      stage: 'dossier',
    })
    await recordRunEvent(connection.db, {
      runId,
      kind: 'gate.opened',
      message: 'Demo dossier ready · 0 claims · nothing was actually researched',
      data: { gate: 'dossier' },
    })
    await setRunStatus(connection.db, runId, 'awaiting_gate')

    /**
     * A second project in the state every real project actually starts in:
     * `dossier`/`queued` with no run mirrored yet, because Inngest has been
     * handed `project/created` and has not picked it up in this millisecond.
     *
     * It exists because its absence let a serious bug ship. Every project test
     * drove the fixture above — parked at a gate, with a live run — so no test
     * ever loaded the first screen a human sees after making a project, and
     * nothing noticed that the screen offered them the M2 demo pipeline as its
     * only button.
     */
    await createProjectFromCase(connection.db, {
      caseId: FIXTURE_CASE_ID,
      title: QUEUED_PROJECT_TITLE,
    })

    /**
     * And a project that was stopped: cancelled, with no run left behind it.
     *
     * This is where a human lands after pressing Stop, and it used to be a dead
     * end — the screen's only button started the M2 demo pipeline. Seeded
     * rather than produced by driving Stop in a test, because stopping is now
     * refused unless Inngest accepts the event and this suite runs no Inngest.
     */
    const stopped = await createProjectFromCase(connection.db, {
      caseId: FIXTURE_CASE_ID,
      title: STOPPED_PROJECT_TITLE,
    })
    await setProjectStage(connection.db, stopped.id, {
      stage: 'dossier',
      stageStatus: 'cancelled',
    })

    /**
     * And a project whose script was written from research that has since been
     * replaced — built the way one really arises: research, script, re-research.
     *
     * `saveDossier` bumps `dossiers.version` on every save and
     * `createScriptVersion` stamps the version it read, so the second save is
     * what makes the script stale. Setting the columns by hand would test the
     * assertion rather than the mechanism.
     */
    const stale = await createProjectFromCase(connection.db, {
      caseId: FIXTURE_CASE_ID,
      title: STALE_PROJECT_TITLE,
    })
    await saveDossier(connection.db, {
      projectId: stale.id,
      contentMd: '# First pass\n\nThe research the script below was written from.',
      claims: [],
    })
    const staleScript = await createScriptVersion(connection.db, stale.id)
    await saveChapter(connection.db, {
      scriptId: staleScript.id,
      index: 0,
      title: 'Chapter written from the first pass',
      contentMd: 'Narration produced before the research was replaced.',
      estRuntimeSec: 60,
    })
    await saveDossier(connection.db, {
      projectId: stale.id,
      contentMd: '# Second pass\n\nThe research was re-run, so the script above is behind.',
      claims: [],
    })
    await setProjectStage(connection.db, stale.id, {
      stage: 'script',
      stageStatus: 'approved',
    })

    /**
     * Three more shapes, every one taken from the production database rather
     * than invented. Between them they are the states this suite kept missing.
     */

    // 1. A project past the last runner that exists. Production had one sitting
    //    at `voice`/`running` with no live run; M4 built the voice runner and
    //    M5 the visuals runner, so the same shape now lives at `assembly`. The
    //    state being tested is unchanged — a stage with no runner behind it,
    //    and a `running` column with nothing running — and it has to move
    //    whenever a milestone lands, because "past the last runner" is a
    //    moving target.
    const beyond = await createProjectFromCase(connection.db, {
      caseId: FIXTURE_CASE_ID,
      title: BEYOND_RUNNERS_TITLE,
    })
    await saveDossier(connection.db, {
      projectId: beyond.id,
      contentMd: '# Researched, scripted, and now waiting on a runner that does not exist yet.',
      claims: [],
    })
    const beyondScript = await createScriptVersion(connection.db, beyond.id)
    await saveChapter(connection.db, {
      scriptId: beyondScript.id,
      index: 0,
      title: 'Approved and handed onward',
      contentMd: 'The narration this project was approved with.',
      estRuntimeSec: 120,
    })
    await setProjectStage(connection.db, beyond.id, {
      stage: 'assembly',
      // `running` with nothing running — the exact combination that turned a
      // spinner for a day.
      stageStatus: 'running',
    })

    // 2. A project on the script stage with no dossier at all. Production has
    //    one, and re-running its script stage failed on `load-dossier` every
    //    time, because a script is written from a dossier's claims.
    const orphaned = await createProjectFromCase(connection.db, {
      caseId: FIXTURE_CASE_ID,
      title: NO_DOSSIER_TITLE,
    })
    await setProjectStage(connection.db, orphaned.id, {
      stage: 'script',
      stageStatus: 'failed',
    })

    // 3. A chapter at the warning density the self-check really produces.
    const dense = await createProjectFromCase(connection.db, {
      caseId: FIXTURE_CASE_ID,
      title: DENSE_WARNINGS_TITLE,
    })
    await saveDossier(connection.db, {
      projectId: dense.id,
      contentMd: '# The research behind a heavily flagged chapter.',
      claims: [],
    })
    const denseScript = await createScriptVersion(connection.db, dense.id)
    const denseChapter = await saveChapter(connection.db, {
      scriptId: denseScript.id,
      index: 0,
      title: 'Twenty-two warnings',
      contentMd: denseWarnings()
        .map((warning) => warning.sentence)
        .join(' '),
      estRuntimeSec: 180,
    })
    await setChapterWarnings(connection.db, denseChapter.id, denseWarnings())
    await setProjectStage(connection.db, dense.id, {
      stage: 'script',
      stageStatus: 'approved',
    })

    /**
     * 4 and 5. Narration, in the two states the voice gate cares about.
     *
     * Seeded through `claimTake`/`storeTakeAudio` rather than by inserting
     * rows, so the fixture exercises the idempotency key and the take
     * numbering the runner depends on. Nothing is written to R2: the takes
     * carry `mock://` keys and the audio route regenerates their bytes, which
     * is what lets the suite actually press Play.
     */
    const narratedText = [
      'The auditors signed the accounts for eighteen straight years.',
      'Nobody asked the obvious question about where the cash actually sat.',
      'By the time anyone did, the answer was that it had never existed.',
    ]

    async function narrate(
      title: string,
      options: { retakeFirst?: boolean; flagSecond?: boolean } = {},
    ): Promise<void> {
      const project = await createProjectFromCase(connection.db, {
        caseId: FIXTURE_CASE_ID,
        title,
      })
      await saveDossier(connection.db, {
        projectId: project.id,
        contentMd: '# The research the narration was ultimately read from.',
        claims: [],
      })
      const script = await createScriptVersion(connection.db, project.id)
      const chapter = await saveChapter(connection.db, {
        scriptId: script.id,
        index: 0,
        title: 'The audit that never happened',
        // Blank lines, because that is what `splitParagraphs` splits on.
        contentMd: narratedText.join('\n\n'),
        estRuntimeSec: 90,
      })

      for (const [paragraphIndex, text] of narratedText.entries()) {
        const key = takeIdempotencyKey({
          projectId: project.id,
          chapterId: chapter.id,
          paragraphIndex,
          text,
          voiceId: 'mock-narrator',
        })

        const claimed = await claimTake(connection.db, {
          projectId: project.id,
          chapterId: chapter.id,
          paragraphIndex,
          idempotencyKey: key,
          provider: 'elevenlabs',
          voiceId: 'mock-narrator',
          builtFromScriptVersion: script.version,
        })
        await storeTakeAudio(connection.db, claimed.take.id, {
          r2Key: mockVoiceTakeKey(claimed.take.id),
          durationMs: 6_000 + paragraphIndex * 1_500,
          costUsd: 0.0009,
          waveform: Array.from({ length: 32 }, (_, i) => (i * 7 + paragraphIndex * 11) % 100),
        })

        // A paragraph that was flagged and retaken, so the A/B toggle has
        // something real to compare.
        if (paragraphIndex === 0 && options.retakeFirst) {
          await flagTake(connection.db, claimed.take.id, 'Swallowed the word "eighteen".')
          const retake = await claimTake(connection.db, {
            projectId: project.id,
            chapterId: chapter.id,
            paragraphIndex,
            idempotencyKey: key,
            provider: 'elevenlabs',
            voiceId: 'mock-narrator',
            builtFromScriptVersion: script.version,
            takeNumber: 2,
          })
          await storeTakeAudio(connection.db, retake.take.id, {
            r2Key: mockVoiceTakeKey(retake.take.id),
            durationMs: 6_400,
            costUsd: 0.0009,
            waveform: Array.from({ length: 32 }, (_, i) => (i * 3 + 20) % 100),
          })
        }

        // A flag with no retake behind it: the state the gate must refuse on.
        if (paragraphIndex === 1 && options.flagSecond) {
          await flagTake(connection.db, claimed.take.id, 'Read the figure as a question.')
        }
      }

      await setProjectStage(connection.db, project.id, {
        stage: 'voice',
        stageStatus: 'awaiting_review',
      })
    }

    await narrate(NARRATED_PROJECT_TITLE, { retakeFirst: true })
    await narrate(FLAGGED_TAKE_TITLE, { flagSecond: true })

    /**
     * 6. A project parked at the visuals gate, board resolved — the M5 review
     * screen in the state the runner leaves it: a stock slot with scored
     * candidates and one chosen, a claim-sourced chart, a map, and one
     * placeholder so the gate must take the explicit "approve with 1
     * placeholder" wording. Thumbnails are inline SVG data URLs (the mock
     * adapters' own trick), so the strip renders with no storage behind it.
     */
    {
      const { replaceShotList, listShotSlots, setSlotResolution } = await import('@boom-busters/db')

      const board = await createProjectFromCase(connection.db, {
        caseId: FIXTURE_CASE_ID,
        title: VISUAL_BOARD_TITLE,
      })
      await saveDossier(connection.db, {
        projectId: board.id,
        contentMd: '# The research the board below was planned from.',
        claims: [],
      })
      const boardScript = await createScriptVersion(connection.db, board.id)
      const boardChapter = await saveChapter(connection.db, {
        scriptId: boardScript.id,
        index: 0,
        title: 'The collapse on screen',
        contentMd: narratedText.join('\n\n'),
        estRuntimeSec: 90,
      })

      // Narration takes, so the scrubber has audio to play (mock:// keys).
      for (const [paragraphIndex, text] of narratedText.entries()) {
        const key = takeIdempotencyKey({
          projectId: board.id,
          chapterId: boardChapter.id,
          paragraphIndex,
          text,
          voiceId: 'mock-narrator',
        })
        const claimed = await claimTake(connection.db, {
          projectId: board.id,
          chapterId: boardChapter.id,
          paragraphIndex,
          idempotencyKey: key,
          provider: 'elevenlabs',
          voiceId: 'mock-narrator',
          builtFromScriptVersion: boardScript.version,
        })
        await storeTakeAudio(connection.db, claimed.take.id, {
          r2Key: mockVoiceTakeKey(claimed.take.id),
          durationMs: 6_000,
          costUsd: 0.0009,
          waveform: Array.from({ length: 32 }, (_, i) => (i * 5) % 100),
        })
      }

      const thumb = (label: string, hue: number) =>
        `data:image/svg+xml;base64,${Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">` +
            `<rect width="320" height="180" fill="hsl(${hue},18%,22%)"/>` +
            `<text x="160" y="95" font-family="monospace" font-size="14" fill="#ddd" text-anchor="middle">${label}</text></svg>`,
        ).toString('base64')}`

      const common = {
        motion: { kind: 'static' as const },
        transition: 'cut' as const,
      }

      await replaceShotList(connection.db, board.id, [
        {
          chapterId: boardChapter.id,
          index: 0,
          type: 'stock',
          brief: {
            type: 'stock',
            ...common,
            coversText: narratedText[0]!,
            description: 'Deserted open-plan office at dusk, cool blue grade.',
            query: 'empty office dusk',
            rejectionCriteria: ['no watermarks'],
          },
          startMs: 0,
          durationMs: 6000,
        },
        {
          chapterId: boardChapter.id,
          index: 1,
          type: 'chart',
          brief: {
            type: 'chart',
            ...common,
            coversText: narratedText[1]!,
            description: 'The nine-day share-price collapse, drawn on.',
            chartKind: 'line',
            series: [
              {
                label: 'Share price',
                unit: 'EUR',
                points: [
                  { x: '2020-06-17', y: 104.5 },
                  { x: '2020-06-22', y: 14.44 },
                  { x: '2020-06-26', y: 1.28 },
                ],
              },
            ],
            // A legal ULID matters: Crockford base32 has no I, L, O or U, and
            // an illegal one fails the brief schema — which the board would
            // faithfully render as the chart ERROR card instead of a chart.
            dataRefs: ['01E2EC000000000000000000AA'],
            takeaway: 'From 104 to 1.28 in nine days.',
            reveal: 'draw-on',
          },
          startMs: 6000,
          durationMs: 6000,
        },
        {
          chapterId: boardChapter.id,
          index: 2,
          type: 'map',
          brief: {
            type: 'map',
            ...common,
            coversText: narratedText[2]!,
            description: 'The money moves from Munich to Manila.',
            locations: [
              { label: 'Munich', lat: 48.14, lon: 11.58 },
              { label: 'Manila', lat: 14.6, lon: 120.98 },
            ],
            route: true,
          },
          startMs: 12000,
          durationMs: 6000,
        },
        {
          chapterId: boardChapter.id,
          index: 3,
          type: 'stock',
          brief: {
            type: 'stock',
            ...common,
            coversText: narratedText[2]!,
            description: 'A courtroom sketch nothing free will ever have.',
            query: 'courtroom nothing matches this',
            rejectionCriteria: [],
          },
          startMs: 12000,
          durationMs: 6000,
        },
      ])

      const slots = await listShotSlots(connection.db, board.id)
      await setSlotResolution(connection.db, slots[0]!.id, {
        candidates: [
          {
            id: 'e2e-a1',
            provider: 'pexels',
            kind: 'image',
            sourceUrl: 'https://example.com/office-1.jpg',
            pageUrl: 'https://example.com/office-1',
            thumbUrl: thumb('office dusk 1', 210),
            licence: 'Pexels License',
            attributionText: 'Photo by Somebody on Pexels',
            score: 91,
            scoreReason: 'Subject and mood match the brief.',
            chosen: true,
          },
          {
            id: 'e2e-b2',
            provider: 'pixabay',
            kind: 'image',
            sourceUrl: 'https://example.com/office-2.jpg',
            thumbUrl: thumb('office dusk 2', 30),
            licence: 'Pixabay Content License',
            score: 55,
            scoreReason: 'Right subject, wrong era.',
          },
        ],
        status: 'resolved',
      })
      await setSlotResolution(connection.db, slots[1]!.id, { candidates: [], status: 'resolved' })
      await setSlotResolution(connection.db, slots[2]!.id, { candidates: [], status: 'resolved' })
      // The one nothing usable was found for — the explicit-wording case.
      await setSlotResolution(connection.db, slots[3]!.id, {
        candidates: [],
        status: 'placeholder',
      })

      await setProjectStage(connection.db, board.id, {
        stage: 'visuals',
        stageStatus: 'awaiting_review',
      })
      const boardRunId = await ensureRun(connection.db, {
        inngestRunId: '01E2ESETUP0000000000000002',
        functionName: 'visuals-runner',
        projectId: board.id,
        stage: 'visuals',
      })
      await recordRunEvent(connection.db, {
        runId: boardRunId,
        kind: 'gate.opened',
        message: 'Visual board ready · 4 slots · 3 resolved · 1 placeholder',
        data: { gate: 'visuals' },
      })
      await setRunStatus(connection.db, boardRunId, 'awaiting_gate')
    }

    await updateSettings(connection.db, {
      budgets: { monthlyCeilingUsd: 100, approvedOverage: null },
      // A voice must be chosen for the stage to be runnable at all; the mock
      // adapter answers to any id, and this one says plainly what it is.
      tts: { provider: 'elevenlabs', voiceId: 'mock-narrator' },
    })
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}
