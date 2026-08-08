import { countCases, countMusicBeds, getSettings, isYoutubeConnected } from '@boom-busters/db'
import { CheckCircle2, Circle } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db'
import { buildChecklist, isSetupComplete, pipelineBlockers } from '@/lib/first-run'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [settings, youtubeConnected, musicBedCount, caseCount] = await Promise.all([
    getSettings(db),
    isYoutubeConnected(db),
    countMusicBeds(db),
    countCases(db),
  ])

  const items = buildChecklist({ settings, youtubeConnected, musicBedCount, caseCount })

  if (!isSetupComplete(items)) {
    return <FirstRunChecklist items={items} />
  }

  return <NeedsYouQueue />
}

function FirstRunChecklist({ items }: { items: ReturnType<typeof buildChecklist> }) {
  const blockers = pipelineBlockers(items)

  return (
    <div className="prose-measure mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[20px] font-semibold">Set up Boom-Busters</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          {blockers.length === 0
            ? 'Everything the pipeline needs is in place. Finish the rest whenever you like.'
            : `The pipeline cannot start a project until ${blockers
                .map((item) => item.label.toLowerCase())
                .join(', ')} ${blockers.length === 1 ? 'is' : 'are'} done.`}
        </p>
      </header>

      <ol className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={item.id}>
            <Card>
              <CardHeader className="flex-row items-start gap-3">
                {item.done ? (
                  <CheckCircle2
                    className="mt-0.5 size-5 shrink-0 text-[var(--color-success)]"
                    aria-hidden
                  />
                ) : (
                  <Circle
                    className="mt-0.5 size-5 shrink-0 text-[var(--color-text-muted)]"
                    aria-hidden
                  />
                )}

                <div className="min-w-0 flex-1">
                  <CardTitle>
                    <span className="font-mono text-[var(--color-text-muted)]">{index + 1}. </span>
                    {item.label}
                    <span className="sr-only">{item.done ? ' — done' : ' — not done'}</span>
                  </CardTitle>
                  <CardDescription>{item.detail}</CardDescription>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button asChild variant={item.done ? 'outline' : 'primary'}>
                    <Link href={item.href}>{item.buttonLabel}</Link>
                  </Button>
                  {item.availableFrom ? (
                    <span className="text-[12px] text-[var(--color-text-muted)]">
                      Arrives in {item.availableFrom}
                    </span>
                  ) : null}
                </div>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * "Needs you" is the whole point of the dashboard (spec section 11.3). M2
 * onwards fills it with open gates, budget gates, failed runs and flagged QC
 * reports; the empty state is the state a healthy pipeline sits in.
 */
function NeedsYouQueue() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-semibold">Needs you</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-[15px] text-[var(--color-text-primary)]">
            All clear — pipeline is running itself.
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            Open gates, budget approvals and failed runs appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
