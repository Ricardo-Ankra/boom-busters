'use client'

import type { ChapterWithWarnings } from '@boom-busters/db'
import type { ShortsCandidate } from '@boom-busters/schemas'
import { AlertTriangle, Check, Sparkles, X } from 'lucide-react'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import {
  applyHunks,
  diffChapters,
  formatDuration,
  hedgeSentence,
  placeWarnings,
  replaceSentence,
  runtimeDelta,
} from '@/lib/script-editing'
import type { ScriptDiff } from '@/lib/script-editing'
import { applyRegeneratedText, regenerateSection, saveChapterText } from './actions'

/**
 * Script Studio (build spec section 11.3): outline · editor · context panel.
 *
 * The editor is markdown-backed and paragraph-structured, which is the whole
 * of the structure narration has — the drafting prompt forbids headings,
 * bullets and stage directions, because this text is read aloud exactly as
 * written.
 *
 * Two behaviours here are load-bearing rather than cosmetic:
 *
 *  - **Autosave records what it replaced.** Every save goes through
 *    `script_edits`, which spec section 5 calls the human-curation evidence
 *    trail. A save that changed nothing is not recorded, so the trail stays
 *    readable.
 *  - **Regenerate never writes.** It returns a proposal; the human accepts or
 *    rejects each hunk, and only that decision is saved. A regenerate cannot
 *    quietly replace a paragraph somebody wrote.
 */

const AUTOSAVE_MS = 500

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export function ScriptStudio({
  projectId,
  chapters,
  targetRuntimeMin,
  shorts,
  usedFallbackModel,
}: {
  projectId: string
  chapters: ChapterWithWarnings[]
  targetRuntimeMin: number
  shorts: ShortsCandidate[]
  usedFallbackModel: boolean
}) {
  const [activeIndex, setActiveIndex] = React.useState(0)
  const active = chapters[activeIndex]

  const { totalSec, targetSec, deltaSec } = runtimeDelta(chapters, targetRuntimeMin)

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--color-border)] p-3">
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <span>
            <span className="text-[var(--color-text-secondary)]">Runtime </span>
            <span className="font-mono">{formatDuration(totalSec)}</span>
            <span className="text-[var(--color-text-muted)]"> / {formatDuration(targetSec)}</span>
          </span>
          <span
            className={
              Math.abs(deltaSec) > 120
                ? 'text-[var(--color-warning)]'
                : 'text-[var(--color-text-muted)]'
            }
          >
            {deltaSec === 0
              ? 'on target'
              : `${formatDuration(deltaSec)} ${deltaSec > 0 ? 'over' : 'under'}`}
          </span>
          <span className="text-[var(--color-text-secondary)]">
            {chapters.reduce(
              (total, chapter) =>
                total + chapter.contentMd.trim().split(/\s+/).filter(Boolean).length,
              0,
            )}{' '}
            words
          </span>
        </div>

        {usedFallbackModel ? (
          <span className="rounded-[4px] bg-[var(--color-warning)]/15 px-2 py-1 text-[12px] text-[var(--color-warning)]">
            Written with a fallback model
          </span>
        ) : null}
      </header>

      <div className="grid gap-3 lg:grid-cols-[200px_1fr_280px]">
        <ChapterList chapters={chapters} activeIndex={activeIndex} onSelect={setActiveIndex} />

        {active ? (
          <ChapterEditor key={active.id} projectId={projectId} chapter={active} />
        ) : (
          <Card>
            <CardContent className="py-16 text-center text-[13px] text-[var(--color-text-muted)]">
              This script has no chapters.
            </CardContent>
          </Card>
        )}

        {active ? (
          <ContextPanel
            projectId={projectId}
            chapter={active}
            shorts={shorts.filter((candidate) => candidate.chapterIndex === active.index)}
          />
        ) : null}
      </div>
    </div>
  )
}

