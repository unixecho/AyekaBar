#!/usr/bin/env node
// Logic + wiring harness for the PAYSLIP library (2026-10-14; migration 060).
//
//   node scripts/check-payslips.mjs
//
// Same shape and reasoning as check-cart.mjs / check-remote-ordering.mjs: the rules are pure functions, so this runs the
// REAL TypeScript (transpiled on the fly), not a copy of it. It also reads the routes and pages as text and holds them
// to what their headers promise — because the claims that matter most here are structural ("an employee's request can
// never name someone else's payslip", "the ZIP is streamed, one file in memory at a time").
//
// WHAT IT GUARDS
//   • THE ACCESS RULE (canReadPayslip), exhaustively — owner reads any live payslip; anyone else only their own;
//     a removed payslip is gone for everyone;
//   • THE ZIP WRITER, proved by an INDEPENDENT reader: the operating system's own `tar`/`unzip` extracts what it wrote,
//     byte for byte, with Hebrew names — plus CRC-32 against zlib's, laziness (it really streams), and zip-slip refusals;
//   • every number in rules.ts against the SQL text of migration 060 (one rule spelled twice — the
//     lib/staff/access.ts ↔ is_op() lesson);
//   • reading "who / which month" off a file name, including the cases that must yield NOTHING rather than a guess;
//   • the file checks (magic bytes, size), name cleaning, the Content-Disposition header.
//
// What the database does (closed tables, append-only log, grants) is proved by check-migration-059-060.mjs.

