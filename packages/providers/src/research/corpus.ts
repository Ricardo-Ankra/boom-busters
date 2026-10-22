import type { DocumentKind } from '@boom-busters/schemas'

export interface CorpusDocument {
  id: string
  url: string
  kind: DocumentKind
  title: string | null
  publishedAt: string | null
  text: string
  archivedUrl: string | null
  httpStatus: number | null
}

/**
 * Number the documents D1..Dn in the order given and lay them out for the
 * model. The numbers are how the model cites a source, so callers must pass
 * the same order to documentByNumber when resolving a citation.
 */
export function renderCorpus(docs: readonly CorpusDocument[]): string {
  return docs
    .map((d, i) => {
      const header = `[D${i + 1}] ${d.kind} · ${d.title ?? d.url} · ${d.publishedAt ?? 'undated'} · ${d.url}`
      return `${header}\n${d.text}`
    })
    .join('\n\n----\n\n')
}

export function documentByNumber(
  docs: readonly CorpusDocument[],
  n: number,
): CorpusDocument | undefined {
  return Number.isInteger(n) && n >= 1 ? docs[n - 1] : undefined
}
