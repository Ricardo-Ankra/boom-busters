import { getChannel } from '@boom-busters/db'
import { ConsoleShell } from '@/components/console-shell'
import { channelForProjectOrNotFound } from '@/lib/channel-context'
import { db } from '@/lib/db'
import { loadShellData } from '@/lib/shell-data'

/**
 * A project's screens sit in the shell of the project's own channel, never the
 * one last visited: the channel comes from the project row.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { channelId } = await channelForProjectOrNotFound(id)
  const channel = await getChannel(db, channelId)
  return <ConsoleShell {...await loadShellData(channel)}>{children}</ConsoleShell>
}