import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import zlib from 'node:zlib'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const outDir = join(tmpdir(), `ayeka-payslips-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })

function emit(rel, outName) {
  const js = ts.transpileModule(read(rel), {
    fileName: outName.replace(/\.mjs$/, '.ts'),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText
  writeFileSync(join(outDir, outName), js)
}
emit('src/lib/payslips/rules.ts', 'rules.mjs')
emit('src/lib/payslips/zip.ts', 'zip.mjs')
const load = (name) => import(pathToFileURL(join(outDir, name)).href)
const R = await load('rules.mjs')
const Z = await load('zip.mjs')

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1')
const code = (p) => strip(read(p))
const HEBREW = /[֐-׿]/

// ───────────────────────────────────────────────────────────────────────────
section('canReadPayslip — the ONE access rule')
{
  const ME = '11111111-1111-4111-8111-111111111111'
  const YOU = '22222222-2222-4222-8222-222222222222'
  const live = (s) => ({ staff_id: s, removed_at: null })
  const gone = (s) => ({ staff_id: s, removed_at: '2026-10-01T00:00:00Z' })
  const emp = { staffId: ME, isOp: false }
  const owner = { staffId: YOU, isOp: true }
  check('an employee reads their OWN live payslip', R.canReadPayslip(emp, live(ME)) === true)
  check('…and NOT anyone else’s', R.canReadPayslip(emp, live(YOU)) === false)
  check('the owner reads anyone’s live payslip', R.canReadPayslip(owner, live(ME)) === true && R.canReadPayslip(owner, live(YOU)) === true)
  check('a REMOVED payslip is gone for the employee', R.canReadPayslip(emp, gone(ME)) === false)
  check('…and for the owner', R.canReadPayslip(owner, gone(ME)) === false)
  check('no viewer → no access', R.canReadPayslip(null, live(ME)) === false && R.canReadPayslip(undefined, live(ME)) === false)
  check('no row → no access', R.canReadPayslip(emp, null) === false && R.canReadPayslip(owner, undefined) === false)
  check('an empty staff id never matches an empty owner', R.canReadPayslip({ staffId: '', isOp: false }, { staff_id: '', removed_at: null }) === false)
  check('a viewer is not an owner just because the row says so (isOp is the only door)', R.canReadPayslip({ staffId: YOU, isOp: false }, live(ME)) === false)
}

// ───────────────────────────────────────────────────────────────────────────
section('the file — magic bytes, never the name or the claimed type')
{
  const b = (...x) => Uint8Array.from(x)
  check('a PDF', R.sniffPayslip(b(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31)) === 'application/pdf')
  check('a JPEG', R.sniffPayslip(b(0xff, 0xd8, 0xff, 0xe0)) === 'image/jpeg')
  check('a PNG', R.sniffPayslip(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) === 'image/png')
  check('a WebP', R.sniffPayslip(b(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)) === 'image/webp')
  check('an HTML file is refused (the script-capable one)', R.sniffPayslip(new TextEncoder().encode('<html><script>alert(1)</script>')) === null)
  check('an SVG is refused', R.sniffPayslip(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')) === null)
  check('a ZIP is refused', R.sniffPayslip(b(0x50, 0x4b, 3, 4)) === null)
  check('a PDF-looking name on other bytes is refused (names are not consulted at all)', R.sniffPayslip(new TextEncoder().encode('hello')) === null)
  check('empty / too short is refused', R.sniffPayslip(new Uint8Array(0)) === null && R.sniffPayslip(b(0xff, 0xd8)) === null)
  check('"%PDF" without the dash is not a PDF', R.sniffPayslip(b(0x25, 0x50, 0x44, 0x46, 0x20)) === null)
}

section('cleanFileName — nothing that can mislead or escape')
{
  check('path parts are flattened', !/[\\/]/.test(R.cleanFileName('../../etc/passwd')) && !R.cleanFileName('../../etc/passwd').startsWith('.'))
  check('backslashes too', !R.cleanFileName('C:\\Users\\x\\a.pdf').includes('\\'))
  check('control characters are gone', R.cleanFileName('a\u0000b\nc\td.pdf') === 'a b c d.pdf')
  check('a right-to-left override cannot disguise an extension', R.cleanFileName('invoice\u202Egnp.exe') === 'invoicegnp.exe')
  check('an empty name stays empty', R.cleanFileName('') === '' && R.cleanFileName(null) === '' && R.cleanFileName(undefined) === '')
  const long = R.cleanFileName('א'.repeat(400) + '.pdf')
  check('a long name is cut to 200 and KEEPS its extension', long.length <= R.PAYSLIP_NAME_MAX && long.endsWith('.pdf'), `${long.length}`)
  check('Hebrew survives untouched', R.cleanFileName('תלוש שכר - דנה כהן - 09-2026.pdf') === 'תלוש שכר - דנה כהן - 09-2026.pdf')
}

// ───────────────────────────────────────────────────────────────────────────
section('months')
{
  check('"2026-09" → the first of the month', R.parsePeriod('2026-09') === '2026-09-01')
  check('"2026-09-01" is accepted as is', R.parsePeriod('2026-09-01') === '2026-09-01')
  check('"2026-09-15" is refused (a payslip is a MONTH)', R.parsePeriod('2026-09-15') === null)
  check('month 13 / 00 refused', R.parsePeriod('2026-13') === null && R.parsePeriod('2026-00') === null)
  check('year out of range refused', R.parsePeriod('1999-12') === null && R.parsePeriod('2101-01') === null)
  check('non-strings refused', R.parsePeriod(null) === null && R.parsePeriod(202609) === null && R.parsePeriod({}) === null)
  check('whitespace is tolerated', R.parsePeriod('  2026-09 ') === '2026-09-01')
  check('periodLabel is Hebrew', R.periodLabel('2026-09-01') === 'ספטמבר 2026' && R.periodLabel('2026-01-01') === 'ינואר 2026' && R.periodLabel('2026-12-01') === 'דצמבר 2026')
  check('periodLabel of garbage returns the input (never throws)', R.periodLabel('nope') === 'nope')
  check('twelve months, all Hebrew', R.HEBREW_MONTHS.length === 12 && R.HEBREW_MONTHS.every((m) => HEBREW.test(m)))

  // previousPeriod uses the VENUE's timezone, not the server's: just after midnight on 1 Jan in Israel it is still
  // 31 Dec in UTC, and a payslip handed over then is for DECEMBER either way — but on 1 Feb 00:30 Israel (= 31 Jan
  // 22:30Z) the previous month must be JANUARY, not December.
  check('1 Feb 00:30 Israel (= 31 Jan UTC) → previous month is January', R.previousPeriod(new Date('2026-01-31T22:30:00Z')) === '2026-01-01')
  check('mid-month → the month before', R.previousPeriod(new Date('2026-10-14T09:00:00Z')) === '2026-09-01')
  check('January → December of the year before', R.previousPeriod(new Date('2026-01-15T09:00:00Z')) === '2025-12-01')
  const rp = R.recentPeriods(14, new Date('2026-10-14T09:00:00Z'))
  check('recentPeriods starts at the current month, newest first, 14 long, no gaps across the year',
    rp.length === 14 && rp[0] === '2026-10-01' && rp[1] === '2026-09-01' && rp[9] === '2026-01-01' && rp[10] === '2025-12-01' && rp[13] === '2025-09-01', rp.join(' '))
}

section('validatePayslipUpload')
{
  const ok = { size: 1000, sniffed: 'application/pdf', staffId: '11111111-1111-4111-8111-111111111111', period: '2026-09' }
  let r = R.validatePayslipUpload(ok)
  check('a good upload', r.ok === true && r.period === '2026-09-01' && r.note === '')
  check('empty', R.validatePayslipUpload({ ...ok, size: 0 }).error === 'empty')
  check('too big (8MB + 1)', R.validatePayslipUpload({ ...ok, size: R.PAYSLIP_MAX_BYTES + 1 }).error === 'too_big')
  check('exactly 8MB is fine', R.validatePayslipUpload({ ...ok, size: R.PAYSLIP_MAX_BYTES }).ok === true)
  check('bad type', R.validatePayslipUpload({ ...ok, sniffed: null }).error === 'bad_type')
  check('bad staff id', R.validatePayslipUpload({ ...ok, staffId: 'x' }).error === 'bad_staff' && R.validatePayslipUpload({ ...ok, staffId: undefined }).error === 'bad_staff')
  check('SQL-ish staff id refused', R.validatePayslipUpload({ ...ok, staffId: "1' or '1'='1" }).error === 'bad_staff')
  check('bad period', R.validatePayslipUpload({ ...ok, period: '2026-9' }).error === 'bad_period' && R.validatePayslipUpload({ ...ok, period: undefined }).error === 'bad_period')
  check('note trimmed, and capped at 300', R.validatePayslipUpload({ ...ok, note: '  hi  ' }).note === 'hi' && R.validatePayslipUpload({ ...ok, note: 'x'.repeat(301) }).error === 'note_too_long')
  check('the order of refusals: empty beats type beats staff beats period', R.validatePayslipUpload({ size: 0, sniffed: null, staffId: 'x', period: 'y' }).error === 'empty')
}

section('storage path ↔ the SQL check')
{
  const m060 = read('supabase/migrations/060_staff_payslips.sql')
  const sqlRe = m060.match(/file_path ~ '([^']+)'/)?.[1]
  check('migration 060 carries a file_path pattern', !!sqlRe)
  const re = new RegExp(sqlRe.replace(/\\\\/g, '\\'))
  const sid = '11111111-1111-4111-8111-111111111111'
  const id = '22222222-2222-4222-8222-222222222222'
  for (const mime of R.PAYSLIP_MIME) {
    const p = R.payslipStoragePath(sid, '2026-09-01', id, mime)
    check(`${mime} → "${p.slice(37, 48)}…" passes the SQL pattern`, re.test(p), p)
  }
  check('the SQL pattern refuses a traversal', !re.test(`../${sid}/2026-09/${id}.pdf`) && !re.test(`${sid}/2026-09/../${id}.pdf`))
  check('…and an executable extension', !re.test(`${sid}/2026-09/${id}.exe`) && !re.test(`${sid}/2026-09/${id}.html`) && !re.test(`${sid}/2026-09/${id}.svg`))
}

section('rules.ts ↔ migration 060 — every number is spelled twice, and must be the same number')
{
  const m060 = read('supabase/migrations/060_staff_payslips.sql')
  check('the size limit (table check + bucket)', (m060.match(new RegExp(`${R.PAYSLIP_MAX_BYTES}\\b`, 'g')) ?? []).length >= 2 && R.PAYSLIP_MAX_BYTES === 8388608)
  const mimeList = m060.match(/file_mime in \(([^)]+)\)/)?.[1] ?? ''
  const sqlMimes = (mimeList.match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, '')).sort()
  check('the MIME list in the table check equals PAYSLIP_MIME', JSON.stringify(sqlMimes) === JSON.stringify([...R.PAYSLIP_MIME].sort()), sqlMimes.join(','))
  const bucketList = m060.match(/array\[([^\]]+)\]/)?.[1] ?? ''
  const bucketMimes = (bucketList.match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, '')).sort()
  check('…and in the bucket', JSON.stringify(bucketMimes) === JSON.stringify([...R.PAYSLIP_MIME].sort()))
  check('file_name length cap = PAYSLIP_NAME_MAX', new RegExp(`char_length\\(file_name\\) <= ${R.PAYSLIP_NAME_MAX}\\b`).test(m060))
  check('note length cap = PAYSLIP_NOTE_MAX', new RegExp(`char_length\\(note\\) <= ${R.PAYSLIP_NOTE_MAX}\\b`).test(m060))
  check('the extensions in the SQL path pattern are exactly the ones rules.ts can produce',
    (m060.match(/\\\.\(([a-z|]+)\)/)?.[1] ?? '').split('|').sort().join() === Object.values(R.PAYSLIP_EXTENSION).sort().join())
  check('the bucket is private and the upsert can never flip it public', /'payslips', 'payslips', false/.test(m060) && /set public = false/.test(m060))
  check('RLS on, grants revoked, for both tables',
    /alter table public\.staff_payslips enable row level security;\s*revoke all on table public\.staff_payslips from anon, authenticated;/.test(m060) &&
    /alter table public\.staff_payslip_events enable row level security;\s*revoke all on table public\.staff_payslip_events from anon, authenticated;/.test(m060))
  check('no storage.objects policy is created (nothing reaches a file with a user token)', !/create policy[^;]*storage\.objects/i.test(m060))
  check('staff_id is ON DELETE RESTRICT — a person with payslips cannot be deleted', /staff_id\s+uuid not null references public\.staff\(id\) on delete restrict/.test(m060))
}

// ───────────────────────────────────────────────────────────────────────────
section('reading "which employee, which month" off a file name')
{
  const P = R.periodFromFileName
  check('YYYY-MM', P('payslip_2026-09.pdf') === '2026-09-01')
  check('MM-YYYY', P('תלוש 09-2026.pdf') === '2026-09-01')
  check('M.YYYY', P('תלוש 9.2026.pdf') === '2026-09-01')
  check('MM/YYYY in the name', P('תלוש 09/2026.pdf') === '2026-09-01')
  check('YYYYMM run together', P('slip202609.pdf') === '2026-09-01')
  check('MMYYYY run together', P('slip092026.pdf') === '2026-09-01')
  check('Hebrew month name + year', P('תלוש שכר ספטמבר 2026 דנה כהן.pdf') === '2026-09-01')
  check('English month name + year', P('Payslip September 2026.pdf') === '2026-09-01' && P('payslip-sep-2026.pdf') === '2026-09-01')
  check('the same month spelled two ways agrees', P('2026-09 ספטמבר 2026.pdf') === '2026-09-01')
  check('TWO different months → nothing (never a guess)', P('2026-08 and 2026-09.pdf') === null)
  check('no date at all → nothing', P('תלוש דנה כהן.pdf') === null)
  check('a phone number is not a month', P('0549109603.pdf') === null)
  check('an out-of-range year is not a month', P('1999-09.pdf') === null && P('2101-09.pdf') === null)
  check('an ID-like long number does not produce a month', P('תלוש 123456789.pdf') === null)
  check('month 13 is not a month', P('2026-13.pdf') === null)

  const roster = [
    { id: 'dana', names: ['דנה כהן', 'דנה'] },
    { id: 'dan', names: ['דן לוי'] },
    { id: 'yossi', names: ['יוסי מזרחי'] },
    { id: 'dana2', names: ['דנה לוי'] },
    { id: 'avi1', names: ['אבי'] },
    { id: 'avi2', names: ['אבי כהן'] },
  ]
  const S = (f) => R.staffFromFileName(f, roster)
  check('first + last name', S('תלוש שכר - יוסי מזרחי - 09-2026.pdf') === 'yossi')
  check('order does not matter', S('מזרחי יוסי.pdf') === 'yossi')
  check('"דנה כהן" does not match דנה לוי (both are "דנה")', S('דנה כהן.pdf') === 'dana')
  check('a first name shared by two people (דנה) alone is NOT a match', S('תלוש דנה.pdf') === null)
  check('a first name that is unique (יוסי) alone IS enough only if the person has a single-word name… here they do not, so no', S('תלוש יוסי.pdf') === null)
  check('partial words are not matches ("דן" is not inside "דנה")', S('דנה.pdf') !== 'dan')
  check('"אבי כהן" beats the bare "אבי" (more words)', S('אבי כהן 2026-09.pdf') === 'avi2')
  check('a bare "אבי" with no surname on the file → ambiguous with nobody else single-word? it is unique-word-name but shared with avi2 → no', S('אבי.pdf') === null)
  check('nobody on the roster → nothing', S('לא אחד מהם.pdf') === null)
  check('the extension is not a name', R.staffFromFileName('x.pdf', [{ id: 'p', names: ['pdf'] }]) === null)
  check('an empty roster → nothing', R.staffFromFileName('דנה כהן.pdf', []) === null)
  const both = R.suggestForFile('תלוש יוסי מזרחי 2026-09.pdf', roster)
  check('suggestForFile returns both halves', both.staffId === 'yossi' && both.period === '2026-09-01')
  const none = R.suggestForFile('scan0001.pdf', roster)
  check('…and null/null for a name that says nothing', none.staffId === null && none.period === null)
  check('twins (same full name twice) → nothing', R.staffFromFileName('דנה כהן.pdf', [{ id: 'a', names: ['דנה כהן'] }, { id: 'b', names: ['דנה כהן'] }]) === null)
}

// ───────────────────────────────────────────────────────────────────────────
section('planZip — which files, under what names')
{
  const mk = (id, staff, name, period, mime = 'application/pdf', bytes = 1000) =>
    ({ id, staff_id: staff, staffName: name, period, file_mime: mime, file_bytes: bytes })
  let plan = R.planZip([mk('a', 's1', 'דנה כהן', '2026-09-01'), mk('b', 's1', 'דנה כהן', '2026-08-01')])
  check('one person → files at the top level, oldest month first', plan.ok && !plan.folders && plan.entries[0].path === '2026-08.pdf' && plan.entries[1].path === '2026-09.pdf', JSON.stringify(plan))
  plan = R.planZip([mk('a', 's1', 'דנה כהן', '2026-09-01'), mk('b', 's2', 'יוסי מזרחי', '2026-09-01', 'image/jpeg')])
  check('two people → a folder each, in name order', plan.ok && plan.folders && plan.entries.map((e) => e.path).join('|') === 'דנה כהן/2026-09.pdf|יוסי מזרחי/2026-09.jpg', JSON.stringify(plan))
  plan = R.planZip([mk('a', 's1', 'דנה', '2026-09-01'), mk('b', 's1', 'דנה', '2026-09-01'), mk('c', 's1', 'דנה', '2026-09-01')])
  check('the same month three times → unique names (2), (3)', plan.ok && new Set(plan.entries.map((e) => e.path)).size === 3 && plan.entries.some((e) => e.path === '2026-09 (2).pdf'), JSON.stringify(plan.entries))
  plan = R.planZip([mk('a', 's1', 'דנה', '2026-09-01'), mk('b', 's2', 'דנה', '2026-09-01')])
  check('two people with the SAME name still get distinct entries', plan.ok && new Set(plan.entries.map((e) => e.path.toLowerCase())).size === 2, JSON.stringify(plan.entries))
  plan = R.planZip([mk('a', 's1', '../../evil', '2026-09-01'), mk('b', 's2', 'a/b\\c:d*e', '2026-09-01')])
  check('hostile employee names cannot make a path that climbs out', plan.ok && plan.entries.every((e) => Z.isSafeZipName(e.path)), JSON.stringify(plan.entries))
  plan = R.planZip([mk('a', 's1', '   ', '2026-09-01'), mk('b', 's2', '...', '2026-09-01')])
  check('an empty or dots-only name falls back to a placeholder', plan.ok && plan.entries.every((e) => Z.isSafeZipName(e.path)), JSON.stringify(plan.entries))
  check('empty selection', R.planZip([]).error === 'empty')
  const many = Array.from({ length: R.ZIP_MAX_FILES + 1 }, (_, i) => mk(`i${i}`, 's1', 'x', '2026-09-01'))
  check('over the file cap', R.planZip(many).error === 'too_many' && R.planZip(many.slice(0, R.ZIP_MAX_FILES)).ok === true)
  check('over the byte cap', R.planZip([mk('a', 's1', 'x', '2026-09-01', 'application/pdf', R.ZIP_MAX_BYTES + 1)]).error === 'too_big')
  const nm = R.zipDownloadName([mk('a', 's1', 'דנה כהן', '2026-01-01'), mk('b', 's1', 'דנה כהן', '2026-06-01')])
  check('the ZIP is named for the person and the span', nm.utf8 === 'תלושי שכר - דנה כהן - 2026-01_2026-06.zip' && nm.ascii === 'payslips-2026-01_2026-06.zip', JSON.stringify(nm))
  const nm2 = R.zipDownloadName([mk('a', 's1', 'א', '2026-01-01'), mk('b', 's2', 'ב', '2026-01-01')])
  check('several people → "N עובדים"', nm2.utf8.includes('2 עובדים'))
}

section('Content-Disposition — Hebrew in, no injection out')
{
  const h = R.contentDisposition('attachment', { utf8: 'תלושי שכר - דנה כהן.zip', ascii: 'payslips.zip' })
  check('kind + ASCII fallback + RFC 5987 name', h.startsWith('attachment; filename="payslips.zip"; filename*=UTF-8\'\'') && !HEBREW.test(h), h)
  check('the encoded name decodes back to the Hebrew', decodeURIComponent(h.split("filename*=UTF-8''")[1]) === 'תלושי שכר - דנה כהן.zip')
  const evil = R.contentDisposition('inline', { utf8: 'a"b\r\nSet-Cookie: x=1.zip', ascii: 'a"b\r\nSet-Cookie: x=1.zip' })
  check('quotes and CR/LF can never reach the header', !/[\r\n]/.test(evil) && (evil.match(/"/g) ?? []).length === 2, evil)
  check('apostrophes and parentheses are escaped in filename*', !/['()*]/.test(evil.split("filename*=UTF-8''")[1]))
}

section('parseIdList — the ZIP request')
{
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  check('two ids', JSON.stringify(R.parseIdList(`${A},${B}`)) === JSON.stringify([A, B]))
  check('duplicates (any case) collapse', R.parseIdList(`${A},${A.toUpperCase()},${B}`).length === 2)
  check('one bad id spoils the lot (null)', R.parseIdList(`${A},nope`) === null && R.parseIdList(`${A},${B};drop`) === null)
  check('empty / missing → null', R.parseIdList('') === null && R.parseIdList(null) === null && R.parseIdList(undefined) === null && R.parseIdList(',,,') === null)
  const huge = Array.from({ length: R.ZIP_MAX_FILES * 2 + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',')
  check('an absurdly long list is refused before it is parsed further', R.parseIdList(huge) === null)
  check('whitespace around ids is fine', R.parseIdList(` ${A} , ${B} `).length === 2)
}

section('groupByYear')
{
  const g = R.groupByYear([{ period: '2025-12-01' }, { period: '2026-03-01' }, { period: '2026-09-01' }, { period: '2025-01-01' }])
  check('newest year first; newest month first inside', g.map((x) => x.year).join() === '2026,2025' && g[0].rows.map((r) => r.period).join() === '2026-09-01,2026-03-01' && g[1].rows[0].period === '2025-12-01')
  check('empty in, empty out', R.groupByYear([]).length === 0)
}

// ───────────────────────────────────────────────────────────────────────────
section('crc32 — against zlib’s')
{
  check('the textbook vector: "123456789" → CBF43926', Z.crc32(new TextEncoder().encode('123456789')) === 0xcbf43926)
  check('empty → 0', Z.crc32(new Uint8Array(0)) === 0)
  let same = true
  for (const n of [1, 2, 3, 255, 256, 1000, 65536, 300_001]) {
    const buf = new Uint8Array(n); for (let i = 0; i < n; i++) buf[i] = (i * 31 + (i >> 3)) & 255
    if (Z.crc32(buf) !== zlib.crc32(buf)) { same = false; break }
  }
  check('equals zlib.crc32 on 8 sizes up to 300 KB', same)
}

section('zip — an independent reader extracts exactly what we wrote')
const tmp = mkdtempSync(join(tmpdir(), 'ayeka-zip-'))
{
  const rnd = (n, seed) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1664525 + 1013904223) >>> 0; b[i] = x >>> 24 } return b }
  const files = [
    { name: 'תלוש 2026-09.pdf', data: rnd(300_000, 1) },
    { name: 'דנה כהן/2026-08.pdf', data: rnd(65_537, 2) },
    { name: 'דנה כהן/2026-09.jpg', data: rnd(1, 3) },
    { name: 'empty.bin', data: new Uint8Array(0) },
    { name: 'plain ascii.txt', data: new TextEncoder().encode('שלום world\n') },
    { name: 'a/b/c/deep.pdf', data: rnd(1000, 4) },
  ]
  const when = new Date(2026, 8, 30, 13, 45, 22)
  const bytes = await Z.zipBytes(files.map((f) => ({ ...f, mtime: when })))
  const zipPath = join(tmp, 'out.zip')
  writeFileSync(zipPath, bytes)

  // 1) our own strict parse of the structure (central directory → local headers)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.length - 22
  check('the archive ends with an end-of-central-directory record', dv.getUint32(eocd, true) === 0x06054b50)
  const count = dv.getUint16(eocd + 10, true)
  const cdSize = dv.getUint32(eocd + 12, true)
  const cdOff = dv.getUint32(eocd + 16, true)
  check('entry count and the central directory end where the end record starts', count === files.length && cdOff + cdSize === eocd, `${count} ${cdOff}+${cdSize} vs ${eocd}`)
  let p = cdOff, parsedOk = true, utf8Flag = true, localOk = true, dataOk = true, dosOk = true
  const dec = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) { parsedOk = false; break }
    const flag = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true)
    const time = dv.getUint16(p + 12, true), date = dv.getUint16(p + 14, true)
    const crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true)
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true)
    const off = dv.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen))
    const f = files[i]
    if (!(flag & 0x0800)) utf8Flag = false
    if (name !== f.name || method !== 0 || csize !== usize || usize !== f.data.length || crc !== zlib.crc32(f.data)) parsedOk = false
    // the local header at `off` repeats the same facts, and the bytes follow it
    if (dv.getUint32(off, true) !== 0x04034b50 || dv.getUint32(off + 14, true) !== crc || dv.getUint32(off + 18, true) !== csize ||
        dv.getUint16(off + 26, true) !== nlen) localOk = false
    const dataStart = off + 30 + nlen + dv.getUint16(off + 28, true)
    const got = bytes.subarray(dataStart, dataStart + usize)
    if (got.length !== f.data.length || !got.every((v, k) => v === f.data[k])) dataOk = false
    if ((time >> 11) !== 13 || ((time >> 5) & 63) !== 45 || (date >> 9) + 1980 !== 2026 || ((date >> 5) & 15) !== 9 || (date & 31) !== 30) dosOk = false
    p += 46 + nlen + xlen + clen
  }
  check('every central entry: name, stored method, sizes, CRC match the source', parsedOk)
  check('every entry is flagged UTF-8', utf8Flag)
  check('every local header repeats the CRC/size (no data-descriptor trailer) and the bytes sit right after it', localOk && dataOk)
  check('the modified time is the one given (DOS format)', dosOk)

  // 2) someone else's reader. Not ours, not ours-in-another-language: the operating system's own.
  //    • Windows: PowerShell's Expand-Archive (.NET ZipArchive — it honours the UTF-8 flag, so it is the faithful test
  //      of "does a Hebrew name survive Windows?"), and tar.exe (libarchive) on an ASCII-only copy — tar.exe is a
  //      second, unrelated implementation, but it cannot convert non-ACP names on a machine whose code page is not
  //      Hebrew, which is its limitation and not the archive's (the same bytes extract perfectly with .NET).
  //    • elsewhere: unzip, and bsdtar.
  const sysTar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : null
  const asciiFiles = files.filter((f) => /^[\x20-\x7e]+$/.test(f.name))
  const asciiZip = join(tmp, 'ascii.zip')
  writeFileSync(asciiZip, await Z.zipBytes(asciiFiles))
  const tools = []
  if (process.platform === 'win32') {
    tools.push({
      label: 'PowerShell Expand-Archive (.NET ZipArchive)', zip: zipPath, files,
      run: (zip, dir) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Expand-Archive -LiteralPath $env:AYEKA_ZIP -DestinationPath $env:AYEKA_OUT -Force'],
        { stdio: 'pipe', env: { ...process.env, AYEKA_ZIP: zip, AYEKA_OUT: dir } }),
    })
    if (sysTar && existsSync(sysTar)) {
      tools.push({ label: 'Windows tar.exe (libarchive), ASCII-only copy', zip: asciiZip, files: asciiFiles,
        run: (zip, dir) => execFileSync(sysTar, ['-xf', zip, '-C', dir], { stdio: 'pipe' }) })
    }
  } else {
    tools.push({ label: 'unzip', zip: zipPath, files, run: (zip, dir) => execFileSync('unzip', ['-qq', zip, '-d', dir], { stdio: 'pipe' }) })
    tools.push({ label: 'bsdtar', zip: zipPath, files, run: (zip, dir) => execFileSync('bsdtar', ['-xf', zip, '-C', dir], { stdio: 'pipe' }) })
  }
  let ran = 0
  const walk = (dir, base = '') => readdirSync(join(dir, base)).flatMap((e) => {
    const rel = base ? `${base}/${e}` : e
    return statSync(join(dir, rel)).isDirectory() ? walk(dir, rel) : [rel]
  })
  for (const t of tools) {
    const dir = join(tmp, `x-${ran}-${t.label.length}`); mkdirSync(dir)
    try { t.run(t.zip, dir) } catch (e) { console.log(`  · ${t.label} not usable here (${String(e.message).split('\n')[0]})`); continue }
    ran++
    const got = walk(dir).sort()
    const want = t.files.map((f) => f.name).sort()
    check(`${t.label}: extracts the same file list${t.files === files ? ' (Hebrew names intact)' : ''}`,
      JSON.stringify(got.map((s) => s.normalize('NFC'))) === JSON.stringify(want.map((s) => s.normalize('NFC'))), `${got.join(' | ')}`)
    check(`${t.label}: every file's bytes are identical`, t.files.every((f) => {
      const g = readFileSync(join(dir, f.name))
      return g.length === f.data.length && Buffer.compare(g, Buffer.from(f.data)) === 0
    }))
  }
  if (!ran) console.log('  · no external unzip available on this machine — only the structural parse above was run')
  check('(an independent extractor was available and used)', ran > 0, 'install unzip/bsdtar (or run on Windows) to run this check')
}

