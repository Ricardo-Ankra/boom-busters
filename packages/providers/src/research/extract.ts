import type { DocumentKind } from '@boom-busters/schemas'
import { htmlToText } from './extract-html'
import { pdfToText } from './extract-pdf'
import { tenKSections } from './extract-tenk'
import type { FetchedDocument } from './fetch'

export interface ExtractedText {
  title: string | null
  text: string
  publishedAt: string | null
  /** Why the body was not read as text, such as an image; null when it was. */
  failure: string | null
}

type Reader = 'html' | 'pdf' | 'text'

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
/** The PDF spec lets a few bytes of junk sit before the header; readers look this far. */
const PDF_HEADER_WINDOW = 1_024

function looksLikePdf(body: Uint8Array): boolean {
  const end = Math.min(body.length, PDF_HEADER_WINDOW) - PDF_MAGIC.length
  for (let i = 0; i <= end; i++) {
    if (PDF_MAGIC.every((byte, j) => body[i + j] === byte)) return true
  }
  return false
}

/**
 * Which reader a body goes to. The bytes win over the header for PDFs, since
 * servers often send a filing as application/octet-stream. Anything outside
 * text, markup, JSON and PDF is refused: decoding an image or a zip as UTF-8
 * stores junk, and a NUL byte in it makes Postgres refuse the row.
 */
function readerFor(type: string, body: Uint8Array): Reader | null {
  if (looksLikePdf(body)) return 'pdf'
  if (type.includes('text/html') || type.includes('application/xhtml+xml')) return 'html'
  if (type.includes('application/pdf')) return 'pdf'
  if (/^text\/|[/+](xml|json)\b/.test(type)) return 'text'
  // No header at all: read it as text unless the opening bytes are binary.
  if (type === '' && !body.subarray(0, PDF_HEADER_WINDOW).includes(0)) return 'text'
  return null
}

export async function extractText(
  doc: FetchedDocument,
  kind: DocumentKind,
): Promise<ExtractedText> {
  if (doc.body === null) return { title: null, text: '', publishedAt: null, failure: null }

  const type = doc.contentType?.toLowerCase().trim() ?? ''
  const reader = readerFor(type, doc.body)
  let extracted: ExtractedText
  switch (reader) {
    case 'html':
      extracted = { ...htmlToText(new TextDecoder('utf-8').decode(doc.body)), failure: null }
      break
    case 'pdf':
      extracted = { title: null, text: await pdfToText(doc.body), publishedAt: null, failure: null }
      break
    case 'text':
      extracted = {
        title: null,
        text: new TextDecoder('utf-8').decode(doc.body),
        publishedAt: null,
        failure: null,
      }
      break
    case null:
      return {
        title: null,
        text: '',
        publishedAt: null,
        failure: `not a text document (${type === '' ? 'unknown type' : type})`,
      }
  }

  // The marker is checked on the text, not the kind alone: a filing that is
  // an 8-K or a proxy has no Items 1 and 7 to cut to.
  if (kind === 'filing' && /form 10-k/i.test(extracted.text.slice(0, 2_000))) {
    return { ...extracted, text: tenKSections(extracted.text) }
  }
  return extracted
}
