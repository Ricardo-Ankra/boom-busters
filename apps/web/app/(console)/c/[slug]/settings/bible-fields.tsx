'use client'

import { BIBLE_SECTIONS } from '@boom-busters/schemas'
import type {
  BibleExampleEntry,
  BibleSection,
  ChannelBible,
  TooCloseFlags,
} from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { BIBLE_TEXT_FIELDS } from '@/lib/bible-fields'
import { ExamplesEditor, ExamplesView } from './bible-examples'

/**
 * The bible's fields, edited and shown by kind: text in a textarea, a list of
 * strings one per line, the subject noun as two inputs, the case categories
 * as rows, the YouTube category as an input, examples one textarea per slot,
 * and hooks, openings and titles as entries (text and note editable, the
 * videos they were drawn from shown as read-only).
 */

type Kind = 'text' | 'lines' | 'noun' | 'categories' | 'category-id' | 'examples' | 'entries'

interface FieldMeta {
  label: string
  hint?: string
  kind: Kind
  /** An entries list's one-entry name, for its Add and Remove buttons. */
  singular?: string
}

const TEXT_META = Object.fromEntries(
  BIBLE_TEXT_FIELDS.map((field) => [
    field.key,
    { label: field.label, hint: field.hint, kind: 'text' as const },
  ]),
) as Record<string, FieldMeta>

const FIELD_META: Partial<Record<keyof ChannelBible, FieldMeta>> = {
  ...TEXT_META,
  subjectNoun: {
    label: 'The subject noun',
    hint: 'What one subject is called, singular and plural.',
    kind: 'noun',
  },
  caseCategories: {
    label: 'Case categories',
    hint: 'At least two. The key is lower-case letters, digits, dashes or underscores.',
    kind: 'categories',
  },
  voiceDos: { label: 'Voice dos', hint: 'One per line.', kind: 'lines' },
  voiceDonts: { label: "Voice don'ts", hint: 'One per line.', kind: 'lines' },
  hedgingRules: {
    label: 'Hedging rules',
    hint: 'When the narrator may hedge and when it must commit.',
    kind: 'text',
  },
  scriptRulesMd: {
    label: 'Script rules',
    hint: 'Extra rules for the writer, in Markdown. Optional.',
    kind: 'text',
  },
  directionRulesMd: {
    label: 'Direction rules',
    hint: 'Extra rules for the director, in Markdown. Optional.',
    kind: 'text',
  },
  examples: { label: 'Examples', kind: 'examples' },
  hooks: { label: 'Hooks', kind: 'entries', singular: 'hook' },
  openings: { label: 'Openings', kind: 'entries', singular: 'opening' },
  titles: { label: 'Titles', kind: 'entries', singular: 'title' },
  language: { label: 'Language', hint: 'A language code such as en.', kind: 'text' },
  country: { label: 'Country', hint: 'A two-letter code such as US.', kind: 'text' },
  channelTags: { label: 'Channel tags', hint: 'One per line.', kind: 'lines' },
  disclaimer: { label: 'Disclaimer', hint: 'Added to every description. Optional.', kind: 'text' },
  youtubeCategoryId: {
    label: 'YouTube category id',
    hint: 'A number such as 27. Leave empty for none.',
    kind: 'category-id',
  },
  auditionLine: {
    label: 'Audition line',
    hint: 'What a voice reads to be auditioned.',
    kind: 'text',
  },
}

/** What a field holds while it is being edited. */
type FieldValue =
  | string
  | { singular: string; plural: string }
  | { key: string; label: string }[]
  | Record<string, string>
  | BibleExampleEntry[]

/** The section's fields as the form edits them. */
export type FormValues = Record<string, FieldValue>

function metaFor(key: string): FieldMeta {
  return FIELD_META[key as keyof ChannelBible] ?? { label: key, kind: 'text' }
}

export function initialFormValues(section: BibleSection, bible: ChannelBible): FormValues {
  const values: FormValues = {}
  for (const key of BIBLE_SECTIONS[section]) {
    const { kind } = metaFor(key)
    const value = bible[key]
    if (kind === 'lines') values[key] = (value as string[]).join('\n')
    else if (kind === 'category-id') values[key] = (value as string | null) ?? ''
    else if (kind === 'text') values[key] = value as string
    else values[key] = structuredClone(value) as FieldValue
  }
  return values
}

