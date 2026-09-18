import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Re-embeds direction-craft.md into direction-craft.ts (the decision 216
 * pattern): the markdown is the human-editable source, the constant is what
 * ships, and the unit test holds the two byte-identical. Run after every edit
 * to the markdown: pnpm --filter @boom-busters/providers embed:craft
 */
const prompts = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'prompts')
const markdown = readFileSync(join(prompts, 'direction-craft.md'), 'utf8').replace(/\r\n/g, '\n')
const source = readFileSync(join(prompts, 'direction-craft.ts'), 'utf8').replace(/\r\n/g, '\n')

const open = 'export const DIRECTION_CRAFT = `'
const start = source.indexOf(open) + open.length
const end = source.indexOf('\n`\n', start)
if (start < open.length || end === -1) {
  throw new Error('direction-craft.ts: could not find the DIRECTION_CRAFT literal')
}
if (markdown.includes('`') || markdown.includes('${')) {
  throw new Error('direction-craft.md: a backtick or ${ cannot be embedded verbatim')
}

writeFileSync(
  join(prompts, 'direction-craft.ts'),
  source.slice(0, start) + markdown.replace(/\n$/, '') + source.slice(end),
)
// eslint-disable-next-line no-console, no-undef -- a Node CLI script reporting its own status.
console.log('direction-craft.ts re-embedded from direction-craft.md')
