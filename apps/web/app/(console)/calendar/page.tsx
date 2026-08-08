import { MilestonePlaceholder } from '@/components/milestone-placeholder'

export const metadata = { title: 'Calendar · Boom-Busters' }

export default function CalendarPage() {
  return (
    <MilestonePlaceholder
      title="Calendar"
      milestone="M7"
      description="Week view with drag-to-slot scheduling, defaulting to the publish slots configured in Settings and spacing each long-form video from its Shorts."
    />
  )
}
