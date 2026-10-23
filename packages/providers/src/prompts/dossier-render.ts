import type { GroundedClaim, GroundedRef, GroundedResearch } from '@boom-busters/schemas'

/** A ref's link, carrying the transcript time the grounding step found. */
function locatedUrl(ref: GroundedRef | null): string | null {
  if (!ref?.url) return null
  if (ref.locatorSeconds === null) return ref.url
  return `${ref.url}${ref.url.includes('?') ? '&' : '?'}t=${ref.locatorSeconds}`
}

const sourceLink = (ref: GroundedRef | null): string => {
  const url = locatedUrl(ref)
  return url ? ` ([source](${url}))` : ''
}

/** The line's own full stop, dropped where the line adds more after it. */
const unstop = (text: string): string => text.trim().replace(/\.$/, '')

/** Link text cannot hold square brackets without ending the link early. */
const linkText = (text: string): string => text.replace(/\[/g, '(').replace(/\]/g, ')')

/**
 * Render the grounded research into the markdown the review screen shows and
 * the script reads.
 *
 * A pure function rather than a fifth model call: the dossier document is a
 * presentation of research already done, and paying a model to reformat data
 * it just produced would add cost, latency and an opportunity to hallucinate
 * between the claims table and the document beside it.
 *
 * Italics use asterisks only: the app's markdown parser does not read
 * underscores. A figure claim's series is already in its text (the grounding
 * step writes it there), so the renderer treats every claim alike.
 */
export function renderDossierMarkdown(input: {
  caseTitle: string
  research: GroundedResearch
  claims: readonly GroundedClaim[]
  /**
   * The corpus documents, for naming a told-already video by its title.
   * Optional: without them a beat links under its URL.
   */
  documents?: readonly { id: string; title: string | null }[]
}): string {
  const { brief, scenes, answers } = input.research
  const lines: string[] = [`# ${input.caseTitle}`, '', '## Summary', '', brief.summary, '']

  lines.push('## The turn', '', brief.turningPoint, '')

  // The story runs to today (decision 5). Dated so the reviewer sees how
  // recent "now" is, even when the newest document predates the turn.
  if (brief.currentStatus) {
    const { asOf, text } = brief.currentStatus
    lines.push('## Where it stands now', '', `**As of ${asOf}.** ${text.trim()}`, '')
  }

  if (brief.cast.length > 0) {
    lines.push('## Principals', '')
    for (const person of brief.cast) {
      lines.push(`- **${person.name}** — ${unstop(person.role)}. *${person.wanted.trim()}*`)
    }
    lines.push('')
  }

  lines.push('## Timeline', '')
  for (const scene of scenes) {
    // A scene whose quote was not found keeps its place and says so: the
    // reviewer checks it rather than never seeing it.
    lines.push(
      `- **${scene.when}** — ${unstop(scene.what)} (${scene.who}). *${scene.why.trim()}*` +
        `${sourceLink(scene.ref)}${scene.ref.found ? '' : ' (unplaced)'}`,
    )
  }
  lines.push('')

  if (brief.openQuestions.length > 0) {
    // Placed by the numbered index first (decision 203): the first live run
    // of the answers pass paraphrased every question it echoed back, text
    // matching placed none of them, and two thousand tokens of real answers
    // were silently dropped while every question stayed "open". The folded
    // text match remains only as the fallback for a model that forgot the
    // number; a non-null answer that still cannot be placed renders anyway,
    // under its own words: research that was paid for is never discarded
    // by a join key.
    const fold = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
    const questions = brief.openQuestions
    const byFold = new Map(questions.map((question, at) => [fold(question), at]))

    type Answer = GroundedResearch['answers'][number]
    const answeredAt = new Map<number, Answer>()
    const unplaced: Answer[] = []
    for (const answer of answers) {
      if (answer.answer === null) continue
      const indexed =
        answer.index !== undefined && answer.index >= 1 && answer.index <= questions.length
          ? answer.index - 1
          : undefined
      const at = indexed ?? byFold.get(fold(answer.question))
      // A second answer for a question already answered is still paid-for
      // research: it renders under its own wording rather than vanishing.
      if (at === undefined || answeredAt.has(at)) unplaced.push(answer)
      else answeredAt.set(at, answer)
    }

    if (answeredAt.size > 0 || unplaced.length > 0) {
      lines.push('## Questions the research answered', '')
      for (const [at, question] of questions.entries()) {
        const answer = answeredAt.get(at)
        if (!answer) continue
        // The brief's own wording, not the echo: the human read the brief.
        lines.push(`- **${question}** — ${answer.answer}${sourceLink(answer.ref)}`)
      }
      for (const answer of unplaced) {
        lines.push(`- **${answer.question}** — ${answer.answer}${sourceLink(answer.ref)}`)
      }
      lines.push('')
    }

    const open = questions.filter((_, at) => !answeredAt.has(at))
    if (open.length > 0) {
      // Deliberately in the document, not only in a side panel. What the
      // research could not establish is the part most likely to be written
      // around confidently if nobody sees it.
      lines.push('## Open questions', '')
      for (const question of open) lines.push(`- ${question}`)
      lines.push('')
    }
  }

  if (brief.toldAlready.length > 0) {
    const titles = new Map(
      (input.documents ?? []).flatMap((document) =>
        document.title ? [[document.id, document.title] as const] : [],
      ),
    )
    lines.push('## Told already', '')
    for (const told of brief.toldAlready) {
      const url = locatedUrl(told.ref)
      const name = (told.ref.documentId && titles.get(told.ref.documentId)) || told.ref.url
      lines.push(`- ${told.beat}${url && name ? ` ([${linkText(name)}](${url}))` : ''}`)
    }
    lines.push('')
  }

  const unverified = input.claims.filter((claim) => claim.confidence === 'unverified')
  if (unverified.length > 0) {
    lines.push(
      '## Unverified',
      '',
      `${unverified.length} claim(s) could not be attributed to a source. They are excluded ` +
        'from scripting until you verify or quarantine them.',
      '',
    )
  }

  return lines.join('\n')
}
