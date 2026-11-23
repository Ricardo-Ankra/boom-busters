'use client'

import * as React from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAction } from './project-controls'

/**
 * Rewrite with AI (decision 478): the Short studios' way to have the writer
 * redo one paragraph or the whole script on a note, as the script screen's
 * "Rewrite this passage…" does for the long form. The writer answers with a
 * proposal shown beside the stored words; nothing is saved until the owner
 * presses "Use this rewrite", which saves it as an edit would. Re-voice then
 * buys only the paragraphs whose words changed.
 *
 * It works on the STORED script, so it is held while the editor has unsaved
 * edits: a proposal built from the stored words would silently drop them.
 */

const NOTE_MAX = 500

const AREA_CLASS =
  'rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]'

type Rewritten<P> = { ok: true; paragraphs: P[] } | { ok: false; error: string }

export function ShortRewrite<P extends { text: string }>({
  current,
  targets,
  labelOf,
  live,
  held,
  rewrite,
  accept,
}: {
  /** The stored paragraphs, in order. */
  current: readonly P[]
  /** One label per stored paragraph, for its button ("Hook", "Beat 2"). */
  targets: readonly string[]
  /** A proposal paragraph's label: a whole rewrite may divide the script differently. */
  labelOf: (paragraph: P, index: number, all: readonly P[]) => string
  live: boolean
  /** Why rewriting is held (unsaved edits, work running), or null when it is open. */
  held: string | null
  rewrite: (note: string, target: number | null) => Promise<Rewritten<P>>
  accept: (paragraphs: P[]) => Promise<{ ok: boolean; error?: string }>
}) {
  const { act, busy, pressed } = useAction()
  const [note, setNote] = React.useState('')
  const [target, setTarget] = React.useState<number | null>(null)
  const [proposal, setProposal] = React.useState<P[] | null>(null)

  const sameShape = proposal !== null && proposal.length === current.length
  const changed = proposal?.filter((paragraph, index) => paragraph.text !== current[index]?.text)

  return (
    <section
      aria-label="Rewrite with AI"
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
    >
      <h4 className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Sparkles aria-hidden className="h-4 w-4" />
        Rewrite with AI
      </h4>
      <p className="text-[12px] text-[var(--color-text-muted)]">
        Tell the writer what to change. It answers with a proposal from the same chapters and rules;
        nothing is saved until you use it.{' '}
        {live ? 'One writer call, a few cents.' : 'Mock mode: no provider is called.'}
      </p>

      <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
        Your note (optional)
        <textarea
          value={note}
          rows={2}
          maxLength={NOTE_MAX}
          placeholder="For example: open on the number, cut the jargon, end on a sharper question"
          onChange={(event) => setNote(event.target.value)}
          className={AREA_CLASS}
        />
      </label>

      <div role="group" aria-label="What to rewrite" className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[var(--color-text-secondary)]">Rewrite</span>
        {[null, ...targets.map((_, index) => index)].map((value) => {
          const label = value === null ? 'Whole script' : targets[value]!
          return (
            <Button
              key={value ?? 'whole'}
              variant={target === value ? 'primary' : 'outline'}
              aria-pressed={target === value}
              onClick={() => setTarget(value)}
            >
              {label}
            </Button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          busy={pressed === 'rewrite'}
          disabled={busy || held !== null}
          onClick={() =>
            void act(
              async () => {
                const result = await rewrite(note.trim(), target)
                if (result.ok) setProposal(result.paragraphs)
                return result
              },
              'The rewrite is ready to review',
              'rewrite',
            )
          }
        >
          <Sparkles aria-hidden className="h-4 w-4" />
          {live ? 'Rewrite with AI' : 'Rewrite with AI (mock)'}
        </Button>
        {held ? <p className="text-[12px] text-[var(--color-text-muted)]">{held}</p> : null}
      </div>

      {proposal ? (
        <div
          aria-label="Rewrite proposal"
          className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-accent)] p-3"
        >
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            {sameShape
              ? changed && changed.length > 0
                ? `${changed.length} of ${current.length} ${current.length === 1 ? 'paragraph' : 'paragraphs'} changed. Not saved yet.`
                : 'The writer kept the words as they were.'
              : `The rewrite divides the script into ${proposal.length} paragraphs (it was ${current.length}). Not saved yet.`}
          </p>
          {proposal.map((paragraph, index) => {
            const was = sameShape ? current[index]?.text : undefined
            const same = was === paragraph.text
            return (
              <div key={index} className="flex flex-col gap-1 text-[13px]">
                <span className="text-[12px] font-semibold text-[var(--color-text-secondary)]">
                  {labelOf(paragraph, index, proposal)}
                  {same ? ' · unchanged' : ''}
                </span>
                {!same && was !== undefined ? (
                  <p className="text-[var(--color-text-muted)] line-through">{was}</p>
                ) : null}
                <p className={same ? 'text-[var(--color-text-muted)]' : ''}>{paragraph.text}</p>
              </div>
            )
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              busy={pressed === 'accept-rewrite'}
              disabled={busy || held !== null}
              onClick={() =>
                void act(
                  async () => {
                    const result = await accept(proposal)
                    if (result.ok) setProposal(null)
                    return result
                  },
                  'Rewrite saved. Re-voice to hear it.',
                  'accept-rewrite',
                )
              }
            >
              <Check aria-hidden className="h-4 w-4" />
              Use this rewrite
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setProposal(null)}>
              <X aria-hidden className="h-4 w-4" />
              Discard
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
