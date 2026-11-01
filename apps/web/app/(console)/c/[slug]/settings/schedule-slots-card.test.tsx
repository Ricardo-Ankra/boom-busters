import { DEFAULT_SETTINGS, type ScheduleSlot, type Settings } from '@boom-busters/schemas'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ScheduleSlotsModule from '@/lib/schedule-slots'
import { ScheduleSlotsCard } from './schedule-slots-card'

/**
 * Editing the default schedule slots in the owner's timezone. The browser's
 * offset is pinned to UTC+2 so the conversions read the same on any machine;
 * the conversion maths itself is covered in `lib/schedule-slots.test.ts`.
 */

vi.mock('@/lib/schedule-slots', async (importOriginal) => ({
  ...(await importOriginal<typeof ScheduleSlotsModule>()),
  currentOffsetMinutes: () => 120,
}))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const commit = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  commit.mockResolvedValue(undefined)
})

function withSlots(slots: ScheduleSlot[]): Settings {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.publish.defaultScheduleSlots = slots
  return settings
}

function renderCard(slots: ScheduleSlot[]) {
  return render(<ScheduleSlotsCard settings={withSlots(slots)} saving={false} commit={commit} />)
}

/** The slot list the last save sent. */
function savedSlots(): ScheduleSlot[] {
  const [patch] = commit.mock.calls.at(-1) as [{ publish: Settings['publish'] }]
  return patch.publish.defaultScheduleSlots
}

const FRIDAY_LONGFORM: ScheduleSlot = { kind: 'longform', weekday: 5, timeUtc: '15:00' }
const WEDNESDAY_SHORT: ScheduleSlot = { kind: 'short', weekday: 3, timeUtc: '16:00' }

describe('the default schedule slots editor', () => {
  it('shows each slot in the owner timezone with its stored UTC beside it', () => {
    renderCard([FRIDAY_LONGFORM])

    expect((screen.getByLabelText('Slot 1 format') as HTMLSelectElement).value).toBe('longform')
    expect((screen.getByLabelText('Slot 1 day') as HTMLSelectElement).value).toBe('5')
    expect((screen.getByLabelText('Slot 1 time') as HTMLInputElement).value).toBe('17:00')
    expect(screen.getByText('Fri 15:00 UTC')).toBeInTheDocument()
    expect(screen.getByText(/your timezone \(UTC\+2\)/)).toBeInTheDocument()
  })

  it('stores a new local time as UTC when the field loses focus', () => {
    renderCard([FRIDAY_LONGFORM])

    const time = screen.getByLabelText('Slot 1 time')
    fireEvent.change(time, { target: { value: '18:30' } })
    expect(commit).not.toHaveBeenCalled()
    fireEvent.blur(time)

    expect(savedSlots()).toEqual([{ kind: 'longform', weekday: 5, timeUtc: '16:30' }])
  })

  it('moves the UTC day back when a local time falls before 02:00', () => {
    renderCard([FRIDAY_LONGFORM])

    const time = screen.getByLabelText('Slot 1 time')
    fireEvent.change(time, { target: { value: '01:00' } })
    fireEvent.blur(time)

    expect(savedSlots()).toEqual([{ kind: 'longform', weekday: 4, timeUtc: '23:00' }])
  })

  it('changes the day and the format', async () => {
    const user = userEvent.setup()
    renderCard([FRIDAY_LONGFORM])

    await user.selectOptions(screen.getByLabelText('Slot 1 day'), 'Tuesday')
    expect(savedSlots()).toEqual([{ kind: 'longform', weekday: 2, timeUtc: '15:00' }])

    await user.selectOptions(screen.getByLabelText('Slot 1 format'), 'Short')
    expect(savedSlots()).toEqual([{ kind: 'short', weekday: 5, timeUtc: '15:00' }])
  })

  it('adds a slot of each format at the next free time and removes one', async () => {
    const user = userEvent.setup()
    renderCard([FRIDAY_LONGFORM, WEDNESDAY_SHORT])

    await user.click(screen.getByRole('button', { name: 'Add Short slot' }))
    expect(savedSlots()).toEqual([
      FRIDAY_LONGFORM,
      WEDNESDAY_SHORT,
      { kind: 'short', weekday: 4, timeUtc: '16:00' },
    ])

    await user.click(screen.getByRole('button', { name: 'Add long-form slot' }))
    expect(savedSlots().at(-1)).toEqual({ kind: 'longform', weekday: 6, timeUtc: '15:00' })

    await user.click(screen.getByRole('button', { name: 'Remove slot 1' }))
    expect(savedSlots()).toEqual([WEDNESDAY_SHORT])
  })

  it('refuses a second slot at the same moment and puts the time back', () => {
    // A Friday Short an hour after the Friday long-form, then moved onto it.
    renderCard([FRIDAY_LONGFORM, { kind: 'short', weekday: 5, timeUtc: '16:00' }])

    const time = screen.getByLabelText('Slot 2 time') as HTMLInputElement
    expect(time.value).toBe('18:00')
    fireEvent.change(time, { target: { value: '17:00' } })
    fireEvent.blur(time)

    expect(commit).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
    expect(time.value).toBe('18:00')
  })

  it('says so when there are no slots', () => {
    renderCard([])
    expect(screen.getByText(/No default slots/)).toBeInTheDocument()
  })

  it('stops adding at 21 slots', () => {
    const full = Array.from({ length: 21 }, (_, at) => ({
      kind: 'short' as const,
      weekday: at % 7,
      timeUtc: `${String(10 + Math.floor(at / 7)).padStart(2, '0')}:00`,
    }))
    renderCard(full)
    expect(screen.getByRole('button', { name: 'Add Short slot' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add long-form slot' })).toBeDisabled()
  })
})
