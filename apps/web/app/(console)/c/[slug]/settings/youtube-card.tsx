'use client'

import * as React from 'react'
import { Youtube } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { disconnectYoutubeAction, verifyYoutubeConnection } from './actions'

/** What the card shows of one channel's connection; never key material. */
export interface YoutubeConnectionView {
  masked: string
  verifyStatus: 'ok' | 'invalid' | 'unchecked'
  lastVerifiedAt: Date | null
  youtubeChannelTitle: string | null
}

/**
 * The YouTube connection card (build spec section 9): OAuth, not a key
 * paste. Each channel has its own connection. Connect/Reconnect walks the
 * consent flow via `/api/youtube/connect?channel=<id>`
 * (a plain link — the browser has to leave for Google either way); Verify
 * mints an access token from the stored refresh token and pings
 * `channels.list`, the same health check the daily ping runs.
 */
export function YoutubeCard({
  connection,
  channelId,
  slug,
  envReady,
}: {
  connection: YoutubeConnectionView | undefined
  channelId: string
  /** The channel's slug, named in the card so the owner sees whose account this is. */
  slug: string
  /** Whether YOUTUBE_CLIENT_ID/SECRET exist — resolved server-side. */
  envReady: boolean
}) {
  const [verifying, setVerifying] = React.useState(false)
  const [needsReconnect, setNeedsReconnect] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [disconnecting, setDisconnecting] = React.useState(false)
  const { toast } = useToast()

  const connected = connection !== undefined
  const healthy = connection?.verifyStatus === 'ok'

  const verify = async () => {
    setVerifying(true)
    const result = await verifyYoutubeConnection(channelId)
    setVerifying(false)
    setNeedsReconnect(result.needsReconnect === true)
    if (result.ok) {
      toast({
        title: result.channelTitle
          ? `Connected to "${result.channelTitle}"`
          : 'The YouTube connection works',
      })
    } else {
      toast({ title: 'YouTube verification failed', description: result.error, variant: 'error' })
    }
  }

  const disconnect = async () => {
    setDisconnecting(true)
    const result = await disconnectYoutubeAction(channelId)
    setDisconnecting(false)
    setConfirming(false)
    if (result.ok) {
      toast({ title: 'YouTube disconnected' })
    } else {
      toast({ title: 'Could not disconnect YouTube', description: result.error, variant: 'error' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[14px]">
          <Youtube aria-hidden className="h-4 w-4" />
          YouTube
          <span
            className={`ml-auto text-[12px] font-normal ${
              healthy
                ? 'text-[var(--color-success)]'
                : connected
                  ? 'text-[var(--color-danger)]'
                  : 'text-[var(--color-text-muted)]'
            }`}
          >
            {healthy ? 'connected' : connected ? 'needs attention' : 'not connected'}
          </span>
        </CardTitle>
        <CardDescription>
          Uploads, metadata and analytics. OAuth with exactly the upload, data and analytics-read
          scopes; the refresh token is stored encrypted and never leaves this server.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!envReady ? (
          <p className="text-[13px] text-[var(--color-warning)]">
            Set <span className="font-mono">YOUTUBE_CLIENT_ID</span> and{' '}
            <span className="font-mono">YOUTUBE_CLIENT_SECRET</span> in the environment first — a
            Google OAuth client of type &quot;Web application&quot;.
          </p>
        ) : null}
        {needsReconnect ? (
          <p className="text-[13px] text-[var(--color-danger)]">
            Google no longer honours the stored consent — reconnect to grant it again.
          </p>
        ) : null}
        <p className="text-[12px] text-[var(--color-text-muted)]">
          For the <span className="font-mono">{slug}</span> channel
          {connection?.youtubeChannelTitle ? (
            <> &middot; YouTube account &quot;{connection.youtubeChannelTitle}&quot;</>
          ) : null}
        </p>
        {connection?.lastVerifiedAt ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Last verified {new Date(connection.lastVerifiedAt).toLocaleString()}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {envReady ? (
            <Button asChild variant={connected ? 'outline' : 'primary'}>
              <a href={`/api/youtube/connect?channel=${channelId}`}>
                {connected ? 'Reconnect' : 'Connect YouTube'}
              </a>
            </Button>
          ) : null}
          {connected ? (
            <Button variant="outline" busy={verifying} onClick={() => void verify()}>
              Verify
            </Button>
          ) : null}
          {connected && !confirming ? (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          ) : null}
        </div>
        {connected && confirming ? (
          <div className="flex flex-col gap-2" role="group" aria-label="Confirm disconnect">
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Disconnect YouTube from the <span className="font-mono">{slug}</span> channel? Uploads
              and analytics stop until you connect an account again.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" busy={disconnecting} onClick={() => void disconnect()}>
                Yes, disconnect
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Keep connected
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