section('zip — it really STREAMS, and refuses what it must')
{
  let produced = 0
  async function* gen() {
    for (let i = 0; i < 5; i++) { produced++; yield { name: `f${i}.bin`, data: new Uint8Array(10).fill(i) } }
  }
  const stream = Z.zipStream(gen())
  const reader = stream.getReader()
  const first = await reader.read()
  check('after reading the FIRST chunk only one entry has been produced (pull-based, not buffered)', produced === 1 && !first.done, `produced=${produced}`)
  let total = first.value.length, chunks = 1
  for (;;) { const r = await reader.read(); if (r.done) break; total += r.value.length; chunks++ }
  check('…and the whole archive then arrives', produced === 5 && total > 0 && chunks > 5)

  let stopped = 0
  async function* gen2() { try { for (let i = 0; i < 100; i++) { stopped++; yield { name: `g${i}`, data: new Uint8Array(4) } } } finally { stopped = -1 } }
  const s2 = Z.zipStream(gen2()); const r2 = s2.getReader(); await r2.read(); await r2.cancel()
  check('cancelling the download stops the producer (nothing keeps fetching files for a client that left)', stopped === -1, `${stopped}`)

  const bad = ['../x', '/abs', 'a\\b', 'C:x', '', 'a//b', 'a/../b', './a', 'a/.', 'x\u0000y', 'a\nb', 'x'.repeat(256)]
  let allRefused = true
  for (const name of bad) {
    try { await Z.zipBytes([{ name, data: new Uint8Array(1) }]); allRefused = false; console.log('   accepted:', JSON.stringify(name)) } catch { /* expected */ }
  }
  check('zip-slip names are all refused by the writer itself', allRefused)
  check('…and a normal Hebrew path is accepted', Z.isSafeZipName('דנה כהן/2026-09.pdf') === true)
  let erroredStream = false
  try {
    const rr = Z.zipStream([{ name: '../x', data: new Uint8Array(1) }]).getReader(); await rr.read()
  } catch { erroredStream = true }
  check('a refused entry errors the stream (the client sees a failed download, not a corrupt archive)', erroredStream)
  const emptyZip = await Z.zipBytes([])
  check('an empty archive is just the 22-byte end record', emptyZip.length === 22)
}

