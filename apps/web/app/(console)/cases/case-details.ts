/**
 * The three fields a case carries for the dossier: its subject, its people
 * and its source links. The form types them as plain text; these turn the
 * text into what `addCase` and `editCase` take, and back.
 */

/** The title's text before its first colon, trimmed: "Wirecard: the missing billion" gives "Wirecard". */
export function subjectFromTitle(title: string): string {
  const colon = title.indexOf(':')
  return (colon === -1 ? title : title.slice(0, colon)).trim()
}

/** "Markus Braun, Jan Marsalek" as a list; blanks dropped. */
export function splitPeople(text: string): string[] {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

export const joinPeople = (people: readonly string[]): string => people.join(', ')

/** One address per line; blank lines dropped. The action checks each is http(s). */
export function splitSourceLinks(text: string): { url: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((url) => ({ url }))
}

/** Back to lines. A note a link carries is kept by the caller, not shown in the box. */
export const joinSourceLinks = (links: readonly { url: string }[]): string =>
  links.map((link) => link.url).join('\n')
