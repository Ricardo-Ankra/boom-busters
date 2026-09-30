import path from 'node:path'

/**
 * The before and after page (decision 285, spec 10.1): each run's stills in
 * a column, each with its sentence, its prompt and the five faults to tick.
 * The tally at the top counts ticks per still for each column, which is the
 * number the owner reports. Static HTML beside the after run; nothing is
 * stored anywhere.
 */
export const FAULTS = [
  'Extra furniture',
  'Screen facing wrong',
  'Stray props',
  'Room mirrored',
  'Likeness off',
] as const

export interface PlanRunStill {
  index: number
  coversText: string
  set?: string
  shotSize?: string
  file?: string
  prompt: string
  error?: string
}

export interface PlanRunRecord {
  label: string
  project: string
  chapter: number
  createdAt: string
  plannerModel: string
  stills: PlanRunStill[]
  skipped: number
  budget: { capUsd: number; totalUsd: number }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function column(run: PlanRunRecord, imageBase: string, key: string): string {
  const cards = run.stills
    .map((still) => {
      const image = still.file
        ? `<img src="${escapeHtml(path.posix.join(imageBase, still.file))}" alt="">`
        : `<p class="error">No image: ${escapeHtml(still.error ?? 'not generated')}</p>`
      const boxes = FAULTS.map(
        (fault) =>
          `<label><input type="checkbox" data-column="${key}"> ${escapeHtml(fault)}</label>`,
      ).join('')
      return (
        `<article><p class="sentence">${escapeHtml(still.coversText)}</p>` +
        `<p class="meta">${escapeHtml([still.shotSize, still.set].filter(Boolean).join(' · '))}</p>` +
        `${image}<fieldset>${boxes}</fieldset>` +
        `<details><summary>Prompt sent</summary><pre>${escapeHtml(still.prompt)}</pre></details></article>`
      )
    })
    .join('')
  return (
    `<section><h2>${escapeHtml(run.label)} <span data-tally="${key}"></span></h2>` +
    `<p class="meta">${run.stills.length} stills, $${run.budget.totalUsd.toFixed(2)} spent</p>${cards}</section>`
  )
}

export function compareHtml(
  before: PlanRunRecord,
  after: PlanRunRecord,
  beforeDir: string,
  afterDir: string,
): string {
  const beforeBase = path.posix.relative(
    afterDir.replace(/\\/g, '/'),
    beforeDir.replace(/\\/g, '/'),
  )
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Before and after</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:dark;--bg:#0a0a0b;--fg:#f4f4f5;--muted:#a1a1aa;--line:#27272a}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
article{border:1px solid var(--line);border-radius:8px;padding:12px;margin:0 0 12px}
img{width:100%;border-radius:4px}
.sentence{font-weight:600}.meta{color:var(--muted)}.error{color:#ef4444}
fieldset{border:0;padding:8px 0;display:flex;flex-wrap:wrap;gap:8px 16px}
pre{white-space:pre-wrap;font-size:12px;color:var(--muted)}
</style></head><body>
<h1>Before and after, chapter ${before.chapter}</h1>
<p class="meta">Tick every fault you see. The number beside each run is faults per still.</p>
<main>${column(before, beforeBase, 'before')}${column(after, '', 'after')}</main>
<script>
const stills = { before: ${before.stills.length}, after: ${after.stills.length} };
function tally() {
  for (const key of Object.keys(stills)) {
    const ticked = document.querySelectorAll('input[data-column="' + key + '"]:checked').length;
    const per = stills[key] ? (ticked / stills[key]).toFixed(2) : '0';
    document.querySelector('[data-tally="' + key + '"]').textContent = '(' + ticked + ' faults, ' + per + ' per still)';
  }
}
document.addEventListener('change', tally); tally();
</script></body></html>`
}
