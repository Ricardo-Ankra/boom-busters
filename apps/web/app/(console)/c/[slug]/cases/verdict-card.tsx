import { briefHasFullChecks, briefVerdict } from '@boom-busters/schemas'
import type { SearchBrief, VerdictCheck, VerdictState } from '@boom-busters/schemas'
import { Check, TriangleAlert, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The five-check verdict at the top of the panel. Each row names its check,
 * says why in a sentence and links to the block that holds the evidence. A
 * brief researched before the full checks gets one line instead, so a gap in
 * the data is never read as a pass.
 */

const NAMES: Record<VerdictCheck, string> = {
  intent: 'Intent',
  angle: 'Angle evidence',
  fit: 'Channel fit',
  demand: 'Demand',
  competition: 'Competition',
}

const STATES: Record<VerdictState, { Icon: LucideIcon; word: string; tone: string }> = {
  ok: { Icon: Check, word: 'OK', tone: 'text-[var(--color-success)]' },
  warn: { Icon: TriangleAlert, word: 'Warning', tone: 'text-[var(--color-warning)]' },
  bad: { Icon: X, word: 'Problem', tone: 'text-[var(--color-danger)]' },
}

export const OLD_BRIEF_LINE =
  'Researched before the full checks. Research again for intent, demand and competition evidence.'

export function VerdictCard({
  brief,
  caseCategory,
}: {
  brief: SearchBrief
  caseCategory: string | null
}) {
  if (!briefHasFullChecks(brief)) {
    return (
      <section
        aria-label="Verdict"
        className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3"
      >
        <p className="text-[13px] text-[var(--color-text-secondary)]">{OLD_BRIEF_LINE}</p>
      </section>
    )
  }

  // The angle the owner chose, else the one the model recommended.
  const checkedAngle = brief.chosenAngle ?? brief.recommendedAngle ?? null
  const lines = briefVerdict(brief, { caseCategory, checkedAngle })

  return (
    <section
      aria-labelledby="verdict-heading"
      className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3"
    >
      <h3
        id="verdict-heading"
        className="mb-1 text-[13px] font-semibold text-[var(--color-text-secondary)]"
      >
        Verdict
      </h3>
      <ul className="flex flex-col">
        {lines.map((line) => {
          const { Icon, word, tone } = STATES[line.state]
          return (
            <li key={line.check}>
              <a
                href={`#evidence-${line.check}`}
                className="-mx-1.5 flex items-start gap-2.5 rounded-[8px] px-1.5 py-1.5 text-[13px] hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone}`} />
                <span className="sr-only">{word}</span>
                <span className="min-w-0">
                  <span className="font-semibold">{NAMES[line.check]}</span>{' '}
                  <span className="text-[var(--color-text-secondary)]">{line.reason}</span>
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
