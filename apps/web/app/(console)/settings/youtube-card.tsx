'use client'

import type { MaskedCredential } from '@boom-busters/db'
import * as React from 'react'
import { Youtube } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { verifyYoutubeConnection } from './actions'

/**
 * The YouTube connection card (build spec section 9): OAuth, not a key
 * paste. Connect/Reconnect walks the consent flow via `/api/youtube/connect`
 * (a plain link — the browser has to leave for Google either way); Verify
 * mints an access token from the stored refresh token and pings
 * `channels.list`, the same health check the daily ping runs.
 */
export function YoutubeCard({
  credential,
  envReady,
}: {
  credential: MaskedCredential | undefined
  /** Whether YOUTUBE_CLIENT_ID/SECRET exist — resolved server-side. */
  envReady: boolean
}) {
  const [verifying, setVerifying] = React.useState(false)
  const [needsReconnect, setNeedsReconnect] = React.useState(false)
  const { toast } = useToast()

  const connected = credential !== undefined
  const healthy = credential?.verifyStatus === 'ok'

  const verify = async () => {
    setVerifying(true)
    const result = await verifyYoutubeConnection()
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
        {credential?.lastVerifiedAt ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Last verified {new Date(credential.lastVerifiedAt).toLocaleString()}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {envReady ? (
            <Button asChild variant={connected ? 'outline' : 'primary'}>
              <a href="/api/youtube/connect">{connected ? 'Reconnect' : 'Connect YouTube'}</a>
            </Button>
          ) : null}
          {connected ? (
            <Button variant="outline" busy={verifying} onClick={() => void verify()}>
              Verify
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
