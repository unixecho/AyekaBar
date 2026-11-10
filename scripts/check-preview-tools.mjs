import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/dashboard/preview-tools.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { normalizeToolText, rankPreviewTools, completePreviewTool, parsePreviewUsage, recordPreviewUse } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`)
const tiles = [
  { id: 'schedule', he: 'ניהול סידור עבודה', hint: 'שיבוץ ופרסום' },
  { id: 'editor', he: 'תפריט', hint: 'עריכה ופרסום' },
  { id: 'staff', he: 'ניהול צוות', hint: 'הוספה והרשאות' },
]
const now = 1_800_000_000_000

assert.equal(normalizeToolText('מִשְׁמָרוֹת'), normalizeToolText('משמרות'))
assert.equal(rankPreviewTools(tiles, {}, 'תפר')[0].id, 'editor')
assert.equal(rankPreviewTools(tiles, {}, 'menu')[0].id, 'editor')
assert.equal(rankPreviewTools(tiles, {}, 'בסידור')[0].id, 'schedule')
assert.equal(rankPreviewTools(tiles, {}, 'תפרט')[0].id, 'editor')
assert.equal(completePreviewTool(tiles, 'תפר'), 'תפריט')
assert.equal(completePreviewTool(tiles, 'צוות'), null)

let usage = {}
for (let n = 0; n < 4; n++) usage = recordPreviewUse(usage, 'staff', now)
assert.equal(rankPreviewTools(tiles, usage, '', now)[0].id, 'staff')
assert.equal(rankPreviewTools(tiles, {}, '', now)[0].id, 'schedule')
assert.deepEqual(parsePreviewUsage(JSON.stringify({ staff: usage.staff, forbidden: { n: 99, t: now } }), new Set(['staff'])), usage)
assert.deepEqual(parsePreviewUsage('{broken', new Set(['staff'])), {})
console.log('Preview tool search, completion, ranking, and account filtering passed')
