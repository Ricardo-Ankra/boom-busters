import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * The privacy policy (decision 229). Public on purpose: Google requires a
 * live privacy-policy URL before the OAuth consent screen can leave Testing
 * mode, and Testing-mode refresh tokens expire every 7 days — which would
 * quietly break uploads and analytics mid-week. The text is the truth about
 * a single-operator tool, not boilerplate.
 */

export const metadata = { title: 'Privacy · Boom & Busters' }

const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'What this application is',
    body:
      'Boom & Busters is a private, single-operator production console for the ' +
      'Boom & Busters YouTube channel. It has exactly one authorised user — the ' +
      'channel owner — and no public sign-up, no visitors, and no audience-facing ' +
      'features. This page exists because Google requires a privacy policy for ' +
      'applications that connect to YouTube.',
  },
  {
    heading: 'What Google data it uses',
    body:
      'With the owner’s consent, the application uses the YouTube Data API to ' +
      'upload the channel’s own videos, set their titles, descriptions, tags, ' +
      'thumbnails and publish times, and the YouTube Analytics API to read the ' +
      'channel’s own viewing statistics. It reads and writes only the connected ' +
      'channel’s content. It never accesses any other user’s data.',
  },
  {
    heading: 'How credentials are stored',
    body:
      'The Google OAuth refresh token is stored encrypted (AES-256-GCM) in the ' +
      'application’s own database and never leaves its server except as ' +
      'short-lived access tokens sent directly to Google’s APIs. No Google data ' +
      'is sold, shared with third parties, or used for advertising or model ' +
      'training. Video statistics are stored only to show the owner their own ' +
      'channel’s performance.',
  },
  {
    heading: 'Data retention and deletion',
    body:
      'All stored data belongs to the operator and lives in the operator’s own ' +
      'infrastructure. Disconnecting YouTube in the application’s settings ' +
      'deletes the stored token; revoking access at myaccount.google.com/permissions ' +
      'invalidates it immediately. Contact for any privacy question: the support ' +
      'email listed on the Google consent screen for this application.',
  },
]

export default function PrivacyPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-background)] p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Boom &amp; Busters — Privacy Policy</CardTitle>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Last updated 10 September 2026
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {SECTIONS.map((section) => (
            <section key={section.heading} className="flex flex-col gap-1">
              <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
                {section.heading}
              </h3>
              <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                {section.body}
              </p>
            </section>
          ))}
        </CardContent>
      </Card>
    </main>
  )
}
