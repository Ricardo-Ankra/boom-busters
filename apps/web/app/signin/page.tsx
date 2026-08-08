import { redirect } from 'next/navigation'
import { auth, mockSignInEnabled, signIn } from '@/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Sign in · Boom-Busters' }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  const session = await auth()
  if (session?.user?.email) redirect('/')

  const { callbackUrl = '/', error } = await searchParams

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-background)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Boom-Busters</CardTitle>
          <CardDescription>
            Production console. One account has access; everything else is refused.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {error ? (
            <p
              role="alert"
              className="rounded-[8px] border border-[var(--color-danger)] p-3 text-[13px] text-[var(--color-text-primary)]"
            >
              That account is not on the allowlist.
            </p>
          ) : null}

          <form
            action={async () => {
              'use server'
              await signIn('google', { redirectTo: callbackUrl })
            }}
          >
            <Button type="submit" variant="primary" size="lg" className="w-full">
              Sign in with Google
            </Button>
          </form>

          {mockSignInEnabled ? (
            <form
              action={async () => {
                'use server'
                await signIn('mock', { redirectTo: callbackUrl })
              }}
            >
              <Button type="submit" variant="outline" className="w-full">
                Sign in as owner (mock mode)
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
