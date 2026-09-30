#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { compareHtml } from '@/lib/live-compare'
import type { PlanRunRecord } from '@/lib/live-compare'

const [beforeDir, afterDir] = process.argv.slice(2)
if (!beforeDir || !afterDir) {
  console.error('Usage: live:compare <before run folder> <after run folder>')
  process.exit(1)
}
const read = (dir: string) =>
  JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')) as PlanRunRecord
const out = path.join(afterDir, 'compare.html')
writeFileSync(out, compareHtml(read(beforeDir), read(afterDir), beforeDir, afterDir))
console.log(out)
