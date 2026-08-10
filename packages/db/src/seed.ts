import type { Database } from './client'
import {
  FIXTURE_DOSSIER_ID,
  FIXTURE_PROJECT_ID,
  fixtureCase,
  fixtureClaims,
  fixtureProject,
} from './fixtures'
import { getSettings, importProviderEnvSeeds } from './queries'
import { cases, claims, dossiers, projects } from './schema'

export interface SeedResult {
  settingsCreated: boolean
  credentialsImported: string[]
}

/**
 * Idempotent seed. Every insert is keyed by a deterministic fixture id and
 * conflicts are ignored, so `pnpm db:seed` can be run repeatedly — against a
 * fresh CI database or a dev database that already has the fixture — without
 * duplicating rows or clobbering local edits.
 */
export async function seed(
  db: Database,
  options: { encryptionKey?: string; env?: Record<string, string | undefined> } = {},
): Promise<SeedResult> {
  // Creates the row from DEFAULT_SETTINGS if it does not exist yet.
  await getSettings(db)

  await db.insert(cases).values(fixtureCase).onConflictDoNothing()
  await db.insert(projects).values(fixtureProject).onConflictDoNothing()
  await db
    .insert(dossiers)
    .values({
      id: FIXTURE_DOSSIER_ID,
      projectId: FIXTURE_PROJECT_ID,
      contentMd: FIXTURE_DOSSIER_MD,
    })
    .onConflictDoNothing()

  // One statement, not one per claim. Against a hosted database every round
  // trip is ~100ms, and the shot-list and voice-take fan-outs in later
  // milestones insert far more rows than this.
  await db
    .insert(claims)
    .values(fixtureClaims.map((claim) => ({ ...claim, dossierId: FIXTURE_DOSSIER_ID })))
    .onConflictDoNothing()

  const credentialsImported = options.encryptionKey
    ? await importProviderEnvSeeds(db, options.encryptionKey, options.env)
    : []

  return { settingsCreated: true, credentialsImported }
}

const FIXTURE_DOSSIER_MD = `# Wirecard — research dossier

## Timeline

- **1999** — Wirecard AG founded in Munich as a payment processor.
- **2018** — Enters the DAX 30, briefly worth more than Deutsche Bank.
- **Jan 2019** — Financial Times publishes the first Singapore whistleblower story.
- **Feb 2019** — BaFin bans short selling of the stock for two months.
- **Jun 2020** — EY refuses to sign the accounts; €1.9bn cannot be located.
- **Jun 2020** — Markus Braun resigns and is arrested; Jan Marsalek disappears.
- **Jun 2020** — Wirecard files for insolvency.

## Key numbers

- €1.9bn — the balance reported in Philippine trustee accounts.
- €24bn — peak market capitalisation.
- 4 days — from EY's refusal to the insolvency filing.

## Open questions for the gate

- The Marsalek intelligence-services claim is unverified and must be either
  sourced or quarantined before this dossier can be approved.
`
