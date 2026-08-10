import { MilestonePlaceholder } from '@/components/milestone-placeholder'

export const metadata = { title: 'Projects · Boom-Busters' }

export default function ProjectsPage() {
  return (
    <MilestonePlaceholder
      title="Projects"
      milestone="M3"
      description="Every project as a row with a mini pipeline rail, current stage and age, and a contextual Review, View or Resume button."
    />
  )
}
