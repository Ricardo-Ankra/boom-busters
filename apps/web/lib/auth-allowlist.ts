/**
 * The allowlist (build spec section 2: "hard allowlist of exactly one email").
 *
 * Kept as a pure function with no Next.js or Auth.js imports so it can be
 * unit-tested directly — this is the single check standing between the
 * console and the open internet, and it should be provable, not inferred from
 * an integration test.
 */
export function isAllowedEmail(email: string | null | undefined, ownerEmail: string): boolean {
  if (!email || !ownerEmail) return false

  const normalise = (value: string) => value.trim().toLowerCase()
  const candidate = normalise(email)
  const owner = normalise(ownerEmail)

  // Guard against an empty or whitespace-only OWNER_EMAIL letting everyone in.
  if (owner === '' || candidate === '') return false

  return candidate === owner
}
