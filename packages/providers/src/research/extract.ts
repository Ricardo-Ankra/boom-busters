import type { DocumentKind } from '@boom-busters/schemas'
import { htmlToText } from './extract-html'
import { pdfToText } from './extract-pdf'
import { tenKSections } from './extract-tenk'
import type { FetchedDocument } from './fetch'

export interface ExtractedText {
  title: string | null
  text: string
  publishedAt: string | null
}

export async function extractText(
  doc: FetchedDocument,
  kind: DocumentKind,
): Promise<ExtractedText> {
  if (doc.body === null) return { title: null, text: '', publishedAt: null }

  const type = doc.contentType?.toLowerCase() ?? ''
  let extracted: ExtractedText
  if (type.includes('text/html') || type.includes('application/xhtml+xml')) {
    extracted = htmlToText(new TextDecoder('utf-8').decode(doc.body))
  } else if (type.includes('application/pdf')) {
    extracted = { title: null, text: await pdfToText(doc.body), publishedAt: null }
  } else {
    extracted = { title: null, text: new TextDecoder('utf-8').decode(doc.body), publishedAt: null }
  }

  // The marker is checked on the text, not the kind alone: a filing that is
  // an 8-K or a proxy has no Items 1 and 7 to cut to.
  if (kind === 'filing' && /form 10-k/i.test(extracted.text.slice(0, 2_000))) {
    return { ...extracted, text: tenKSections(extracted.text) }
  }
  return extracted
}
