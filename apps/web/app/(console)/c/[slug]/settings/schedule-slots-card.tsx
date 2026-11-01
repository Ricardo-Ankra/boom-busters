'use client'

import type { ScheduleSlot, Settings, SettingsPatch } from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import {
  clashes,
  currentOffsetMinutes,
  nextFreeSlot,
  offsetLabel,
  slotFromLocal,
  slotToLocal,
} from '@/lib/schedule-slots'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The schema's cap on default slots: three a day across the week. */
const MAX_SLOTS = 21

const CLASH_MESSAGE = 'Another slot already sits at that day and time.'

/** Nothing to subscribe to: the offset is read once per render. */
const subscribe = () => () => {}

/**
 * The default slots the publish screen and the Calendar offer, edited in the
 * owner's timezone and stored as UTC. The server renders UTC (it has no idea
 * where the owner is); the client swaps in the browser's offset on hydration,
 * which is why the rows are keyed by the offset as well as the slot.
 */
export function ScheduleSlotsCard({
  settings,
  saving,
  commit,
}: {
  settings: Settings
  saving: boolean
  commit: (patch: SettingsPatch, optimistic: Settings) => Promise<void>
}) {
  const { toast } = useToast()
  const offset = React.useSyncExternalStore(
    subscribe,
    () => currentOffsetMinutes(),
    () => 0,
  )
  const slots = settings.publish.defaultScheduleSlots

  const save = (nextSlots: ScheduleSlot[]) => {
    const next = structuredClone(settings)
    next.publish.defaultScheduleSlots = nextSlots
    void commit({ publish: { ...next.publish } }, next)
  }

  /** Swaps one slot for its edited form, refusing a second slot at one moment. */
  const replace = (index: number, slot: ScheduleSlot): boolean => {
    if (clashes(slots, slot, index)) {
      toast({ title: 'Could not save', description: CLASH_MESSAGE, variant: 'error' })
      return false
    }
    save(slots.map((existing, at) => (at === index ? slot : existing)))
    return true
  }

  const add = (kind: ScheduleSlot['kind']) => {
    const slot = nextFreeSlot(kind, slots)
    if (slot) save([...slots, slot])
  }

  const full = slots.length >= MAX_SLOTS

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default schedule slots</CardTitle>
        <CardDescription>
          The times the publish screen and the Calendar offer for each video and Short. Set in your
          timezone ({offsetLabel(offset)}) and stored as UTC, shown beside each slot.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {slots.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            No default slots. The publish screen still takes a custom time for each item.
          </p>
        ) : null}
        {slots.map((slot, index) => {
          const local = slotToLocal(slot, offset)
          const number = index + 1
          return (
            <div
              key={`${index}-${slot.kind}-${slot.weekday}-${slot.timeUtc}-${offset}`}
              role="group"
              aria-label={`Slot ${number}`}
              className="flex flex-wrap items-center gap-2 text-[14px]"
            >
              <Select
                aria-label={`Slot ${number} format`}
                className="w-32"
                value={slot.kind}
                disabled={saving}
                onChange={(event) =>
                  replace(index, { ...slot, kind: event.target.value as ScheduleSlot['kind'] })
                }
              >
                <option value="longform">Long-form</option>
                <option value="short">Short</option>
              </Select>
              <Select
                aria-label={`Slot ${number} day`}
                className="w-36"
                value={String(local.weekday)}
                disabled={saving}
                onChange={(event) =>
                  replace(
                    index,
                    slotFromLocal(slot.kind, Number(event.target.value), local.time, offset),
                  )
                }
              >
                {WEEKDAYS.map((name, weekday) => (
                  <option key={name} value={weekday}>
                    {name}
                  </option>
                ))}
              </Select>
              {/* Saved on blur, not on change: a time input reports a new
                  valid value at every keystroke once both fields are filled,
                  and each would be a save and a toast. */}
              <Input
                type="time"
                aria-label={`Slot ${number} time`}
                className="w-32 font-mono tabular-nums"
                defaultValue={local.time}
                disabled={saving}
                onBlur={(event) => {
                  const value = event.currentTarget.value
                  if (!value || value === local.time) return
                  const input = event.currentTarget
                  if (!replace(index, slotFromLocal(slot.kind, local.weekday, value, offset))) {
                    input.value = local.time
                  }
                }}
              />
              <span className="font-mono text-[12px] text-[var(--color-text-muted)] tabular-nums">
                {WEEKDAYS[slot.weekday]?.slice(0, 3)} {slot.timeUtc} UTC
              </span>
              <Button
                variant="ghost"
                aria-label={`Remove slot ${number}`}
                disabled={saving}
                onClick={() => save(slots.filter((_, at) => at !== index))}
              >
                Remove
              </Button>
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={saving || full} onClick={() => add('longform')}>
            Add long-form slot
          </Button>
          <Button disabled={saving || full} onClick={() => add('short')}>
            Add Short slot
          </Button>
          {full ? (
            <span className="text-[13px] text-[var(--color-text-muted)]">
              {MAX_SLOTS} slots is the most a channel keeps.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
