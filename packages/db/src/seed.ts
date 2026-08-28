import type { Database } from './client'
import {
  FIXTURE_DOSSIER_ID,
  FIXTURE_PROJECT_ID,
  fixtureCase,
  fixtureClaims,
  fixtureProject,
} from './fixtures'
import { getSettings, importProviderEnvSeeds } from './queries'
import { sql } from 'drizzle-orm'
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
    /**
     * Reset, not skip — for the same reason the claims below do. The dossier
     * body is what the inline claim highlights anchor to (decision 196), so
     * a database seeded before the body gained its summary paragraph would
     * keep showing a document nothing anchors to.
     */
    .onConflictDoUpdate({
      target: dossiers.id,
      set: { contentMd: FIXTURE_DOSSIER_MD, updatedAt: new Date() },
    })

  // One statement, not one per claim. Against a hosted database every round
  // trip is ~100ms, and the shot-list and voice-take fan-outs in later
  // milestones insert far more rows than this.
  await db
    .insert(claims)
    .values(fixtureClaims.map((claim) => ({ ...claim, dossierId: FIXTURE_DOSSIER_ID })))
    /**
     * Reset, not skip. `onConflictDoNothing` left a claim quarantined or
     * re-sourced by a previous test run, so the fixture's whole point — one
     * unverified claim blocking the dossier gate — quietly stopped being true
     * on the second run of the E2E suite.
     */
    .onConflictDoUpdate({
      target: claims.id,
      set: {
        text: sql`excluded.text`,
        sourceUrl: sql`excluded.source_url`,
        sourceType: sql`excluded.source_type`,
        confidence: sql`excluded.confidence`,
        quarantined: false,
        updatedAt: new Date(),
      },
    })

  const credentialsImported = options.encryptionKey
    ? await importProviderEnvSeeds(db, options.encryptionKey, options.env)
    : []

  return { settingsCreated: true, credentialsImported }
}

/**
 * The summary paragraph states two of the fixture claims verbatim, on
 * purpose: the dossier screen anchors claims to the text they were extracted
 * from (decision 196), and a fixture whose document never states any of its
 * claims would leave the highlight path — the screen's main interaction —
 * untestable and undemonstrable.
 */
const FIXTURE_DOSSIER_MD = `# Wirecard — research dossier

## Summary

Wirecard AG filed for insolvency in June 2020, days after its auditors
refused to sign off the accounts. EY declined to issue an audit opinion on
the 2019 accounts, saying it could not verify around €1.9 billion in trustee
balances. What follows is the timeline the collapse played out on, and the
numbers a script should hang its chapters from.

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