/** The patch an edit saves: lists split into lines, blanks dropped, an empty id as null. */
export function formPatch(section: BibleSection, values: FormValues): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of BIBLE_SECTIONS[section]) {
    const value = values[key]
    const { kind } = metaFor(key)
    if (kind === 'lines') {
      patch[key] = String(value)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
    } else if (kind === 'category-id') {
      patch[key] = String(value).trim() === '' ? null : String(value).trim()
    } else if (kind === 'examples') {
      patch[key] = Object.fromEntries(
        Object.entries(value as Record<string, string>).filter(([, text]) => text.trim() !== ''),
      )
    } else {
      patch[key] = value
    }
  }
  return patch
}

export const textareaClass =
  'min-h-24 w-full rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] ' +
  'px-3 py-2 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

/** The most hooks, openings or titles a bible holds (the schema's limit). */
const MAX_ENTRIES = 12

export const mutedClass = 'text-[12px] text-[var(--color-text-muted)]'

/** "Too close to its source", with the words they share and where they are from. */
export function FlagNote({ flags, path }: { flags: TooCloseFlags; path: string }) {
  const flag = flags[path]
  if (!flag) return null
  return (
    <p role="alert" className="text-[13px] text-[var(--color-warning)]">
      Too close to its source: &ldquo;{flag.run}&rdquo; ({flag.source})
    </p>
  )
}

function Source({ entry }: { entry: BibleExampleEntry }) {
  return (
    <>
      {entry.drawnFrom.map((from) => (
        <span key={from.videoId} className={mutedClass}>
          From: {from.title} ({from.channel})
        </span>
      ))}
    </>
  )
}

