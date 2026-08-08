import { GeistSans } from 'geist/font/sans'
import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import { themeBootstrapScript } from '@/components/theme-provider'
import { ToastProvider } from '@/components/ui/toast'
import './globals.css'

// Importing this validates the environment at boot and refuses to start with
// a list of every missing key (build spec section 4).
import '@/lib/env'

/** Numbers, costs, timecodes, ids and logs (spec section 11.1). */
const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Boom-Busters',
  description: 'Production console for the Boom & Busters channel',
}

export const viewport: Viewport = {
  // Review screens are responsive to 390px; approving from a phone is a
  // first-class flow (spec section 11.4).
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint so dark never flashes
            to light on load. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${GeistSans.variable} ${jetBrainsMono.variable} antialiased`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
