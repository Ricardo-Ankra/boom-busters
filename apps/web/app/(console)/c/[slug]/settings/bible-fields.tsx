'use client'

import {
  BIBLE_SECTIONS,
  ChannelBibleSchema,
  RUNTIME_OUTER_MAX,
  RUNTIME_OUTER_MIN,
  TITLE_SLOTS,
  defaultFormat,
} from '@boom-busters/schemas'
import type {
  BibleExampleEntry,
  BibleSection,
  ChannelBible,
  ChannelFormat,
  TooCloseFlags,
} from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input, Label, NumberInput, Select } from '@/components/ui/input'
import { BIBLE_TEXT_FIELDS } from '@/lib/bible-fields'
import { ExamplesEditor, ExamplesView } from './bible-examples'
import { KeywordWithReading } from './bible-measurements'
import type { KeywordReadings } from './bible-measurements'
import { FormatSearchSpace, SearchSpaceButton } from './bible-search-space'
import type { SearchSpaceView } from './bible-search-space'

/**
 * The bible's fields, edited and shown by kind: text in a textarea, a list of
 * strings one per line, the subject noun as two inputs, the case categories
 * as rows, the YouTube category as an input, examples one textarea per slot,
 * and hooks, openings and titles as entries (text and note editable, the
 * videos they were drawn from shown as read-only).
 */

type Kind =
  | 'text'
  | 'line'
  | 'lines'
  | 'noun'
  | 'categories'
  | 'category-id'
  | 'examples'
  | 'entries'
  | 'formats'

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
    hint: 'At least two. The key is lower-case letters, digits, dashes or underscores. Keywords are the phrases a pillar is searched by, comma separated.',
    kind: 'categories',
  },
  formats: {
    label: 'Formats',
    hint: 'One or more. Exactly one is primary: the format a case uses until it is given another.',
    kind: 'formats',
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
  channelHashtag: {
    label: 'Channel hashtag',
    hint: 'Letters and digits only, without the #. Optional.',
    kind: 'line',
  },
  channelFooter: {
    label: 'Channel footer',
    hint: 'Added to the end of every description. Optional.',
    kind: 'text',
  },
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

/** A pillar as the form edits it: its keywords are one comma-separated line. */
interface EditCategory {
  key: string
  label: string
  keywords: string
}

/** What a field holds while it is being edited. */
type FieldValue =
  | string
  | { singular: string; plural: string }
  | EditCategory[]
  | Record<string, string>
  | BibleExampleEntry[]
  | ChannelFormat[]

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
    else if (kind === 'text' || kind === 'line') values[key] = value as string
    else if (kind === 'categories') {
      values[key] = (value as ChannelBible['caseCategories']).map((category) => ({
        ...category,
        keywords: category.keywords.join(', '),
      }))
    } else values[key] = structuredClone(value) as FieldValue
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
    } else if (kind === 'categories') {
      patch[key] = (value as EditCategory[]).map((category) => ({
        key: category.key,
        label: category.label,
        keywords: splitKeywords(category.keywords),
      }))
    } else if (kind === 'formats') {
      patch[key] = (value as ChannelFormat[]).map((format) => ({
        ...format,
        keywords: format.keywords.map((keyword) => keyword.trim()).filter((k) => k !== ''),
      }))
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

function splitKeywords(line: string): string[] {
  return line
    .split(',')
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword !== '')
}

/** What the schema says is wrong with the form's new fields, by field path and as a list. */
export interface FormIssues {
  byPath: Record<string, string[]>
  /** Each message with where it is, for the save bar. */
  messages: string[]
}

export const NO_ISSUES: FormIssues = { byPath: {}, messages: [] }

function plainMessage(message: string): string {
  if (message.includes('expected int')) return 'Enter a whole number'
  if (message.includes('expected number')) return 'Enter a number'
  if (message.startsWith('Too small')) return 'This needs a value'
  return message
}

/**
 * The schema's verdict on the fields this editor adds: formats, the hashtag
 * and each pillar's keywords. The older fields keep the server's check on Done.
 */
