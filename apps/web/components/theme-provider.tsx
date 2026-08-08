'use client'

import { Moon, Sun } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'

/**
 * Dark is the default because video review happens on dark (spec section
 * 11.1). The choice is stored locally and applied by the inline script in the
 * root layout before first paint, so there is no flash of the wrong theme.
 */

const STORAGE_KEY = 'boom-busters.theme'
type Theme = 'dark' | 'light'

/** Runs before hydration; kept in one place so it cannot drift from the toggle. */
export const themeBootstrapScript = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    if (stored === 'light') document.documentElement.classList.add('light');
  } catch (e) {}
})();
`

export function ThemeToggle() {
  const [theme, setTheme] = React.useState<Theme>('dark')

  React.useEffect(() => {
    setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark')
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('light', next === 'light')
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private browsing: the toggle still works for this session.
    }
    setTheme(next)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
      <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </Button>
  )
}