function ChapterList({
  chapters,
  activeIndex,
  onSelect,
}: {
  chapters: ChapterWithWarnings[]
  activeIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Outline</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 p-2">
        {chapters.map((chapter, index) => (
          <button
            key={chapter.id}
            type="button"
            onClick={() => onSelect(index)}
            aria-current={index === activeIndex}
            className={`flex min-h-[40px] flex-col items-start gap-0.5 rounded-[6px] p-2 text-left text-[13px] ${
              index === activeIndex
                ? 'bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]'
            }`}
          >
            <span className="font-medium">{chapter.title}</span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {formatDuration(chapter.estRuntimeSec)}
              {chapter.warnings.length > 0 ? ` · ${chapter.warnings.length} warnings` : ''}
            </span>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

function ChapterEditor({
  projectId,
  chapter,
}: {
  projectId: string
  chapter: ChapterWithWarnings
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [text, setText] = React.useState(chapter.contentMd)
  const [state, setState] = React.useState<SaveState>('idle')
  const [selection, setSelection] = React.useState('')
  const [proposal, setProposal] = React.useState<{ diff: ScriptDiff; note: string } | null>(null)
  // Autosave on a debounce. The timer is cleared on unmount and on every
  // keystroke, so switching chapters mid-edit does not fire a save against the
  // chapter you just left.
  React.useEffect(() => {
    if (state !== 'dirty') return

    const timer = window.setTimeout(async () => {
      setState('saving')
      const result = await saveChapterText(projectId, chapter.id, text)
      setState(result.ok ? 'saved' : 'error')
      if (!result.ok) {
        toast({ title: 'That did not save', description: result.error, variant: 'error' })
      }
    }, AUTOSAVE_MS)

    return () => window.clearTimeout(timer)
  }, [state, text, projectId, chapter.id, toast])

  const placed = React.useMemo(
    () => placeWarnings(text, chapter.warnings),
    [text, chapter.warnings],
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{chapter.title}</CardTitle>
        <SavedState state={state} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {selection.trim().length >= 20 && !proposal ? (
          <RegenerateBar
            projectId={projectId}
            chapterId={chapter.id}
            selection={selection}
            onProposal={(newText, note) => {
              setProposal({
                diff: diffChapters(text, replaceSelection(text, selection, newText)),
                note,
              })
            }}
            onCancel={() => setSelection('')}
          />
        ) : null}

        {proposal ? (
          <DiffView
            diff={proposal.diff}
            onApply={async (accepted) => {
              const next = applyHunks(proposal.diff, accepted)
              const result = await applyRegeneratedText(projectId, chapter.id, next, proposal.note)
              if (result.ok) {
                setText(next)
                setProposal(null)
                setSelection('')
                setState('saved')
                router.refresh()
              } else {
                toast({ title: 'That did not save', description: result.error, variant: 'error' })
              }
            }}
            onDiscard={() => setProposal(null)}
          />
        ) : (
          <ProseEditor
            label={`${chapter.title} narration`}
            value={text}
            warnedSentences={placed.filter((w) => w.start >= 0).map((w) => w.sentence)}
            onChange={(next) => {
              setText(next)
              setState('dirty')
            }}
            onSelectionChange={setSelection}
          />
        )}

        {placed.length > 0 ? (
          <GutterWarnings
            warnings={placed}
            onFix={(sentence) => {
              const next = replaceSentence(text, sentence, hedgeSentence(sentence))
              setText(next)
              setState('dirty')
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Splice the regenerated passage back where the selection was. */
function replaceSelection(text: string, selection: string, replacement: string): string {
  const at = text.indexOf(selection)
  if (at < 0) return text
  return text.slice(0, at) + replacement + text.slice(at + selection.length)
}

/**
 * The editor itself: TipTap over a paragraph-only document.
 *
 * Paragraphs are the whole of narration's structure — the drafting prompt
 * forbids headings, bullets and stage directions, because this text is read
 * aloud exactly as written. So the markdown backing is simply paragraphs
 * separated by blank lines, and the round trip is lossless without a markdown
 * parser in the middle inventing structure the narrator would have to ignore.
 *
 * Sentences the self-check warned about are highlighted in place, so the
 * marker is where the problem is rather than only in a list beside it.
 */
function ProseEditor({
  label,
  value,
  warnedSentences,
  onChange,
  onSelectionChange,
}: {
  label: string
  value: string
  warnedSentences: string[]
  onChange: (text: string) => void
  onSelectionChange: (selection: string) => void
}) {
  const editor = useEditor({
    // Rendered on the client only: ProseMirror needs a DOM, and letting it
    // render on the server produces a hydration mismatch on every load.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, bulletList: false, orderedList: false }),
      WarningHighlight.configure({ sentences: warnedSentences }),
    ],
    content: toDoc(value),
    editorProps: {
      attributes: {
        'aria-label': label,
        class:
          'min-h-[420px] w-full rounded-[8px] border border-[var(--color-border-strong)] ' +
          'bg-[var(--color-background)] p-3 text-[15px] leading-relaxed ' +
          'text-[var(--color-text-primary)] focus-visible:outline-2 ' +
          'focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange(instance.getText({ blockSeparator: '\n\n' }))
    },
    onSelectionUpdate: ({ editor: instance }) => {
      const { from, to } = instance.state.selection
      onSelectionChange(from === to ? '' : instance.state.doc.textBetween(from, to, ' '))
    },
  })

  // Keep the highlight in step with the warnings as the text changes.
  React.useEffect(() => {
    editor?.view.dispatch(editor.state.tr.setMeta('warnedSentences', warnedSentences))
  }, [editor, warnedSentences])

  return <EditorContent editor={editor} />
}

/** Paragraphs in, ProseMirror JSON out. Blank lines separate paragraphs. */
function toDoc(text: string) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim() !== '')

  return {
    type: 'doc',
    content:
      paragraphs.length > 0
        ? paragraphs.map((paragraph) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: paragraph.replace(/\n/g, ' ') }],
          }))
        : [{ type: 'paragraph' }],
  }
}

/**
 * Amber underline on every sentence the self-check warned about.
 *
 * A ProseMirror decoration rather than a wrapper element, so the highlight is
 * presentation only and never becomes part of the document — the text that
 * reaches the voice stage must be exactly what the human sees, with no markup
 * smuggled in by the review UI.
 */
const WarningHighlight = Extension.create<{ sentences: string[] }>({
  name: 'warningHighlight',

  addOptions() {
    return { sentences: [] }
  },

  addProseMirrorPlugins() {
    const key = new PluginKey('warningHighlight')
    let sentences = this.options.sentences

    return [
      new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const updated = tr.getMeta('warnedSentences') as string[] | undefined
            if (updated) sentences = updated
            if (!updated && !tr.docChanged) return old

            const decorations: Decoration[] = []
            tr.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              for (const sentence of sentences) {
                let at = node.text.indexOf(sentence)
                while (at >= 0) {
                  decorations.push(
                    Decoration.inline(pos + at, pos + at + sentence.length, {
                      class: 'underline decoration-wavy decoration-[var(--color-warning)]',
                    }),
                  )
                  at = node.text.indexOf(sentence, at + sentence.length)
                }
              }
            })

            return DecorationSet.create(tr.doc, decorations)
          },
        },
        props: {
          decorations(state) {
            return key.getState(state) as DecorationSet
          },
        },
      }),
    ]
  },
})

