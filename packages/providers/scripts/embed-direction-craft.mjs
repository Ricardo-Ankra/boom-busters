import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Re-embeds direction-craft.md into direction-craft.ts and script-craft.md
 * into script-craft.ts (the decision 216 pattern): the markdown is the
 * human-editable source, the constant is what ships, and the unit tests hold
 * each pair byte-identical. Run after every edit to either markdown:
 * pnpm --filter @boom-busters/providers embed:craft
 */
const prompts = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'prompts')

const CRAFTS = [
  { name: 'direction-craft', constant: 'DIRECTION_CRAFT' },
  { name: 'script-craft', constant: 'SCRIPT_CRAFT' },
]

for (const { name, constant } of CRAFTS) {
  const markdown = readFileSync(join(prompts, `${name}.md`), 'utf8').replace(/\r\n/g, '\n')
  const source = readFileSync(join(prompts, `${name}.ts`), 'utf8').replace(/\r\n/g, '\n')

  const open = `export const ${constant} = \``
  const start = source.indexOf(open) + open.length
  const end = source.indexOf('\n`\n', start)
  if (start < open.length || end === -1) {
    throw new Error(`${name}.ts: could not find the ${constant} literal`)
  }
  if (markdown.includes('`') || markdown.includes('${')) {
    throw new Error(`${name}.md: a backtick or \${ cannot be embedded verbatim`)
  }

  writeFileSync(
    join(prompts, `${name}.ts`),
    source.slice(0, start) + markdown.replace(/\n$/, '') + source.slice(end),
  )
  // eslint-disable-next-line no-console, no-undef -- a Node CLI script reporting its own status.
  console.log(`${name}.ts re-embedded from ${name}.md`)
}
