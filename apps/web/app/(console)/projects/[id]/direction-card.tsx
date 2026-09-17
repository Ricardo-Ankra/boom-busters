'use client'

import * as React from 'react'
import { SHOT_FAMILIES } from '@boom-busters/schemas'
import type { DirectorsBook, Principal } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/confirm-button'
import { redraftDirectionAction, saveDirectionAction, type ActionResult } from './visuals-actions'

/**
 * The Director's Book on the plan screen (decision 252). Text areas for the
 * prose fields, one item per line for the lists, one row per principal. Save
 * is free and feeds the next re-plan; Redraft is the paid button here,
 * confirming what it throws away. Re-planning the shot list sits on the Shot
 * plan card beside "Fetch visuals" (decision 252, amended): it acts on the
 * plan, not on the book, and that is where the producer is looking when they
 * decide the plan reads wrong.
 *
 * The fields hold RAW text while the owner types and are parsed into the
 * book only on Save. Parsing on every keystroke re-serialised the field
 * under the cursor ("Jan" became "Jan |  | anonymous |  |" mid-word), so the
 * form is the state and the book is derived from it.
 *
 * Prices are the board's approximations (the "≈$0.08" convention): one
 * Sonnet call for the book, one Haiku call per chapter for the plan.
 */

const REDRAFT_ESTIMATE = '≈$0.05'

type Act = (key: string, run: () => Promise<ActionResult>, success: string) => Promise<void>

interface DirectionForm {
  visualThesis: string
  eraLocks: string
  palette: string
  motifs: string
  anchorObject: string
  neverShow: string
  principals: string
  locations: string
  chapters: string
  finalImage: string
}

const lines = (items: readonly string[]) => items.join('\n')
const unlines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

/** "label: rest" with the first colon as the split; the rest may hold colons. */
function splitFirst(line: string, separator: string): [string, string] {
  const at = line.indexOf(separator)
  if (at === -1) return [line.trim(), '']
  return [line.slice(0, at).trim(), line.slice(at + separator.length).trim()]
}

export function toForm(book: DirectorsBook): DirectionForm {
  return {
    visualThesis: book.visualThesis,
    eraLocks: lines(book.eraLocks.map((lock) => `${lock.span}: ${lock.rules}`)),
    palette: `${book.palette.accent}; ${book.palette.temperature}; ${book.palette.note}`,
    motifs: lines(book.motifs),
    anchorObject: book.anchorObject,
    neverShow: lines(book.neverShow),
    principals: lines(
      book.principals.map(
        (person) =>
          `${person.name} | ${person.role} | ${person.depiction} | ${person.identityString} | ${person.guardrail}`,
      ),
    ),
    locations: lines(book.locations.map((place) => `${place.name}: ${place.look}`)),
    chapters: lines(
      book.chapters.map(
        (chapter) => `${chapter.dominantShotFamily} | ${chapter.moodShift} | ${chapter.keyImage}`,
      ),
    ),
    finalImage: book.finalImage,
  }
}

const FAMILY_SET: ReadonlySet<string> = new Set(SHOT_FAMILIES)

function parsePrincipal(line: string): Principal {
  const [name = '', role = '', depiction = 'anonymous', identityString = '', guardrail = ''] = line
    .split('|')
    .map((part) => part.trim())
  const kind = depiction === 'likeness' || depiction === 'archival-only' ? depiction : 'anonymous'
  return { name, role, depiction: kind, identityString, guardrail }
}

/** The form back into a book. Validation is the server action's (`DirectorsBookSchema`). */
export function fromForm(form: DirectionForm): DirectorsBook {
  const [accent = '', temperature = '', ...note] = form.palette
    .split(';')
    .map((part) => part.trim())
  return {
    visualThesis: form.visualThesis.trim(),
    eraLocks: unlines(form.eraLocks).map((line) => {
      const [span, rules] = splitFirst(line, ':')
      return { span, rules }
    }),
    palette: {
      accent,
      temperature: temperature === 'cold' || temperature === 'warm' ? temperature : 'neutral',
      note: note.join('; '),
    },
    motifs: unlines(form.motifs),
    anchorObject: form.anchorObject.trim(),
    neverShow: unlines(form.neverShow),
    principals: unlines(form.principals).map(parsePrincipal),
    locations: unlines(form.locations).map((line) => {
      const [name, look] = splitFirst(line, ':')
      return { name, look }
    }),
    chapters: unlines(form.chapters).map((line, index) => {
      const [family = 'environment', moodShift = '', keyImage = ''] = line
        .split('|')
        .map((part) => part.trim())
      return {
        chapter: index + 1,
        dominantShotFamily: (FAMILY_SET.has(family)
          ? family
          : 'environment') as DirectorsBook['chapters'][number]['dominantShotFamily'],
        moodShift,
        keyImage,
      }
    }),
    finalImage: form.finalImage.trim(),
  }
}