function SavedState({ state }: { state: SaveState }) {
  const label: Record<SaveState, string> = {
    idle: '',
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Not saved',
  }

  if (!label[state]) return null

  return (
    <span
      aria-live="polite"
      className={`text-[12px] ${
        state === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'
      }`}
    >
      {label[state]}
    </span>
  )
}

function GutterWarnings({
  warnings,
  onFix,
}: {
  warnings: ReturnType<typeof placeWarnings>
  onFix: (sentence: string) => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-warning)]/40 p-2">
      <p className="text-[13px] font-medium text-[var(--color-warning)]">
        <AlertTriangle aria-hidden className="mr-1 inline size-4" />
        {warnings.length} self-check warning(s)
      </p>
      {warnings.map((warning, index) => (
        <div key={`${warning.sentence}-${index}`} className="flex flex-col gap-1 text-[13px]">
          <p className="text-[var(--color-text-secondary)]">
            <span className="font-mono text-[12px]">{warning.kind}</span> — {warning.message}
          </p>
          <p
            className={
              warning.start < 0
                ? 'text-[var(--color-text-muted)] line-through'
                : 'text-[var(--color-text-primary)]'
            }
          >
            “{warning.sentence}”
          </p>
          {warning.start < 0 ? (
            // Reported rather than dropped: a warning that disappears when you
            // edit near it teaches you to edit near it.
            <p className="text-[12px] text-[var(--color-text-muted)]">
              This sentence is no longer in the chapter.
            </p>
          ) : warning.kind === 'missing-alleged' ? (
            <div>
              <Button variant="outline" onClick={() => onFix(warning.sentence)}>
                Insert “Reportedly”
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function RegenerateBar({
  projectId,
  chapterId,
  selection,
  onProposal,
  onCancel,
}: {
  projectId: string
  chapterId: string
  selection: string
  onProposal: (text: string, note: string) => void
  onCancel: () => void
}) {
  const { toast } = useToast()
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-accent)]/40 p-2">
      <span className="text-[13px] text-[var(--color-text-secondary)]">
        {selection.trim().split(/\s+/).length} words selected
      </span>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What should change?"
        aria-label="Regenerate instruction"
        className="min-h-[40px] flex-1 rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2 text-[14px]"
      />
      <Button
        variant="primary"
        busy={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const result = await regenerateSection(projectId, chapterId, selection, note)
            if (result.ok && result.proposal) {
              onProposal(result.proposal, note)
            } else {
              toast({ title: 'That did not work', description: result.error, variant: 'error' })
            }
          } finally {
            setBusy(false)
          }
        }}
      >
        <Sparkles aria-hidden />
        Regenerate…
      </Button>
      <Button variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </div>
  )
}