/** One section's fields, read-only. A slot with no example offers to draft it alone. */
export function SectionView({
  section,
  bible,
  flags,
  disabled,
  onDraftSlot,
}: {
  section: BibleSection
  bible: ChannelBible
  flags: TooCloseFlags
  disabled: boolean
  onDraftSlot: (slotId: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {BIBLE_SECTIONS[section].map((key) => {
        const meta = metaFor(key)
        const value = bible[key]
        if (meta.kind === 'examples') {
          return (
            <ExamplesView
              key={key}
              examples={bible.examples}
              flags={flags}
              disabled={disabled}
              onDraftSlot={onDraftSlot}
            />
          )
        }
        return (
          <div key={key} className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">
              {meta.label}
            </span>
            {meta.kind === 'entries' ? (
              (value as BibleExampleEntry[]).length === 0 ? (
                <p className={mutedClass}>None yet</p>
              ) : (
                (value as BibleExampleEntry[]).map((entry, i) => (
                  <div key={i} className="flex flex-col gap-0.5">
                    <p className="text-[14px] whitespace-pre-wrap">{entry.text}</p>
                    {entry.note ? <span className={mutedClass}>{entry.note}</span> : null}
                    <Source entry={entry} />
                    <FlagNote flags={flags} path={`${key}.${i}`} />
                  </div>
                ))
              )
            ) : (
              <ValueView kind={meta.kind} value={value} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ValueView({ kind, value }: { kind: Kind; value: unknown }) {
  const none = <p className={mutedClass}>Not set</p>
  if (kind === 'lines') {
    const lines = value as string[]
    return lines.length === 0 ? (
      none
    ) : (
      <ul className="list-disc pl-5 text-[14px]">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    )
  }
  if (kind === 'noun') {
    const noun = value as { singular: string; plural: string }
    return noun.singular === '' && noun.plural === '' ? (
      none
    ) : (
      <p className="text-[14px]">
        {noun.singular} / {noun.plural}
      </p>
    )
  }
  if (kind === 'categories') {
    const categories = value as { key: string; label: string }[]
    return categories.length === 0 ? (
      none
    ) : (
      <ul className="list-disc pl-5 text-[14px]">
        {categories.map((category, i) => (
          <li key={i}>
            <span className="font-mono">{category.key}</span>: {category.label}
          </li>
        ))}
      </ul>
    )
  }
  const text = value === null ? '' : String(value)
  return text === '' ? none : <p className="text-[14px] whitespace-pre-wrap">{text}</p>
}

/** One section's fields, as inputs. */
export function SectionEditor({
  section,
  values,
  flags,
  disabled,
  onChange,
}: {
  section: BibleSection
  values: FormValues
  flags: TooCloseFlags
  disabled: boolean
  onChange: (key: string, value: FieldValue) => void
}) {
  const id = React.useId()
  return (
    <div className="flex flex-col gap-3">
      {BIBLE_SECTIONS[section].map((key) => {
        const meta = metaFor(key)
        const value = values[key]
        const fieldId = `${id}-${key}`

        if (meta.kind === 'text' || meta.kind === 'lines') {
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={fieldId}>{meta.label}</Label>
              <textarea
                id={fieldId}
                className={textareaClass}
                value={String(value)}
                disabled={disabled}
                onChange={(event) => onChange(key, event.target.value)}
              />
              {meta.hint ? <p className={mutedClass}>{meta.hint}</p> : null}
            </div>
          )
        }

        if (meta.kind === 'category-id') {
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={fieldId}>{meta.label}</Label>
              <Input
                id={fieldId}
                value={String(value)}
                disabled={disabled}
                className="w-40"
                onChange={(event) => onChange(key, event.target.value)}
              />
              {meta.hint ? <p className={mutedClass}>{meta.hint}</p> : null}
            </div>
          )
        }

        if (meta.kind === 'noun') {
          const noun = value as { singular: string; plural: string }
          return (
            <fieldset key={key} className="flex flex-col gap-1.5">
              <legend className="text-[13px] font-medium text-[var(--color-text-secondary)]">
                {meta.label}
              </legend>
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label="Subject noun, singular"
                  value={noun.singular}
                  disabled={disabled}
                  className="w-48"
                  onChange={(event) => onChange(key, { ...noun, singular: event.target.value })}
                />
                <Input
                  aria-label="Subject noun, plural"
                  value={noun.plural}
                  disabled={disabled}
                  className="w-48"
                  onChange={(event) => onChange(key, { ...noun, plural: event.target.value })}
                />
              </div>
              {meta.hint ? <p className={mutedClass}>{meta.hint}</p> : null}
            </fieldset>
          )
        }

        if (meta.kind === 'categories') {
          return (
            <CategoriesEditor
              key={key}
              meta={meta}
              categories={value as { key: string; label: string }[]}
              disabled={disabled}
              onChange={(next) => onChange(key, next)}
            />
          )
        }

        if (meta.kind === 'examples') {
          return (
            <ExamplesEditor
              key={key}
              examples={value as Record<string, string>}
              flags={flags}
              disabled={disabled}
              onChange={(next) => onChange(key, next)}
            />
          )
        }

        const entries = value as BibleExampleEntry[]
        return (
          <fieldset key={key} className="flex flex-col gap-3">
            <legend className="text-[13px] font-medium text-[var(--color-text-secondary)]">
              {meta.label}
            </legend>
            {entries.length === 0 ? <p className={mutedClass}>None yet</p> : null}
            {entries.map((entry, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <textarea
                  aria-label={`${meta.label} ${i + 1} text`}
                  className={textareaClass}
                  value={entry.text}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      key,
                      entries.map((it, at) =>
                        at === i ? { ...it, text: event.target.value } : it,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`${meta.label} ${i + 1} note`}
                  value={entry.note}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      key,
                      entries.map((it, at) =>
                        at === i ? { ...it, note: event.target.value } : it,
                      ),
                    )
                  }
                />
                <Source entry={entry} />
                <FlagNote flags={flags} path={`${key}.${i}`} />
                <div>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`Remove ${meta.singular} ${i + 1}`}
                    onClick={() =>
                      onChange(
                        key,
                        entries.filter((_, at) => at !== i),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <div>
              <Button
                variant="outline"
                disabled={disabled || entries.length >= MAX_ENTRIES}
                aria-label={`Add ${meta.singular}`}
                onClick={() => onChange(key, [...entries, { text: '', note: '', drawnFrom: [] }])}
              >
                Add
              </Button>
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}

/** The case categories editor, moved here from the Channel tab. */
function CategoriesEditor({
  meta,
  categories,
  disabled,
  onChange,
}: {
  meta: FieldMeta
  categories: { key: string; label: string }[]
  disabled: boolean
  onChange: (next: { key: string; label: string }[]) => void
}) {
  const setCategory = (index: number, change: { key?: string; label?: string }) =>
    onChange(categories.map((entry, at) => (at === index ? { ...entry, ...change } : entry)))

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[13px] font-medium text-[var(--color-text-secondary)]">
        {meta.label}
      </legend>
      {meta.hint ? <p className={mutedClass}>{meta.hint}</p> : null}
      {categories.map((category, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={`Category ${index + 1} key`}
            value={category.key}
            disabled={disabled}
            className="w-40 font-mono"
            onChange={(event) => setCategory(index, { key: event.target.value })}
          />
          <Input
            aria-label={`Category ${index + 1} label`}
            value={category.label}
            disabled={disabled}
            className="w-56"
            onChange={(event) => setCategory(index, { label: event.target.value })}
          />
          <Button
            variant="ghost"
            disabled={disabled}
            aria-label={`Remove category ${index + 1}`}
            onClick={() => onChange(categories.filter((_, at) => at !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => onChange([...categories, { key: '', label: '' }])}
        >
          Add category
        </Button>
      </div>
    </fieldset>
  )
}
