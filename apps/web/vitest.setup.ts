import { loadEnvFiles } from '@boom-busters/db'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Next loads `.env.local` for the app; Vitest does not. The Inngest tests hit
 * a real database through `lib/db`, which validates the boot env, so the same
 * file has to be loaded here. Real environment variables still win, which is
 * how CI supplies its own.
 */
loadEnvFiles()

afterEach(cleanup)
