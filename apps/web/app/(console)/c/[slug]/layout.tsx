import { ConsoleShell } from '@/components/console-shell'
import { channelFromSlug } from '@/lib/channel-context'
import { loadShellData } from '@/lib/shell-data'

/** The console shell for one channel, named by the URL. */
export default async function ChannelLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const channel = await channelFromSlug(slug)
  return <ConsoleShell {...await loadShellData(channel)}>{children}</ConsoleShell>
}
