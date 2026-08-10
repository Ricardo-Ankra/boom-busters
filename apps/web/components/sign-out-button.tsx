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
      <Button type="submit" variant="ghost" size="icon">
        <LogOut aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </form>
  )
}
