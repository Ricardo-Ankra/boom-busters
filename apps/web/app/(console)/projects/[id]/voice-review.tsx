'use client'

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Flag,
  History,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Timer,
  Undo2,
} from 'lucide-react'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { EXPRESSION_TAGS, PAUSE_TAGS } from '@boom-busters/schemas'
import { cn } from '@/lib/cn'
import type { ChapterGroup, ParagraphRow, TakeView, VoiceReviewModel } from '@/lib/voice-review'
import {
  clearVoiceFlag,
  flagVoiceTake,
  regenerateChangedParagraphs,
  rereadParagraph,
  retakeVoiceTake,
} from './voice-actions'

/**
 * Voice review (build spec section 11.3).
 *
 * The screen is built around one activity: listening to fifteen minutes of
 * narration and stopping when something is wrong. Everything follows from that.
 *
 *  - **"Listen through" runs on across rows; a row's Play does not.** The top
 *    button is the sixty-row review and rolls to the next paragraph on its
 *    own. A row's Play is a spot check — you pressed it to hear that one take,
 *    and it ends where the paragraph does.
 *  - **The playing row scrolls itself into view**, so the controls you need are
 *    under the cursor at the moment you hear the problem rather than somewhere
 *    you have to hunt for while the next paragraph plays over your search.
 *  - **Independent repairs, in any order.** `Fix the words` rewrites the
 *    paragraph and re-reads it — and on Eleven v3 it is also where direction
 *    goes: audio tags, pause tags and respellings live in the text, and the
 *    form offers them as buttons. `Another take` re-performs the same words;
 *    this narrator samples, so a second reading genuinely differs.
 *    `Regenerate` appears on a stale row and re-buys it at the current words
 *    and settings. `Flag` marks a problem to come back to and costs nothing.
 *
 *    None of them is behind another. Flagging holds the gate shut, but so does
 *    a re-read in flight — a pending take blocks approval by itself — so
 *    requiring a flag before a fix was ceremony, not safety.
 *
 * Space toggles play/pause, which is one of the two keyboard behaviours section
 * 11.1 keeps ("the universal ones users expect from media and text"). Every
 * action here also has a visible, labelled button.
 */

const SPEEDS = [1, 1.25, 1.5] as const

