import { getDb } from '@boom-busters/db'
import 'server-only'
import { env } from './env'

/** The app's single memoised database connection. */
export const db = getDb(env.DATABASE_URL)
