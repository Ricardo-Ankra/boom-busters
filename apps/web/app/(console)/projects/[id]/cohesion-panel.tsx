import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fitWarning } from '@/lib/brief-fit'
import type {
  BriefFit,
  CohesionCell,
  CohesionColumn,
  CohesionReport,
  CohesionRow,
} from '@boom-busters/schemas'

/**
 * Where the topic, the format's keywords and the pillar's keywords show up in
 * the master's copy. Information only: nothing here blocks a schedule. Each
 * cell says Yes, No or Not set in words, with colour as a second cue.
 */

const ROWS: { key: CohesionRow; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'descriptionOpening', label: 'Description opening' },
  { key: 'tags', label: 'Tags' },
  { key: 'hashtags', label: 'Hashtags' },
  { key: 'spokenIntro', label: 'Spoken intro' },
]

const COLUMNS: { key: CohesionColumn; label: string }[] = [
  { key: 'topic', label: 'Topic' },
  { key: 'format', label: 'Format' },
  { key: 'pillar', label: 'Pillar' },
]

const WORDS: Record<CohesionCell, { text: string; colour: string }> = {
  hit: { text: 'Yes', colour: 'text-[var(--color-success)]' },
  miss: { text: 'No', colour: 'text-[var(--color-warning)]' },
  none: { text: 'Not set', colour: 'text-[var(--color-text-muted)]' },
}

export function CohesionPanel({
  report,
  fit = null,
  casePillarKey = null,
  pillars = [],
}: {
  report: CohesionReport
  /** The project's frozen brief's channel fit: shown above the gaps, in the case row's words. */
  fit?: BriefFit | null
  casePillarKey?: string | null
  pillars?: readonly { key: string; label: string }[]
}) {
  const fitText = fitWarning(fit, casePillarKey, pillars)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[14px]">Keyword cohesion</CardTitle>
        <CardDescription>
          Whether each part of the copy carries the topic, the format&apos;s keywords and the
          pillar&apos;s. A warning only: nothing here stops a schedule.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {fitText ? <p className="text-[12px] text-[var(--color-warning)]">{fitText}</p> : null}
        {report.gaps.length > 0 ? (
          <ul className="flex flex-col gap-1 text-[12px] text-[var(--color-warning)]">
            {report.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        ) : null}
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[var(--color-text-muted)]">
              <th scope="col" className="py-1 pr-3 font-normal">
                <span className="sr-only">Part of the copy</span>
              </th>
              {COLUMNS.map((column) => (
                <th key={column.key} scope="col" className="py-1 pr-3 font-normal">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-t border-[var(--color-border)]">
                <th
                  scope="row"
                  className="py-1 pr-3 text-left font-normal text-[var(--color-text-secondary)]"
                >
                  {row.label}
                </th>
                {COLUMNS.map((column) => {
                  const word = WORDS[report.cells[row.key][column.key]]
                  return (
                    <td key={column.key} className={`py-1 pr-3 ${word.colour}`}>
                      {word.text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