function DiffView({
  diff,
  onApply,
  onDiscard,
}: {
  diff: ScriptDiff
  onApply: (accepted: Set<number>) => void
  onDiscard: () => void
}) {
  // Nothing is accepted until it is clicked. The default has to be "keep what
  // the human wrote", not "take what the model produced".
  const [accepted, setAccepted] = React.useState<Set<number>>(new Set())

  const toggle = (id: number) =>
    setAccepted((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[50vh] overflow-auto rounded-[8px] border border-[var(--color-border)] p-3 text-[15px] leading-relaxed">
        {diff.parts.map((part, index) => {
          if (part.kind === 'same') {
            return <span key={index}>{part.sentences.join(' ')} </span>
          }

          const on = part.hunkId !== undefined && accepted.has(part.hunkId)
          const isRemoval = part.kind === 'removed'
          const shown = isRemoval ? on : !on

          return (
            <span
              key={index}
              className={`${
                isRemoval
                  ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]'
                  : 'bg-[var(--color-success)]/15 text-[var(--color-success)]'
              } ${shown ? 'line-through opacity-60' : ''}`}
            >
              {part.sentences.join(' ')}{' '}
            </span>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {diff.hunks.map((hunk) => (
          <Button
            key={hunk.id}
            variant={accepted.has(hunk.id) ? 'primary' : 'outline'}
            aria-pressed={accepted.has(hunk.id)}
            onClick={() => toggle(hunk.id)}
          >
            {accepted.has(hunk.id) ? <Check aria-hidden /> : <X aria-hidden />}
            Change {hunk.id + 1}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onApply(accepted)}>
          Apply {accepted.size} of {diff.hunks.length}
        </Button>
        <Button variant="ghost" onClick={onDiscard}>
          Discard the proposal
        </Button>
      </div>
    </div>
  )
}

function ContextPanel({
  chapter,
  shorts,
}: {
  projectId: string
  chapter: ChapterWithWarnings
  shorts: ShortsCandidate[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Context</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-[13px]">
        <div>
          <p className="font-medium">Warnings</p>
          <p className="text-[var(--color-text-muted)]">
            {chapter.warnings.length === 0
              ? 'The self-check found nothing in this chapter.'
              : `${chapter.warnings.length} in this chapter.`}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-medium">Shorts candidates</p>
          {shorts.length === 0 ? (
            <p className="text-[var(--color-text-muted)]">None marked in this chapter.</p>
          ) : (
            shorts.map((candidate, index) => (
              <div key={index} className="rounded-[6px] border border-[var(--color-border)] p-2">
                <p className="text-[var(--color-text-secondary)]">{candidate.hookRationale}</p>
                <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                  “{candidate.startSentence}” … “{candidate.endSentence}”
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
