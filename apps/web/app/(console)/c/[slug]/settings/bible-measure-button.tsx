import { VIDIQ_CREDIT_COST } from '@boom-busters/providers/vidiq'
import { Button } from '@/components/ui/button'

/**
 * "Measure in VidIQ (about N credits)": N is the keywords still to measure
 * times the cost of one reading. Hidden when there is nothing to measure.
 */
export function MeasureButton({
  count,
  disabled,
  unavailable,
  onMeasure,
}: {
  /** Keywords with no reading from the last 30 days. */
  count: number
  disabled: boolean
  /** No VidIQ key is on file. */
  unavailable: boolean
  onMeasure: () => void
}) {
  if (count === 0) return null
  return (
    <Button
      variant="outline"
      disabled={disabled}
      {...(unavailable ? { title: 'Add a VidIQ key in Settings, Connections' } : {})}
      onClick={onMeasure}
    >
      Measure in VidIQ (about {count * VIDIQ_CREDIT_COST.keywordResearch} credits)
    </Button>
  )
}
