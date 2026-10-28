import type { ChannelBible } from './channels'

/**
 * One worked example a prompt takes from the channel's bible. The slot
 * registry is the list of every such place; a channel's bible carries one
 * entry per slot, and a bible with a slot unfilled is incomplete.
 */
export interface ExampleSlot {
  /** Kebab-case, prefixed with its source: `script-`, `direction-` and so on. */
  id: string
  /** Where the prompt that takes it lives. */
  source: string
  /** What the example is there to teach the model. */
  teaches: string
  kind: 'line' | 'passage' | 'worked'
  maxLength: number
}

/** The slots the lifted prompts read. Filled in as each prompt is lifted. */
export const EXAMPLE_SLOTS: readonly ExampleSlot[] = []

export const EXAMPLE_SLOT_IDS: readonly string[] = EXAMPLE_SLOTS.map((slot) => slot.id)

export const MAX_EXAMPLE_SLOTS = 40

/** A bible together with the slot ids it is to be judged against. */
export interface BibleInUse {
  bible: ChannelBible
  slotIds: readonly string[]
}
