import { LogOut } from 'lucide-react'
import { signOut } from '@/auth'
import { Button } from '@/components/ui/button'

export function SignOutButton() {
  return (
    <form
      action={async () => {
        'use server'
        await signOut({ redirectTo: '/signin' })
      }}
    >
      {/* aria-label, because below the `sm` breakpoint the text span hides
          and the icon is aria-hidden — an icon-only button with no name. */}
      <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
        <LogOut aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </form>
  )
}
