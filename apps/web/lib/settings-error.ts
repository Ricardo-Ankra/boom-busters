import { z } from 'zod'

/**
 * What a settings save tells the owner when the merged row is refused (final
 * review of plan 1, issue 2). The patch is checked at the edge field by field;
 * a rule that spans two fields (the still limit against the cadence, a last
 * resort missing from the techniques) is checked when the merged row is
 * parsed, and Zod's own message for that is the JSON of its issues. Named the
 * way the edge names a refusal: "path: message".
 */
export function settingsErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    const first = error.issues[0]
    if (first) return `${first.path.map(String).join('.')}: ${first.message}`
  }
  return error instanceof Error ? error.message : 'Could not save settings'
}
