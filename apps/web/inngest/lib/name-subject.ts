import { updateCase } from '@boom-busters/db'
import type { CaseRow, Database } from '@boom-busters/db'
import { buildNameSubjectRequest, mockNameSubject, parseNameSubject } from '@boom-busters/providers'
import type { NamedSubject } from '@boom-busters/providers'
import { BudgetExceededError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { answerOrStop, callForAnswer } from '@/lib/answer'
import type { AnswerComplete } from '@/lib/answer'

/**
 * A case saved before cases carried a subject gets one now: a single cheap
 * call the first time the dossier runs, stored on the case so it is never
 * asked again. A case that has one is returned as it stands, with no call.
 *
 * Guarded as the research passes are: a spent budget stops the stage with a
 * plain message (Inngest would retry it blind, four more times, to be refused
 * four more times), and an answer that is still unusable after the helper's
 * retry stops it too, through `answerOrStop`.
 */
export async function nameSubjectIfMissing(
  db: Database,
  caseRow: Pick<CaseRow, 'id' | 'title' | 'angle' | 'category' | 'subject' | 'people'>,
  deps: { complete: AnswerComplete; mocked: boolean },
): Promise<NamedSubject> {
  if (caseRow.subject) return { subject: caseRow.subject, people: caseRow.people }

  let named: NamedSubject
  if (deps.mocked) {
    named = mockNameSubject(caseRow.title)
  } else {
    try {
      named = answerOrStop(
        await callForAnswer({
          request: buildNameSubjectRequest({
            title: caseRow.title,
            angle: caseRow.angle,
            category: caseRow.category,
          }),
          parse: parseNameSubject,
          complete: deps.complete,
        }),
        'The case subject could not be named',
      )
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        throw new NonRetriableError(
          `The case subject could not be named: ${error.message}. Raise the budget or name the subject on the case.`,
          { cause: error },
        )
      }
      throw error
    }
  }

  await updateCase(db, caseRow.id, { subject: named.subject, people: named.people })
  return named
}
