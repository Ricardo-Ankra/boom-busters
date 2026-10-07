/**
 * The reason a graphic call was given for a retry: the designer's prompt ends a
 * retried request with "Your previous answer for this slot was refused: <reason>.
 * Answer again with that fixed." A request without that message returns undefined.
 */
const REFUSAL =
  /Your previous answer for this slot was refused: ([\s\S]*?)\. Answer again with that fixed\./

export function refusalReasonOf(messages: readonly { content: string }[]): string | undefined {
  for (const message of [...messages].reverse()) {
    const reason = REFUSAL.exec(message.content)?.[1]
    if (reason !== undefined) return reason
  }
  return undefined
}