export function DirectionCard({
  projectId,
  direction,
  busy = false,
  act,
}: {
  projectId: string
  direction: DirectorsBook | null
  /** Slots already resolved during plan review; a re-plan discards them. */
  busy?: boolean
  act: Act
}) {
  const [form, setForm] = React.useState<DirectionForm | null>(direction ? toForm(direction) : null)
  React.useEffect(() => setForm(direction ? toForm(direction) : null), [direction])

  const field = (key: keyof DirectionForm) => (value: string) =>
    setForm((current) => (current ? { ...current, [key]: value } : current))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[14px]">Direction</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {form ? (
          <>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              The Director&apos;s Book: what varies for this film. The house look is fixed; every
              chapter&apos;s shot list follows what is written here.
            </p>
            <Field
              label="Visual thesis"
              value={form.visualThesis}
              onChange={field('visualThesis')}
            />
            <Field
              label="Era locks (one per line, span: rules)"
              value={form.eraLocks}
              onChange={field('eraLocks')}
            />
            <Field
              label="Palette (accent; cold, neutral or warm; note)"
              value={form.palette}
              onChange={field('palette')}
            />
            <Field
              label="Motifs (three, one per line)"
              value={form.motifs}
              onChange={field('motifs')}
            />
            <Field
              label="Anchor object"
              value={form.anchorObject}
              onChange={field('anchorObject')}
            />
            <Field
              label="Never show (one per line)"
              value={form.neverShow}
              onChange={field('neverShow')}
            />
            <Field
              label="Principals (one per line: name | role | likeness, anonymous or archival-only | identity | guardrail)"
              value={form.principals}
              onChange={field('principals')}
            />
            <Field
              label="Locations (one per line: name: look)"
              value={form.locations}
              onChange={field('locations')}
            />
            <Field
              label="Chapters (one per line, in order: family | mood shift | key image)"
              value={form.chapters}
              onChange={field('chapters')}
            />
            <Field label="Final image" value={form.finalImage} onChange={field('finalImage')} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                busy={busy}
                onClick={() =>
                  act(
                    'direction-save',
                    () => saveDirectionAction(projectId, fromForm(form)),
                    'Direction saved',
                  )
                }
              >
                Save direction
              </Button>
              <ConfirmButton
                variant="outline"
                confirmVariant="primary"
                busy={busy}
                label={`Redraft direction · ${REDRAFT_ESTIMATE}`}
                confirmLabel="Redraft now"
                consequence="One model call rewrites the whole book. Your edits to the book are replaced."
                onConfirm={() =>
                  act(
                    'direction-redraft',
                    () => redraftDirectionAction(projectId),
                    'Redrafting the direction',
                  )
                }
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              No direction has been written for this film yet. Redraft it to give every chapter one
              look, then re-plan the shot list against it.
            </p>
            <div>
              <ConfirmButton
                variant="primary"
                confirmVariant="primary"
                busy={busy}
                label={`Redraft direction · ${REDRAFT_ESTIMATE}`}
                confirmLabel="Draft now"
                consequence="One model call writes the Director's Book from the approved script."
                onConfirm={() =>
                  act(
                    'direction-redraft',
                    () => redraftDirectionAction(projectId),
                    'Drafting the direction',
                  )
                }
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = React.useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] text-[var(--color-text-muted)]">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={Math.min(6, Math.max(2, value.split('\n').length))}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[13px] text-[var(--color-text-primary)]"
      />
    </div>
  )
}