export function sectionIssues(section: BibleSection, values: FormValues): FormIssues {
  const patch = formPatch(section, values)
  const mask = Object.fromEntries(Object.keys(patch).map((key) => [key, true])) as {
    [K in keyof ChannelBible]?: true
  }
  const parsed = ChannelBibleSchema.pick(mask).strict().safeParse(patch)
  if (parsed.success) return NO_ISSUES
  const formats = (patch.formats ?? []) as { name: string }[]
  const categories = (patch.caseCategories ?? []) as { label: string }[]
  const issues: FormIssues = { byPath: {}, messages: [] }
  for (const issue of parsed.error.issues) {
    const [head, index, field] = issue.path
    const message = plainMessage(issue.message)
    let where: string
    if (head === 'formats') {
      where = typeof index === 'number' ? `Format ${formats[index]?.name ?? index + 1}` : 'Formats'
    } else if (head === 'channelHashtag') {
      where = 'Channel hashtag'
    } else if (head === 'caseCategories' && field === 'keywords') {
      const at = index as number
      where = `Keywords of ${categories[at]?.label || `category ${at + 1}`}`
    } else continue
    const path = issue.path.join('.')
    issues.byPath[path] = [...(issues.byPath[path] ?? []), message]
    const line = `${where}: ${message}`
    if (!issues.messages.includes(line)) issues.messages.push(line)
  }
  return issues
}

/** The messages at a field path, or under it. */
function issuesAt(issues: FormIssues, path: string): string[] {
  return Object.entries(issues.byPath)
    .filter(([at]) => at === path || at.startsWith(`${path}.`))
    .flatMap(([, messages]) => messages)
}

function FieldIssues({ messages }: { messages: string[] }) {
  return (
    <>
      {messages.map((message) => (
        <p key={message} role="alert" className="text-[13px] text-[var(--color-danger)]">
          {message}
        </p>
      ))}
    </>
  )
}

export const textareaClass =
  'min-h-24 w-full rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] ' +
  'px-3 py-2 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

/** The most hooks, openings or titles a bible holds (the schema's limit). */
const MAX_ENTRIES = 12

/** The most formats, and keywords on one format (the schema's limits). */
const MAX_FORMATS = 6
const MAX_FORMAT_KEYWORDS = 6

const NO_READINGS: KeywordReadings = {}

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
  readings = NO_READINGS,
  space,
  pace,
}: {
  section: BibleSection
  bible: ChannelBible
  flags: TooCloseFlags
  disabled: boolean
  onDraftSlot: (slotId: string) => void
  /** The latest VidIQ reading of each keyword, by lower-cased keyword. */
  readings?: KeywordReadings
  /** Each format's search-space readings and the Analyse button; absent shows neither. */
  space?: SearchSpaceView
  /** The channel voice's measured pace; null reads "Not measured yet", absent shows nothing. */
  pace?: MeasuredPaceView | null
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
        if (meta.kind === 'formats') {
          return (
            <FormatsView
              key={key}
              formats={bible.formats}
              readings={readings}
              {...(space ? { space } : {})}
              {...(pace !== undefined ? { pace } : {})}
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
              <ValueView kind={meta.kind} value={value} readings={readings} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ValueView({
  kind,
  value,
  readings,
}: {
  kind: Kind
  value: unknown
  readings: KeywordReadings
}) {
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
    const categories = value as ChannelBible['caseCategories']
    return categories.length === 0 ? (
      none
    ) : (
      <ul className="list-disc pl-5 text-[14px]">
        {categories.map((category, i) => (
          <li key={i}>
            <span className="font-mono">{category.key}</span>: {category.label}
            {category.keywords.length > 0 ? (
              <ul className="mt-0.5 flex list-none flex-col gap-0.5 pl-3">
                {category.keywords.map((keyword) => (
                  <li key={keyword}>
                    <KeywordWithReading keyword={keyword} readings={readings} />
                  </li>
                ))}
              </ul>
            ) : null}
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
  issues = NO_ISSUES,
  disabled,
  onChange,
}: {
  section: BibleSection
  values: FormValues
  flags: TooCloseFlags
  /** What the schema says is wrong with the form as it stands. */
  issues?: FormIssues
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
              <FieldIssues messages={issuesAt(issues, key)} />
            </div>
          )
        }

        if (meta.kind === 'line') {
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={fieldId}>{meta.label}</Label>
              <Input
                id={fieldId}
                value={String(value)}
                disabled={disabled}
                className="w-64"
                aria-invalid={issuesAt(issues, key).length > 0}
                onChange={(event) => onChange(key, event.target.value)}
              />
              {meta.hint ? <p className={mutedClass}>{meta.hint}</p> : null}
              <FieldIssues messages={issuesAt(issues, key)} />
            </div>
          )
        }

        if (meta.kind === 'formats') {
          return (
            <FormatsEditor
              key={key}
              meta={meta}
              formats={value as ChannelFormat[]}
              issues={issues}
              disabled={disabled}
              onChange={(next) => onChange(key, next)}
            />
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
              categories={value as EditCategory[]}
              issues={issues}
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
  issues,
  disabled,
  onChange,
}: {
  meta: FieldMeta
  categories: EditCategory[]
  issues: FormIssues
  disabled: boolean
  onChange: (next: EditCategory[]) => void
}) {
  const setCategory = (index: number, change: Partial<EditCategory>) =>
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
          <Input
            aria-label={`Category ${index + 1} keywords`}
            placeholder="Keywords, comma separated"
            value={category.keywords}
            disabled={disabled}
            className="w-80"
            onChange={(event) => setCategory(index, { keywords: event.target.value })}
          />
          <Button
            variant="ghost"
            disabled={disabled}
            aria-label={`Remove category ${index + 1}`}
            onClick={() => onChange(categories.filter((_, at) => at !== index))}
          >
            Remove
          </Button>
          <div className="basis-full">
            <FieldIssues messages={issuesAt(issues, `caseCategories.${index}.keywords`)} />
          </div>
        </div>
      ))}
      <div>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => onChange([...categories, { key: '', label: '', keywords: '' }])}
        >
          Add category
        </Button>
      </div>
    </fieldset>
  )
}