// ───────────────────────────────────────────────────────────────────────────
// Structural claims about the routes, pages and components — added as they exist.
section('wiring (read as text)')
{
  const files = {
    fileRoute: 'src/app/api/payslips/file/route.ts',
    zipRoute: 'src/app/api/payslips/zip/route.ts',
    uploadRoute: 'src/app/api/owner/payslips/route.ts',
    server: 'src/lib/payslips/server.ts',
    ownerPage: 'src/app/owner/payslips/page.tsx',
    staffPage: 'src/app/staff/payslips/page.tsx',
  }
  const have = (k) => existsSync(join(ROOT, files[k]))
  if (!Object.keys(files).every(have)) {
    console.log('  · the routes/pages are not all written yet — structural checks skipped')
  } else {
    const fileRoute = code(files.fileRoute), zipRoute = code(files.zipRoute), upload = code(files.uploadRoute)
    const server = code(files.server), ownerPage = code(files.ownerPage), staffPage = code(files.staffPage)

    check('every payslip read goes through canReadPayslip', /canReadPayslip\(/.test(fileRoute) && /canReadPayslip\(/.test(zipRoute))
    check('the viewer’s identity comes from the SESSION (currentPayslipViewer), not from the request',
      /currentPayslipViewer\(/.test(fileRoute) && /currentPayslipViewer\(/.test(zipRoute) && !/searchParams\.get\(['"](staff|staffId|staff_id|user)['"]\)/.test(fileRoute + zipRoute))
    check('the file route looks the PATH up by id — the caller never supplies one', !/searchParams\.get\(['"](path|file_path)['"]\)/.test(fileRoute + zipRoute))
    check('files are never cached by anything shared (private, no-store)', /private, no-store/.test(fileRoute) && /private, no-store/.test(zipRoute))
    check('nosniff on both', /nosniff/.test(fileRoute) && /nosniff/.test(zipRoute))
    check('the inline file carries a CSP that keeps a crafted file inert', /Content-Security-Policy/.test(fileRoute) && /default-src 'none'/.test(fileRoute))
    check('the ZIP is streamed (zipStream), never assembled in memory (no zipBytes in the route)', /zipStream\(/.test(zipRoute) && !/zipBytes\(/.test(zipRoute))
    check('the ZIP names come from planZip (sanitised, unique) — not from the stored file names', /planZip\(/.test(zipRoute) && !/file_name/.test(zipRoute.replace(/select\([^)]*\)/g, '')))
    check('the ZIP route is rate limited', /checkRateLimit\(/.test(zipRoute))
    check('the upload is OWNER only (requireOwner)', /requireOwner\(/.test(upload))
    check('the upload decides the type from the BYTES (sniffPayslip), not the claimed MIME', /sniffPayslip\(/.test(upload) && !/file\.type/.test(upload))
    check('the upload refuses a staff id that is not on the roster', /from\('staff'\)/.test(upload))
    check('a failed row insert removes the uploaded file (no orphan)', /\.remove\(\[/.test(upload))
    check('removal deletes the FILE as well as marking the row', /\.remove\(\[/.test(upload) && /removed_at/.test(upload))
    // A HEAD probe cannot tell "table missing" from "fine": no body, so postgrest-js turns the empty 404 into a 204.
    // Found by driving the staff dashboard against a stand-in with the table off (2026-10-14).
    const ready = server.slice(server.indexOf('export async function payslipsReady'), server.indexOf('export interface PayslipList'))
    check('payslipsReady() reads a row with a GET — never a HEAD (which cannot see a missing table)', /\.select\('id'\)\.limit\(1\)/.test(ready) && !/head:\s*true/.test(ready))
    check('every access is logged (events)', /recordPayslipEvents|staff_payslip_events/.test(server) && /recordPayslipEvents\(/.test(fileRoute) && /recordPayslipEvents\(/.test(zipRoute) && /recordPayslipEvents\(/.test(upload))
    check('only the payslip’s OWN employee sets first-viewed', /employee_first_viewed_at/.test(server + fileRoute) && /staff_id\s*===\s*viewer\.staffId|row\.staff_id\s*===/.test(server + fileRoute))
    check('the owner page re-checks OP itself (middleware is only the first door)', /isOp\(/.test(ownerPage))
    check('the employee page lists ONLY the viewer’s own payslips', /listPayslips\(/.test(staffPage) && /viewer\.staffId/.test(staffPage))
  }
}

section('the viewer and the vendored pdf.js (read as text)')
{
  const { createHash } = await import('node:crypto')
  const sha = (p) => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex')
  const dir = 'public/vendor/pdfjs/3.11.174'
  const readme = read('public/vendor/pdfjs/README.md')
  check('the vendored pdf.js files are the ones the README names (SHA-256) — nobody swapped them quietly',
    existsSync(join(ROOT, dir, 'pdf.min.js')) && readme.includes(sha(`${dir}/pdf.min.js`)) && readme.includes(sha(`${dir}/pdf.worker.min.js`)))
  check('its Apache-2.0 licence ships with it', /Apache License/.test(read(`${dir}/LICENSE`)))
  check('it is NOT an npm dependency (the optional native `canvas` would ride into the Vercel install)', !/pdfjs-dist/.test(read('package.json')))

  // Every place src/ opens a PDF turns eval off — pdf.js ≤ 4.1 could be made to run script from a crafted font.
  const srcFiles = []
  const walk = (d) => { for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    const p = `${d}/${e.name}`
    if (e.isDirectory()) walk(p); else if (/\.(tsx?|mjs)$/.test(e.name)) srcFiles.push(p)
  } }
  walk('src')
  const calls = srcFiles.flatMap((f) => Array.from(read(f).matchAll(/getDocument\(\{[^}]*\}/g)).map((m) => ({ f, text: m[0] })))
  check('there is exactly one place that opens a PDF', calls.length === 1 && calls[0].f.endsWith('PdfPages.tsx'), JSON.stringify(calls.map((c) => c.f)))
  check('…and it passes isEvalSupported: false (CVE-2024-4367)', calls.every((c) => /isEvalSupported:\s*false/.test(c.text)))

  const pdf = code('src/components/payslips/PdfPages.tsx')
  check('pdf.js is loaded from OUR origin only', /const PDFJS_DIR = '\/vendor\/pdfjs\/3\.11\.174'/.test(pdf) && !/https?:\/\//.test(pdf))
  check('no remote font or cMap source is configured', !/cMapUrl|standardFontDataUrl|fontExtraProperties/.test(pdf))
  check('a locked PDF asks for its password — and the password is never stored or sent anywhere',
    /onPassword/.test(pdf) && !/localStorage|sessionStorage|document\.cookie|indexedDB|fetch\([^)]*password/i.test(pdf))
  check('a page the canvas cannot hold is scaled down, not drawn (mobile Safari’s limit)', /MAX_PIXELS/.test(pdf) && /Math\.sqrt\(MAX_PIXELS/.test(pdf))
  check('a changed source cancels the old render and destroys the old document', /task\?\.destroy\(\)/.test(pdf) && /t\.cancel\(\)/.test(pdf))

  const viewer = code('src/components/payslips/PayslipViewer.tsx')
  check('the viewer is a real dialog: role, modal, focus trap, Escape, focus restored, scroll locked',
    /role="dialog"/.test(viewer) && /aria-modal="true"/.test(viewer) && /e\.key !== 'Tab'/.test(viewer) && /e\.key === 'Escape'/.test(viewer) && /returnFocusTo/.test(viewer) && /document\.body\.style\.overflow = 'hidden'/.test(viewer))
  check('the viewer fetches only the payslip being looked at (no preloading — every open is logged)', !/preload|prefetch|new Image\(/.test(viewer) && (viewer.match(/\/api\/payslips\/file/g) ?? []).length >= 1)
  check('arrow keys follow the right-to-left order (right = the newer month)', /'ArrowRight'\) \{[^}]*go\(index - 1\)/.test(viewer) && /'ArrowLeft'\) \{[^}]*go\(index \+ 1\)/.test(viewer))
  check('a keyboard that belongs to a confirmation sheet is not stolen from it', /if \(suspended\) return/.test(viewer))

  const lib = code('src/components/payslips/PayslipLibrary.tsx')
  const upload = code('src/components/payslips/PayslipUpload.tsx')
  check('nothing about a payslip is kept on the device (no storage, no cookie)', !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(lib + upload + viewer + code('src/components/payslips/PickerSheet.tsx')))
  check('a ZIP is checked first (so a refusal is a sentence), then downloaded by the browser itself', /check=1/.test(lib) && /a\.href = `\/api\/payslips\/zip\?\$\{qs\}`/.test(lib) && /a\.click\(\)/.test(lib))
  check('a ZIP never holds more than the cap the server enforces', /ZIP_MAX_FILES/.test(lib))
  check('removal is confirmed first and says the file is deleted for good', /ConfirmSheet/.test(lib) && /יימחק מהאחסון/.test(lib))
  check('the upload shows employee AND month on every row — nothing is hidden behind a default', /בחרו עובד\/ת/.test(upload) && /בחרו חודש/.test(upload) && /ברירת מחדל/.test(upload))
  check('the upload button stays off until every row has an employee', /missing > 0/.test(upload) && /disabled=\{busy \|\| !uploadable\.length \|\| missing > 0\}/.test(upload))
  check('a suggestion is labelled as one', /הוצע לפי שם הקובץ/.test(upload))
  check('uploads are one request per file, in order', /for \(const r of uploadable\)/.test(upload) && /await fetch\('\/api\/owner\/payslips'/.test(upload))
  check('the owner library offers upload and removal; the employee one offers neither', /mode === 'all' && !notSetUp/.test(lib) && /onAskRemove=\{mode === 'all' \? askRemove : undefined\}/.test(lib))
}

rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('\nFailures:\n  - ' + failures.join('\n  - ')); process.exit(1) }
