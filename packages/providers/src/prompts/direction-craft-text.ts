import type { BibleInUse, ChannelBible } from '@boom-busters/schemas'
import { channelRulesBlock, literalBibleText } from './bible'
import { DIRECTION_CRAFT } from './direction-craft'

/** Where direction-craft.md puts the channel's visual register: one line that stands for its whole bullet. */
const REGISTER_TOKEN = '- {{visualRegister}}\n'

/** The widest a wrapped line of the Register bullet may be, its `- ` or indent included. */
const REGISTER_WIDTH = 75

/**
 * The Register bullet of the house look, as direction-craft.md prints it: the
 * stored `visualRegister` is one line, the markdown wraps its bullet at 75
 * characters with a two-space indent on the continuation lines. A greedy wrap
 * reproduces the first channel's bullet byte for byte (the lift fixtures hold
 * it). An empty register has no bullet at all.
 */
export function registerBullet(visualRegister: string): string {
  const words = visualRegister.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const lines: string[] = []
  let line = '- Register:'
  for (const word of words) {
    if (line.length + 1 + word.length > REGISTER_WIDTH) {
      lines.push(line)
      line = `  ${word}`
    } else {
      line += ` ${word}`
    }
  }
  lines.push(line)
  return `${lines.join('\n')}\n`
}

/**
 * The craft text with this channel's register in it. Its example slots are
 * left for the caller's one `fillSlots` over the composed prompt; the register
 * is owner-typed, so it goes in protected from that pass.
 */
export function directionCraft(bible: ChannelBible): string {
  return DIRECTION_CRAFT.replace(REGISTER_TOKEN, () =>
    literalBibleText(registerBullet(bible.visualRegister)),
  )
}

/** The channel's own direction rules, protected so `fillSlots` leaves their text as typed. */
export function directionRules(inUse: BibleInUse): string {
  return literalBibleText(channelRulesBlock(inUse.bible, 'direction'))
}
