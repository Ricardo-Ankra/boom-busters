/**
 * A cheap token estimate. The research prompts budget by size, not by exact
 * count, and four characters to a token is close enough for English prose to
 * keep a prompt inside its window without a tokenizer dependency.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Cut a text to a token budget at a boundary a reader would not notice: the
 * last blank line inside the budget, else the last line break, else hard.
 */
export function truncateAtParagraph(
  text: string,
  maxTokens: number,
): { text: string; truncated: boolean } {
  const limit = maxTokens * 4
  if (text.length <= limit) return { text, truncated: false }

  const window = text.slice(0, limit)
  const paragraph = window.lastIndexOf('\n\n')
  if (paragraph > 0) return { text: window.slice(0, paragraph), truncated: true }
  const line = window.lastIndexOf('\n')
  if (line > 0) return { text: window.slice(0, line), truncated: true }
  return { text: window, truncated: true }
}
