import 'server-only'

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * The LOCAL render path (build spec section 13): in mock-provider mode the
 * render-runner spawns `packages/compositions/scripts/render-timeline.ts`
 * on this machine instead of invoking the broker — a real `renderMedia`,
 * real bundle, real Chrome, no AWS.
 *
 * What it renders is the 20-SECOND FIXTURE, not the project's timeline, and
 * that is deliberate: the project's mock narration lives behind the app's
 * authenticated voice-audio route, which the renderer's headless Chrome has
 * no session for. The fixture is self-contained (data-URI media), so what
 * this path proves is the whole render pipeline — bundling, composition,
 * encoding, progress, QC hand-off — which is exactly what spec section 13
 * asks CI to prove ("local renderMedia of a 20-second fixture instead of
 * Lambda"). Live renders always carry the real timeline.
 */

/** Where local masters land. The file route serves them from here. */
export function localRenderDir(): string {
  return process.env['RENDER_LOCAL_DIR'] ?? path.join(process.cwd(), '.local-renders')
}

export function localRenderKey(renderId: string): string {
  return `local://${renderId}.mp4`
}

/** Resolve a `local://` key to its file path, or null for anything else. */
export function localRenderPath(outputKey: string): string | null {
  const match = /^local:\/\/([A-Za-z0-9._-]+)$/.exec(outputKey)
  if (!match) return null
  return path.join(localRenderDir(), match[1]!)
}

/** The workspace root — where `pnpm --filter` can see the packages. */
function workspaceRoot(): string {
  let dir = process.cwd()
  for (let hops = 0; hops < 6; hops += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('pnpm-workspace.yaml not found above the web app — cannot spawn the renderer')
}

export async function renderFixtureLocally(input: {
  renderId: string
  onProgress?: (progress: number) => void | Promise<void>
}): Promise<{ outputKey: string }> {
  const dir = localRenderDir()
  mkdirSync(dir, { recursive: true })
  const outPath = path.join(dir, `${input.renderId}.mp4`)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'pnpm',
      [
        '--filter',
        '@boom-busters/compositions',
        'exec',
        'tsx',
        'scripts/render-timeline.ts',
        '--fixture',
        // shell mode joins arguments without quoting; the path may contain
        // spaces (this repo's own does).
        `"${outPath}"`,
      ],
      // shell: pnpm is `pnpm.cmd` on Windows and spawn will not resolve it
      // without one. Arguments contain no user input.
      { cwd: workspaceRoot(), shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )

    let stderr = ''
    let failure: string | null = null
    let pending = ''

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString()
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        let event: { event?: string; progress?: number; message?: string }
        try {
          event = JSON.parse(line) as typeof event
        } catch {
          continue // renderer noise, not ours
        }
        if (event.event === 'progress' && typeof event.progress === 'number') {
          void input.onProgress?.(event.progress)
        }
        if (event.event === 'failed') failure = event.message ?? 'render failed'
      }
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 && failure === null) resolve()
      else reject(new Error(failure ?? `renderer exited ${code}: ${stderr.slice(-2000)}`))
    })
  })

  return { outputKey: localRenderKey(input.renderId) }
}
