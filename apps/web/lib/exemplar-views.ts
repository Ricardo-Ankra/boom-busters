import 'server-only'
import { MOTION_PREAMBLE, MOTION_VERSION } from '@boom-busters/compositions/motion-tokens'
import { DESIGNS, MANIFEST } from '@boom-busters/providers'
import type { ExemplarEntry, Technique } from '@boom-busters/providers'
import { GRAPHIC_CODE_VERSION } from '@boom-busters/schemas'
import type { GraphicCode, GraphicCodePayload } from '@boom-busters/schemas'
import { compileGraphicSource } from '@/lib/graphic-code/compile'

/**
 * The exemplar corpus as Settings shows it (decision 305): one view per
 * technique in the manifest, and for each stored design the code the board's
 * player plays, compiled under the house motion preamble exactly as a stored
 * graphic is, with the exemplar's own sample narration and, for a chart, its
 * sample data. The designs ship with the build, so the views are built once
 * per server instance, unless the compiler itself could not run (esbuild
 * missing on the host): that view says so, and the next call builds again.
 */

export interface ExemplarView {
  technique: Technique
  description: string
  /** The stored design's title; absent while the technique has no design. */
  title?: string
  template: { name: string; repository: string; url: string; licence: 'MIT' }
  /** What the player plays; absent while the technique has no design or it did not compile. */
  code?: GraphicCode
  /** A chart's sample `props.data`. */
  data?: GraphicCodePayload['data']
  /**
   * Why a stored design cannot be played: a compile failure the corpus test
   * would also catch, or the compiler failing to run on this host.
   */
  issue?: string
}

/** The opening of an issue that is the host's fault, not the design's; a build holding one is not kept. */
const HOST_ISSUE = 'the compiler could not run on this host'

const REPOSITORIES: Record<ExemplarEntry['source']['repo'], string> = {
  rendercomp: 'RenderComp/free-remotion-templates',
  rve: 'reactvideoeditor/remotion-templates',
}

function templateOf(entry: ExemplarEntry): ExemplarView['template'] {
  const repository = REPOSITORIES[entry.source.repo]
  const file = entry.source.path.split('/').pop() ?? entry.source.path
  return {
    name: file.replace(/\.tsx?$/, ''),
    repository,
    url: `https://github.com/${repository}/blob/${entry.source.commit}/${entry.source.path}`,
    licence: 'MIT',
  }
}

function viewOf(entry: ExemplarEntry): ExemplarView {
  const view: ExemplarView = {
    technique: entry.technique,
    description: entry.description,
    template: templateOf(entry),
    ...(entry.slot.data ? { data: entry.slot.data } : {}),
  }
  const design = DESIGNS[entry.technique]
  if (!design) return view
  let compiled: ReturnType<typeof compileGraphicSource>
  try {
    compiled = compileGraphicSource(design.source)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...view, title: design.title, issue: `${HOST_ISSUE}: ${message}` }
  }
  if (!compiled.ok) return { ...view, title: design.title, issue: compiled.issue }
  return {
    ...view,
    title: design.title,
    code: {
      version: GRAPHIC_CODE_VERSION,
      source: design.source,
      compiled: `${MOTION_PREAMBLE}\n${compiled.compiled}`,
      title: design.title,
      // The player never reads facts; the corpus test checks them.
      facts: [],
      words: entry.slot.words.map((word) => ({ text: word.text, atMs: word.atMs })),
      durationMs: entry.slot.durationMs,
      motion: MOTION_VERSION,
    },
  }
}

let built: ExemplarView[] | undefined

export function exemplarViews(): ExemplarView[] {
  if (built) return built
  const views = MANIFEST.map(viewOf)
  // A host failure is not cached: once the compiler runs again, the views are whole.
  if (!views.some((view) => view.issue?.startsWith(HOST_ISSUE))) built = views
  return views
}
