import { MilestonePlaceholder } from '@/components/milestone-placeholder'

export const metadata = { title: 'Case Library · Boom-Busters' }

export default function CasesPage() {
  return (
    <MilestonePlaceholder
      title="Case Library"
      milestone="M3"
      description="Sortable backlog of cases with a Suggest cases button that streams proposals into draft rows, each carrying visible Accept and Dismiss buttons."
    />
  )
}
