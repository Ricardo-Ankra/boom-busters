import { Card, CardContent } from '@/components/ui/card'

/**
 * A screen the information architecture (spec section 11.2) requires but
 * whose milestone has not arrived. Stated plainly, with the milestone named:
 * a screen that silently renders nothing reads as a bug, and "no silent
 * degradation" (design principle 6) applies to the UI too.
 */
export function MilestonePlaceholder({
  title,
  milestone,
  description,
}: {
  title: string
  milestone: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-semibold">{title}</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-[15px] text-[var(--color-text-primary)]">Arrives in {milestone}.</p>
          <p className="max-w-prose text-[13px] text-[var(--color-text-muted)]">{description}</p>
        </CardContent>
      </Card>
    </div>
  )
}