const STATUS_LABELS: Record<TakeView['status'], string> = {
  pending: 'Not yet synthesised',
  generated: 'Generated',
  flagged: 'Flagged for a retake',
  approved: 'Approved',
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function paragraphKey(row: { chapterId: string; paragraphIndex: number }): string {
  return `${row.chapterId}:${row.paragraphIndex}`
}

// ---------------------------------------------------------------------------
// Waveform
// ---------------------------------------------------------------------------

/**
 * The peaks the runner computed, drawn as bars.
 *
 * Deliberately not decoded in the browser: pulling a megabyte of WAV per row to
 * draw a 200-pixel strip would make the screen wait on sixty downloads before
 * it could render anything at all.
 *
 * `aria-hidden` because it is decoration — the duration and status beside it
 * carry the same information in text, per section 11.1's rule that state is
 * never conveyed by a picture alone.
 */
function Waveform({ peaks, playing }: { peaks: number[]; playing: boolean }) {
  if (peaks.length === 0) {
    return <div className="h-8 flex-1 rounded-[4px] bg-[var(--color-surface-raised)]" aria-hidden />
  }

  const width = peaks.length
  const stroke = playing ? 'var(--color-accent)' : 'var(--color-text-muted)'

  return (
    <svg
      viewBox={`0 0 ${width} 100`}
      preserveAspectRatio="none"
      className="h-8 flex-1"
      aria-hidden
      focusable="false"
    >
      {peaks.map((peak, index) => (
        <rect
          key={index}
          x={index}
          // Centred, and floored at 2 so silence draws a line rather than
          // nothing — a gap in the strip should mean "no data", not "quiet".
          y={50 - Math.max(2, peak) / 2}
          width={0.8}
          height={Math.max(2, peak)}
          fill={stroke}
        />
      ))}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

function CoverageBar({ model }: { model: VoiceReviewModel }) {
  const { coverage, expectedParagraphs } = model
  const missing = Math.max(0, expectedParagraphs - coverage.paragraphs)

  const segments = [
    { key: 'approved', count: coverage.approved, color: 'var(--color-success)', label: 'approved' },
    {
      key: 'generated',
      count: coverage.generated,
      color: 'var(--color-accent)',
      label: 'generated',
    },
    { key: 'flagged', count: coverage.flagged, color: 'var(--color-danger)', label: 'flagged' },
    { key: 'pending', count: coverage.pending, color: 'var(--color-warning)', label: 'in flight' },
    { key: 'missing', count: missing, color: 'var(--color-border)', label: 'no audio' },
  ].filter((segment) => segment.count > 0)

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-raised)]"
        role="img"
        aria-label={segments.map((s) => `${s.count} ${s.label}`).join(', ') || 'No narration yet'}
      >
        {segments.map((segment) => (
          <div
            key={segment.key}
            style={{
              width: `${(segment.count / Math.max(1, expectedParagraphs)) * 100}%`,
              background: segment.color,
            }}
          />
        ))}
      </div>
      {/* The same counts in words, because a bar is not readable state. */}
      <p className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        {expectedParagraphs} paragraphs ·{' '}
        {segments.map((segment) => `${segment.count} ${segment.label}`).join(' · ') ||
          'none narrated'}{' '}
        {/* Not a coverage status — a generated take can be stale — so it is
            appended here rather than drawn as a bar segment. */}
        {model.staleParagraphs > 0 ? `· ${model.staleParagraphs} changed since read ` : ''}·{' '}
        {formatDuration(model.totalDurationMs)} total
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The flag form
// ---------------------------------------------------------------------------

function FlagForm({
  takeId,
  onDone,
  onCancel,
}: {
  takeId: string
  onDone: () => void
  onCancel: () => void
}) {
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const { toast } = useToast()
  const router = useRouter()

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)

    const result = await flagVoiceTake(takeId, note)

    setBusy(false)
    if (!result.ok) {
      toast({ title: 'Not flagged', description: result.error, variant: 'error' })
      // Not dismissed: the note the user typed is still in the box.
      return
    }

    toast({
      title: 'Flagged',
      description: 'The stage cannot be approved until this is dealt with.',
    })
    onDone()
    router.refresh()
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 border-t border-[var(--color-border)] p-3"
    >
      <label className="text-[12px] font-medium" htmlFor={`note-${takeId}`}>
        What was wrong with it?
      </label>
      <textarea
        id={`note-${takeId}`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        autoFocus
        placeholder='Swallowed the word "insolvency"; read the date too fast.'
        className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      />
      <p className="text-[12px] text-[var(--color-text-muted)]">
        Costs nothing. Flagging holds the stage shut and records why; the fix is the next press.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || note.trim() === ''}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? 'Flagging…' : 'Flag this take'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Fixing the words
// ---------------------------------------------------------------------------

/**
 * The precise repair: change the words, read them again — and on Eleven v3,
 * "the words" includes the direction. Anything bracketed is a stage direction
 * the narrator acts on but never speaks: `[pause]`, `[whispers]`, `[sighs]`,
 * or free-form direction like `[grave, measured]`. The curated tags are
 * buttons; the free form is worth naming in the helper copy because it is
 * not guessable. Punctuation steers too: a full stop where a comma was, an
 * em dash, an ellipsis.
 *
 * The edit goes through the same `editChapter` the Script Studio uses, so it is
 * in the edit trail and reviewable as a diff.
 */
function RereadForm({
  takeId,
  text,
  onDone,
  onCancel,
}: {
  takeId: string
  text: string
  onDone: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = React.useState(text)
  const [busy, setBusy] = React.useState(false)
  const box = React.useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()
  const router = useRouter()

  /**
   * Drop a pause tag in at the cursor.
   *
   * Buttons rather than a syntax to remember, because the tags are the one
   * thing in a script that is not prose and nobody should have to recall
   * whether it is `[pause long]` or `[long pause]` while listening to a take.
   */
  function insert(tag: string): void {
    const element = box.current
    const at = element?.selectionStart ?? draft.length
    const before = draft.slice(0, at).replace(/\s+$/, '')
    const after = draft.slice(at).replace(/^\s+/, '')

    setDraft(`${before} ${tag} ${after}`.trim())
    element?.focus()
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)

    const result = await rereadParagraph(takeId, draft)

    setBusy(false)
    if (!result.ok) {
      toast({ title: 'Not re-read', description: result.error, variant: 'error' })
      return
    }

    toast({
      title: 'Re-reading it',
      description: 'The script is updated and the new take appears here when it lands.',
    })
    onDone()
    router.refresh()
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 border-t border-[var(--color-border)] p-3"
    >
      <label className="text-[12px] font-medium" htmlFor={`reread-${takeId}`}>
        The words, as they should be read
      </label>
      <textarea
        id={`reread-${takeId}`}
        ref={box}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={Math.min(14, Math.max(3, Math.ceil(text.length / 90)))}
        autoFocus
        className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[13px] leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[var(--color-text-muted)]">Insert a pause:</span>
        {PAUSE_TAGS.map((tag) => (
          <Button key={tag} type="button" variant="ghost" size="icon" onClick={() => insert(tag)}>
            <Timer className="size-4" aria-hidden />
            {tag.replace(/[[\]]/g, '')}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[var(--color-text-muted)]">Expression:</span>
        {EXPRESSION_TAGS.map((tag) => (
          <Button key={tag} type="button" variant="ghost" size="icon" onClick={() => insert(tag)}>
            <Sparkles className="size-4" aria-hidden />
            {tag.replace(/[[\]]/g, '')}
          </Button>
        ))}
      </div>

      <p className="text-[12px] text-[var(--color-text-muted)]">
        Anything in square brackets is a stage direction — acted on, never read aloud, and these
        buttons are not the whole vocabulary: write your own, like{' '}
        <span className="font-mono">[grave, measured]</span>. A tag is an intent, not a guarantee;
        punctuation steers too — a full stop where a comma was, an em dash, an ellipsis. To fix a
        mispronounced word, spell it the way it sounds. This edits the script and spends one
        synthesis of this paragraph.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={busy || draft.trim() === '' || draft.trim() === text.trim()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? 'Queueing…' : 'Save and re-read'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// A paragraph row
// ---------------------------------------------------------------------------

function StatusChip({ take }: { take: TakeView | undefined }) {
  if (!take) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)]">
        <CircleDashed className="size-3.5" aria-hidden /> No audio
      </span>
    )
  }

  const tone =
    take.status === 'flagged'
      ? 'text-[var(--color-danger)]'
      : take.status === 'approved'
        ? 'text-[var(--color-success)]'
        : take.status === 'pending'
          ? 'text-[var(--color-warning)]'
          : 'text-[var(--color-text-secondary)]'

  const Icon =
    take.status === 'flagged'
      ? AlertTriangle
      : take.status === 'approved'
        ? Check
        : take.status === 'pending'
          ? Loader2
          : Play

  return (
    <span className={cn('inline-flex items-center gap-1 text-[12px]', tone)}>
      <Icon className={cn('size-3.5', take.status === 'pending' && 'animate-spin')} aria-hidden />
      {STATUS_LABELS[take.status]}
    </span>
  )
}

function ParagraphRowView({
  row,
  playingTakeId,
  onPlay,
  onStop,
}: {
  row: ParagraphRow
  playingTakeId: string | null
  onPlay: (takeId: string) => void
  onStop: () => void
}) {
  const [flagging, setFlagging] = React.useState(false)
  const [rereading, setRereading] = React.useState(false)
  const [comparing, setComparing] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [retaking, setRetaking] = React.useState(false)
  const { toast } = useToast()
  const router = useRouter()

  const shown = comparing && row.previous ? row.previous : row.current
  const playing = shown !== undefined && shown.id === playingTakeId
  const ref = React.useRef<HTMLLIElement>(null)

  // The playing row comes to you, rather than you chasing it down the page.
  React.useEffect(() => {
    if (playing) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [playing])

  async function clearFlag(): Promise<void> {
    if (!row.current) return
    setClearing(true)
    const result = await clearVoiceFlag(row.current.id)
    setClearing(false)

    if (!result.ok) {
      toast({ title: 'Could not clear the flag', description: result.error, variant: 'error' })
      return
    }
    router.refresh()
  }

  /** One purchase, two labels: a stale row regenerates at the current words
      and settings; a fresh row simply rolls another performance. */
  async function retake(kind: 'regenerate' | 'another'): Promise<void> {
    if (!row.current) return
    setRetaking(true)
    const result = await retakeVoiceTake(row.current.id)
    setRetaking(false)

    if (!result.ok) {
      toast({ title: 'Not queued', description: result.error, variant: 'error' })
      return
    }
    toast(
      kind === 'regenerate'
        ? {
            title: 'Regenerating',
            description:
              'Re-reading with the current words, voice and settings. It lands on this row.',
          }
        : {
            title: 'Another take queued',
            description:
              'Same words, a fresh performance — this narrator varies between takes. To steer ' +
              'it, use Fix the words and add a tag.',
          },
    )
    router.refresh()
  }

  return (
    <li
      ref={ref}
      className={cn(
        'rounded-[8px] border',
        playing
          ? 'border-[var(--color-accent)] bg-[var(--color-surface-raised)]'
          : 'border-[var(--color-border)]',
      )}
    >
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start gap-3">
          <span className="mt-1 shrink-0 font-mono text-[12px] text-[var(--color-text-muted)]">
            ¶{row.paragraphIndex + 1}
          </span>
          <p className="min-w-0 flex-1 text-[14px] leading-relaxed">{row.text}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Waveform peaks={shown?.waveform ?? []} playing={playing} />

          <span className="shrink-0 font-mono text-[12px] text-[var(--color-text-secondary)]">
            {formatDuration(shown?.durationMs ?? null)}
          </span>
          <span className="shrink-0 font-mono text-[12px] text-[var(--color-text-muted)]">
            take {shown?.takeNumber ?? '—'}
            {row.takeCount > 1 ? ` of ${row.takeCount}` : ''}
          </span>
          <StatusChip take={shown} />
          {/* The flag's sibling: the same at-a-glance treatment for "this audio
              is of an older version". A flag says a human rejected the take; this
              says an edit or a settings change quietly outdated it — words, voice,
              stability or a pronunciation — and re-running the stage re-reads only
              the rows that carry it. */}
          {row.stale ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--color-warning)]">
              <History className="size-3.5" aria-hidden />
              Changed since read
            </span>
          ) : null}
        </div>

        {shown?.note ? (
          <p className="text-[12px] text-[var(--color-warning)]">Note: {shown.note}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => (playing ? onStop() : shown && onPlay(shown.id))}
            disabled={!shown?.hasAudio}
          >
            {playing ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            {playing ? 'Pause' : 'Play'}
          </Button>

          {/*
            The repair you reach for the moment you hear a problem, and it is
            not behind the flag.

            It was, briefly, and that was ceremony: two presses and a required
            note before you could change a word. The flag's job is to hold the
            gate shut, and a re-read already does that on its own — the new take
            is `pending`, and `voiceApprovalBlockedReason` refuses approval while
            anything is pending. So fixing, re-rolling and marking-for-later are
            three independent things you can do to a paragraph, in any order.
          */}
          <Button onClick={() => setRereading((open) => !open)} disabled={!row.current?.hasAudio}>
            <Pencil className="size-4" aria-hidden />
            Fix the words
          </Button>

          {/* The stale row's own repair: no walking to the top of the page to
              re-run the stage for one paragraph. On a fresh row the same
              purchase is offered as "Another take" — the narrator samples, so
              a second reading is a genuine second performance.

              A take with NO audio is the run's swallowed synthesis failure
              (decision 217): the runner leaves it pending and opens the gate
              with "N failed, flagged for you" — and until this branch existed
              every repair on the row gated on hasAudio, so the one paragraph
              that most needed a button had none. Same purchase, honest label. */}
          {row.current && !row.current.hasAudio ? (
            <Button onClick={() => void retake('regenerate')} disabled={retaking}>
              <RefreshCw className="size-4" aria-hidden />
              {retaking ? 'Queueing…' : 'Synthesise'}
            </Button>
          ) : row.stale ? (
            <Button
              onClick={() => void retake('regenerate')}
              disabled={retaking || !row.current?.hasAudio}
            >
              <RefreshCw className="size-4" aria-hidden />
              {retaking ? 'Queueing…' : 'Regenerate'}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => void retake('another')}
              disabled={retaking || !row.current?.hasAudio}
            >
              <RefreshCw className="size-4" aria-hidden />
              {retaking ? 'Queueing…' : 'Another take'}
            </Button>
          )}

          {row.current?.status === 'flagged' ? (
            <Button variant="outline" onClick={clearFlag} disabled={clearing}>
              <Undo2 className="size-4" aria-hidden />
              {clearing ? 'Clearing…' : 'Clear the flag'}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setFlagging((open) => !open)}
              disabled={!row.current?.hasAudio}
            >
              <Flag className="size-4" aria-hidden />
              {/* More explicit while this row is playing: marking a problem to
                  come back to should not need you to stop listening. */}
              {playing ? 'Flag for later' : 'Flag'}
            </Button>
          )}

          {row.previous ? (
            <Button variant="outline" onClick={() => setComparing((on) => !on)}>
              {comparing
                ? `Back to take ${row.current?.takeNumber ?? ''}`
                : `Compare with take ${row.previous.takeNumber}`}
            </Button>
          ) : null}
        </div>
      </div>

      {flagging && row.current ? (
        <FlagForm
          takeId={row.current.id}
          onDone={() => setFlagging(false)}
          onCancel={() => setFlagging(false)}
        />
      ) : null}

      {rereading && row.current ? (
        <RereadForm
          takeId={row.current.id}
          text={row.text}
          onDone={() => setRereading(false)}
          onCancel={() => setRereading(false)}
        />
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

function ChapterSection({
  chapter,
  open,
  onToggle,
  playingTakeId,
  onPlay,
  onStop,
}: {
  chapter: ChapterGroup
  open: boolean
  onToggle: () => void
  playingTakeId: string | null
  onPlay: (takeId: string) => void
  onStop: () => void
}) {
  const flagged = chapter.paragraphs.filter((p) => p.current?.status === 'flagged').length
  const missing = chapter.paragraphs.filter((p) => !p.current).length
  const stale = chapter.paragraphs.filter((p) => p.stale).length

  return (
    <section className="rounded-[8px] border border-[var(--color-border)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{chapter.title}</span>
        <span className="shrink-0 font-mono text-[12px] text-[var(--color-text-muted)]">
          {chapter.paragraphs.length} ¶
        </span>
        {flagged > 0 ? (
          <span className="shrink-0 text-[12px] text-[var(--color-danger)]">{flagged} flagged</span>
        ) : null}
        {missing > 0 ? (
          <span className="shrink-0 text-[12px] text-[var(--color-warning)]">
            {missing} without audio
          </span>
        ) : null}
        {stale > 0 ? (
          <span className="shrink-0 text-[12px] text-[var(--color-warning)]">{stale} changed</span>
        ) : null}
      </button>

      {open ? (
        <ul className="flex flex-col gap-2 p-3 pt-0">
          {chapter.paragraphs.map((row) => (
            <ParagraphRowView
              key={paragraphKey(row)}
              row={row}
              playingTakeId={playingTakeId}
              onPlay={onPlay}
              onStop={onStop}
            />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** The one-press repair for a settings change that touched many rows. */
function RegenerateAllButton({ projectId, count }: { projectId: string; count: number }) {
  const [busy, setBusy] = React.useState(false)
  const { toast } = useToast()
  const router = useRouter()

  return (
    <Button
      variant="outline"
      busy={busy}
      onClick={async () => {
        setBusy(true)
        const result = await regenerateChangedParagraphs(projectId)
        setBusy(false)
        if (!result.ok) {
          toast({ title: 'Not queued', description: result.error, variant: 'error' })
          return
        }
        toast({
          title: `Regenerating ${count} paragraphs`,
          description: 'Each re-reads with the current words, voice and settings.',
        })
        router.refresh()
      }}
    >
      <RefreshCw className="size-4" aria-hidden />
      {busy ? 'Queueing…' : `Regenerate all ${count} changed`}
    </Button>
  )
}

export function VoiceReview({ projectId, model }: { projectId: string; model: VoiceReviewModel }) {
  const audio = React.useRef<HTMLAudioElement>(null)
  const [playingTakeId, setPlayingTakeId] = React.useState<string | null>(null)
  /**
   * Whether playback rolls on to the next paragraph when this one ends.
   *
   * Only the top "Listen through" button turns it on. A row's own Play is a
   * spot check — you pressed it to hear *this* paragraph, and being carried
   * into the next one means hunting for Pause instead of listening.
   */
  const [listenThrough, setListenThrough] = React.useState(false)
  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>(1)
  const [openChapters, setOpenChapters] = React.useState<Set<string>>(
    // The first chapter open, the rest collapsed: a fifteen-minute script is
    // sixty rows, and opening all of them buries the coverage bar.
    () => new Set(model.chapters.slice(0, 1).map((chapter) => chapter.chapterId)),
  )

  /** Every take with audio, in the order it will be spoken. */
  const playable = React.useMemo(
    () =>
      model.chapters.flatMap((chapter) =>
        chapter.paragraphs
          .map((paragraph) => paragraph.current)
          .filter((take): take is TakeView => take !== undefined && take.hasAudio),
      ),
    [model],
  )

  React.useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed
  }, [speed, playingTakeId])

  function play(takeId: string): void {
    // The chapter has to be open for the row to scroll into view.
    const owner = model.chapters.find((chapter) =>
      chapter.paragraphs.some((paragraph) => paragraph.current?.id === takeId),
    )
    if (owner) setOpenChapters((open) => new Set(open).add(owner.chapterId))
    setPlayingTakeId(takeId)
  }

  /**
   * Stop *now*. Clearing the state alone only removes the `src` attribute,
   * which does not interrupt a playing element — Pause then appeared to wait
   * politely for the end of the paragraph, which is not what Pause means.
   */
  function stopPlayback(): void {
    audio.current?.pause()
    setPlayingTakeId(null)
  }

  /** A row's Play is a spot check of that paragraph, not a place to resume
      the full read-through from. */
  function playOne(takeId: string): void {
    setListenThrough(false)
    play(takeId)
  }

  /** Continuous listen-through: the next paragraph follows on its own. */
  function playNext(): void {
    const index = playable.findIndex((take) => take.id === playingTakeId)
    const next = index >= 0 ? playable[index + 1] : undefined
    if (next) play(next.id)
    else setPlayingTakeId(null)
  }

  React.useEffect(() => {
    const element = audio.current
    if (!element || !playingTakeId) return
    element.playbackRate = speed
    void element.play().catch(() => setPlayingTakeId(null))
  }, [playingTakeId, speed])

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Narration</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                if (playingTakeId) {
                  stopPlayback()
                } else if (playable[0]) {
                  // The one entry point to continuous playback.
                  setListenThrough(true)
                  play(playable[0].id)
                }
              }}
              disabled={playable.length === 0}
            >
              {playingTakeId ? (
                <Pause className="size-4" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              {playingTakeId ? 'Pause' : 'Listen through'}
            </Button>
            {/* Buttons rather than a select: section 11.1 wants every action
                visible, and there are only three speeds. */}
            <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
              {SPEEDS.map((option) => (
                <Button
                  key={option}
                  variant={speed === option ? 'primary' : 'outline'}
                  aria-pressed={speed === option}
                  onClick={() => setSpeed(option)}
                >
                  {option}×
                </Button>
              ))}
            </div>
          </div>
        </div>

        <CoverageBar model={model} />

        {model.staleParagraphs > 1 ? (
          <div>
            <RegenerateAllButton projectId={projectId} count={model.staleParagraphs} />
          </div>
        ) : null}

        {model.blockedReason ? (
          <p className="text-[13px] text-[var(--color-warning)]">{model.blockedReason}</p>
        ) : (
          <p className="text-[13px] text-[var(--color-success)]">
            Every paragraph has audio and nothing is flagged. This is ready to approve.
          </p>
        )}

        {model.orphanedTakes > 0 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            {model.orphanedTakes} take{model.orphanedTakes === 1 ? '' : 's'} no longer match any
            paragraph — the script was edited after they were read. They are ignored here and will
            not be assembled.
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {model.chapters.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            There is no script to narrate yet.
          </p>
        ) : (
          model.chapters.map((chapter) => (
            <ChapterSection
              key={chapter.chapterId}
              chapter={chapter}
              open={openChapters.has(chapter.chapterId)}
              onToggle={() =>
                setOpenChapters((open) => {
                  const next = new Set(open)
                  if (next.has(chapter.chapterId)) next.delete(chapter.chapterId)
                  else next.add(chapter.chapterId)
                  return next
                })
              }
              playingTakeId={playingTakeId}
              onPlay={playOne}
              onStop={stopPlayback}
            />
          ))
        )}

        {/* One element for the whole screen. Sixty <audio> tags would each
            open a connection to R2 the moment the page rendered. */}
        <audio
          ref={audio}
          {...(playingTakeId ? { src: `/api/voice-takes/${playingTakeId}/audio` } : {})}
          // Rolling on is the listen-through's behaviour, not Play's: a row's
          // Play is a spot check and ends where the paragraph does.
          onEnded={() => (listenThrough ? playNext() : setPlayingTakeId(null))}
          onPause={() => undefined}
          className="sr-only"
        >
          <track kind="captions" />
        </audio>
      </CardContent>
    </Card>
  )
}
