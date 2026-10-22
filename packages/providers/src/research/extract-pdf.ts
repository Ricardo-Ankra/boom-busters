/**
 * Plain text from a PDF, pages separated by blank lines.
 *
 * unpdf is imported inside the function on purpose: the Inngest route bundle
 * must not load it eagerly, and most documents are not PDFs.
 */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(bytes)
  const { text } = await extractText(pdf, { mergePages: false })
  return text.map((page) => page.trim()).join('\n\n')
}