const INTENT_LABELS = { tension: 'Builds tension', calm: 'Calm' } as const

/** A key no other format uses, in the schema's slug shape. */
function freeFormatKey(formats: ChannelFormat[]): string {
  const taken = new Set(formats.map((format) => format.key))
  let n = formats.length + 1
  while (taken.has(`format-${n}`)) n += 1
  return `format-${n}`
}

/** The formats, one card each, with the buttons that add, remove and move the primary. */
function FormatsEditor({
  meta,
  formats,
  issues,
  disabled,
  onChange,
}: {
  meta: FieldMeta
  formats: ChannelFormat[]
  issues: FormIssues
  disabled: boolean
  onChange: (next: ChannelFormat[]) => void
}) {
  const id = React.useId()
  const [refusal, setRefusal] = React.useState('')

  const setFormat = (index: number, change: Partial<ChannelFormat>) =>
    onChange(formats.map((format, at) => (at === index ? { ...format, ...change } : format)))
  const number = (raw: string) => (raw === '' ? Number.NaN : Number(raw))
  const shown = (n: number) => (Number.isNaN(n) ? '' : n)

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-[13px] font-medium text-[var(--color-text-secondary)]">
        {meta.label}
      </legend>
      {meta.hint ? <p className={mutedClass}>{meta.hint}</p> : null}
      <FieldIssues messages={issues.byPath['formats'] ?? []} />
      {formats.map((format, index) => {
        const at = `${id}-${format.key}`
        const path = `formats.${index}`
        return (
          <fieldset
            key={format.key}
            className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] p-3"
          >
            <legend className="px-1 text-[14px] font-medium">{format.name}</legend>
            <div className="flex flex-wrap items-center gap-2">
              {format.primary ? (
                <span className="rounded-[6px] border border-[var(--color-accent)] px-2 py-0.5 text-[12px] text-[var(--color-text-primary)]">
                  Primary
                </span>
              ) : (
                <Button
                  variant="outline"
                  disabled={disabled}
                  aria-label={`Make ${format.name} primary`}
                  onClick={() => {
                    setRefusal('')
                    onChange(formats.map((f, i) => ({ ...f, primary: i === index })))
                  }}
                >
                  Make primary
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={disabled}
                aria-label={`Remove format ${index + 1}`}
                onClick={() => {
                  if (format.primary) {
                    setRefusal('Make another format primary first')
                    return
                  }
                  setRefusal('')
                  onChange(formats.filter((_, i) => i !== index))
                }}
              >
                Remove format
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${at}-name`}>Format name</Label>
              <Input
                id={`${at}-name`}
                value={format.name}
                disabled={disabled}
                className="w-64"
                onChange={(event) => setFormat(index, { name: event.target.value })}
              />
              <FieldIssues messages={issuesAt(issues, `${path}.name`)} />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-[13px] font-medium text-[var(--color-text-secondary)]">
                Keywords (lead first)
              </legend>
              <p className={mutedClass}>
                The first keyword leads the titles. The rest go to the description and tags.
              </p>
              {format.keywords.map((keyword, k) => (
                <div key={k} className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`Keyword ${k + 1}`}
                    value={keyword}
                    disabled={disabled}
                    className="w-80"
                    onChange={(event) =>
                      setFormat(index, {
                        keywords: format.keywords.map((it, i) =>
                          i === k ? event.target.value : it,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`Remove keyword ${k + 1}`}
                    onClick={() =>
                      setFormat(index, { keywords: format.keywords.filter((_, i) => i !== k) })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <FieldIssues messages={issuesAt(issues, `${path}.keywords`)} />
              <div>
                <Button
                  variant="outline"
                  disabled={disabled || format.keywords.length >= MAX_FORMAT_KEYWORDS}
                  onClick={() => setFormat(index, { keywords: [...format.keywords, ''] })}
                >
                  Add keyword
                </Button>
              </div>
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${at}-intent`}>Intent</Label>
              <Select
                id={`${at}-intent`}
                value={format.intent}
                disabled={disabled}
                className="w-48"
                onChange={(event) =>
                  setFormat(index, { intent: event.target.value as ChannelFormat['intent'] })
                }
              >
                {(Object.keys(INTENT_LABELS) as (keyof typeof INTENT_LABELS)[]).map((intent) => (
                  <option key={intent} value={intent}>
                    {INTENT_LABELS[intent]}
                  </option>
                ))}
              </Select>
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[13px] font-medium text-[var(--color-text-secondary)]">
                Length in minutes
              </legend>
              <div className="flex flex-wrap gap-3">
                {(
                  [
                    ['default', 'Default'],
                    ['min', 'Shortest'],
                    ['max', 'Longest'],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field} className="flex flex-col gap-1.5">
                    <Label htmlFor={`${at}-${field}`}>{label}</Label>
                    <NumberInput
                      id={`${at}-${field}`}
                      min={RUNTIME_OUTER_MIN}
                      max={RUNTIME_OUTER_MAX}
                      step={1}
                      value={shown(format.runtime[field])}
                      disabled={disabled}
                      className="w-28"
                      onChange={(event) =>
                        setFormat(index, {
                          runtime: { ...format.runtime, [field]: number(event.target.value) },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              <FieldIssues messages={issuesAt(issues, `${path}.runtime`)} />
            </fieldset>

            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${at}-wpm`}>Narration pace (words a minute)</Label>
                <NumberInput
                  id={`${at}-wpm`}
                  min={80}
                  max={200}
                  step={1}
                  value={shown(format.wordsPerMinute)}
                  disabled={disabled}
                  className="w-28"
                  onChange={(event) =>
                    setFormat(index, { wordsPerMinute: number(event.target.value) })
                  }
                />
                <FieldIssues messages={issuesAt(issues, `${path}.wordsPerMinute`)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${at}-hold`}>Picture pace (hold multiplier)</Label>
                <NumberInput
                  id={`${at}-hold`}
                  min={1}
                  max={4}
                  step={0.5}
                  value={shown(format.shotHold)}
                  disabled={disabled}
                  className="w-28"
                  onChange={(event) => setFormat(index, { shotHold: number(event.target.value) })}
                />
                <FieldIssues messages={issuesAt(issues, `${path}.shotHold`)} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${at}-title`}>Title pattern</Label>
              <Input
                id={`${at}-title`}
                value={format.titleTemplate}
                disabled={disabled}
                onChange={(event) => setFormat(index, { titleTemplate: event.target.value })}
              />
              <p className={mutedClass}>
                Name the pieces as {TITLE_SLOTS.map((slot) => `{${slot}}`).join(' ')}. Optional.
              </p>
              <FieldIssues messages={issuesAt(issues, `${path}.titleTemplate`)} />
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[13px] font-medium text-[var(--color-text-secondary)]">
                Required in every title
              </legend>
              <div className="flex flex-wrap gap-4">
                {TITLE_SLOTS.map((slot) => (
                  <label key={slot} className="flex items-center gap-2 text-[14px]">
                    <input
                      type="checkbox"
                      checked={format.titleRequiredSlots.includes(slot)}
                      disabled={disabled}
                      onChange={(event) =>
                        setFormat(index, {
                          titleRequiredSlots: TITLE_SLOTS.filter((s) =>
                            s === slot
                              ? event.target.checked
                              : format.titleRequiredSlots.includes(s),
                          ),
                        })
                      }
                    />
                    {slot}
                  </label>
                ))}
              </div>
              <FieldIssues messages={issuesAt(issues, `${path}.titleRequiredSlots`)} />
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${at}-intro`}>Intro rule</Label>
              <textarea
                id={`${at}-intro`}
                className={textareaClass}
                value={format.introRule}
                disabled={disabled}
                onChange={(event) => setFormat(index, { introRule: event.target.value })}
              />
              <FieldIssues messages={issuesAt(issues, `${path}.introRule`)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${at}-intro-line`}>Fixed opening line</Label>
              <textarea
                id={`${at}-intro-line`}
                className={textareaClass}
                value={format.introLine}
                disabled={disabled}
                onChange={(event) => setFormat(index, { introLine: event.target.value })}
              />
              <FieldIssues messages={issuesAt(issues, `${path}.introLine`)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${at}-outro-line`}>Fixed closing line</Label>
              <textarea
                id={`${at}-outro-line`}
                className={textareaClass}
                value={format.outroLine}
                disabled={disabled}
                onChange={(event) => setFormat(index, { outroLine: event.target.value })}
              />
              <FieldIssues messages={issuesAt(issues, `${path}.outroLine`)} />
            </div>
          </fieldset>
        )
      })}
      {refusal ? (
        <p role="alert" className="text-[13px] text-[var(--color-danger)]">
          {refusal}
        </p>
      ) : null}
      <div>
        <Button
          variant="outline"
          disabled={disabled || formats.length >= MAX_FORMATS}
          onClick={() => {
            setRefusal('')
            onChange([
              ...formats,
              { ...defaultFormat('New format'), key: freeFormatKey(formats), primary: false },
            ])
          }}
        >
          Add format
        </Button>
      </div>
    </fieldset>
  )
}

/** The pace the channel's voice measured at, from its recent takes. */
export interface MeasuredPaceView {
  wordsPerMinute: number
  takes: number
}

/** The formats, read-only: each with its keywords, length, pace, title and lines. */
function FormatsView({
  formats,
  readings,
  space,
  pace,
}: {
  formats: ChannelFormat[]
  readings: KeywordReadings
  space?: SearchSpaceView
  pace?: MeasuredPaceView | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">Formats</span>
      {formats.map((format) => {
        const rows: [string, string][] = [
          ['Intent', INTENT_LABELS[format.intent]],
          [
            'Length',
            `${format.runtime.default} min (${format.runtime.min} to ${format.runtime.max})`,
          ],
          ['Narration pace', `${format.wordsPerMinute} words a minute`],
          ['Picture pace', `${format.shotHold}x`],
          ['Title pattern', format.titleTemplate],
          ['Required in every title', format.titleRequiredSlots.join(', ')],
          ['Intro rule', format.introRule],
          ['Fixed opening line', format.introLine],
          ['Fixed closing line', format.outroLine],
        ]
        return (
          <div
            key={format.key}
            className="flex flex-col gap-1 rounded-[8px] border border-[var(--color-border)] p-3"
          >
            <p className="text-[14px] font-medium">
              {format.name}
              {format.primary ? <span className={`${mutedClass} ml-2`}>Primary</span> : null}
            </p>
            {format.keywords.length > 0 ? (
              <div className="flex flex-col gap-0.5 text-[13px]">
                <span className="text-[var(--color-text-secondary)]">Keywords:</span>
                <ul className="flex list-none flex-col gap-0.5 pl-3">
                  {format.keywords.map((keyword, k) => (
                    <li key={k}>
                      <KeywordWithReading keyword={keyword} readings={readings} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {rows.map(([label, text]) =>
              text === '' ? null : (
                <p key={label} className="text-[13px]">
                  <span className="text-[var(--color-text-secondary)]">{label}: </span>
                  <span className="whitespace-pre-wrap">{text}</span>
                </p>
              ),
            )}
            {pace !== undefined ? (
              <p className="text-[13px]">
                {pace === null
                  ? 'Not measured yet'
                  : `Your voice's measured pace: ${pace.wordsPerMinute} words a minute, from ${pace.takes} ${pace.takes === 1 ? 'take' : 'takes'}`}
              </p>
            ) : null}
            {space ? (
              <>
                <FormatSearchSpace keywords={format.keywords} readings={space.readings} />
                <div>
                  <SearchSpaceButton
                    count={space.counts[format.key] ?? 0}
                    disabled={space.disabled}
                    unavailable={!space.ready}
                    onAnalyse={() => space.onAnalyse(format.key)}
                  />
                </div>
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
