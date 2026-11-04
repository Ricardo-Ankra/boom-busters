/** The case's pillar in a bible, by the case's category key. */
export function pillarOf(
  bible: { caseCategories: readonly { key: string; label: string; keywords: string[] }[] },
  category: string | undefined,
): { key: string; label: string; keywords: string[] } | undefined {
  return bible.caseCategories.find((pillar) => pillar.key === category)
}
