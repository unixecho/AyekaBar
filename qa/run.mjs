import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { dirname } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sibling = resolve(root, '..', 'ayeka-staff')
const reports = resolve(root, 'qa', 'reports')
const start = new Date()
const suites = { portal: [], oms: [] }
const baseline = process.argv.includes('--baseline')

async function run(suite, id, category, description, expected, cwd, file, args = [], timeout = 180000) {
  const since = Date.now()
  const actual = await new Promise((done) => {
    const child = spawn(process.execPath, [file, ...args], { cwd, env: { ...process.env, CI: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let killed = false
    const timer = setTimeout(() => { killed = true; child.kill() }, timeout)
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output = (output + chunk).slice(-3000) })
    child.on('error', (error) => { clearTimeout(timer); done({ status: 'failed', detail: error.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const failureLines = output.split(/\r?\n/).filter((line) => /✗|FAILED:|failed|Error:|error:/i.test(line)).slice(-16)
      done({ status: code === 0 && !killed ? 'passed' : 'failed', detail: killed ? `Timeout after ${timeout} ms` : `Exit ${code}: ${(code === 0 ? output.trim().slice(-500) : failureLines.join(' | ') || output.trim().slice(-1200)) || 'no output'}` })
    })
  })
  suites[suite].push({ id, category, description, expected, actual: actual.detail, status: actual.status, durationMs: Date.now() - since })
  process.stdout.write(`${actual.status === 'passed' ? '✓' : '✗'} ${suite}/${id}\n`)
}

function skipped(suite, id, category, description, reason) {
  suites[suite].push({ id, category, description, expected: 'הבדיקה רצה ומוכיחה את ההתנהגות הנדרשת', actual: reason, status: 'skipped', reason, durationMs: 0 })
}

await run('portal', 'typecheck', 'static', 'בדיקת סוגי קוד היישום', 'TypeScript exits with code 0', root, resolve(root, 'node_modules/typescript/bin/tsc'), ['--noEmit'])
const npmCli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
if (existsSync(npmCli)) await run('portal', 'dependency-audit', 'security', 'בדיקת חולשות תלויות לרבות חומרה גבוהה וקריטית', 'npm audit reports zero vulnerabilities', root, npmCli, ['audit', '--json'], 120000)
else skipped('portal', 'dependency-audit', 'security', 'בדיקת חולשות תלויות', 'קובץ ההפעלה של npm לא נמצא')
if (!baseline) await run('portal', 'build', 'static', 'בניית ייצור לכל מסכי האתר', 'Next production build exits with code 0', root, resolve(root, 'node_modules/next/dist/bin/next'), ['build', '--webpack'], 360000)

for (const name of (await readdir(resolve(root, 'scripts'))).filter((n) => /^(check|verify)-.*\.mjs$/.test(n)).sort()) {
  if (['check-isolation.mjs', 'check-workflow.mjs'].includes(name)) {
    skipped('portal', name, 'regression', `בדיקת ${name}`, 'דורשת שרת Supabase מקומי; לא הופעלה מול נתוני ייצור')
    continue
  }
  await run('portal', name, 'regression', `בדיקת ${name}`, 'הבדיקה הקיימת מסיימת בהצלחה', root, resolve(root, 'scripts', name), [], 240000)
}

if (existsSync(resolve(sibling, 'package.json'))) {
  for (const name of (await readdir(resolve(sibling, 'scripts'))).filter((n) => /^(check|verify)-.*\.mjs$/.test(n)).sort()) {
    await run('oms', name, 'regression', `בדיקת OMS ${name}`, 'הבדיקה הקיימת מסיימת בהצלחה', sibling, resolve(sibling, 'scripts', name), [], 240000)
  }
} else skipped('oms', 'sibling', 'regression', 'בדיקות יישום OMS', 'מאגר OMS לא נמצא במחשב זה')

const remaining = [
  ['menu-browser', 'ui', 'ניווט תפריט, שפות, קטגוריות, פרסום חי, מחיר ועגלה בדפדפן'],
  ['management-all', 'features', 'כל כלי הניהול, ההרשאות ופעולות שמירה ופרסום מקצה לקצה'],
  ['role-matrix', 'security', 'כל הדפים ונתיבי ה-API לכל תפקידי הצוות והלקוחות'],
  ['stock', 'features', 'קליטת ספק, יתרה, התאמות, בזבוז, מתכון וקיזוז מכירות בדיוק פעם אחת'],
  ['checklist-builder', 'features', 'בניית טפסים למטבח, רצפה ובר; טיוטה, גרסה, פרסום ומילוי'],
  ['browser-accessibility', 'ui', 'RTL/LTR, ניגודיות, רוחבים, אייפון, שלד טעינה ודוק יציב'],
  ['outage-recovery', 'survival', 'כשל, איטיות וחזרת בסיס הנתונים ללא דליפת מידע'],
]
for (const [id, category, description] of remaining) skipped('portal', id, category, description, 'בדיקה זו טרם מומשה; אין לטעון שהחבילה מלאה')
skipped('oms', 'full-flow', 'features', 'קופה, מלצר, בר, מטבח, הזמנה מרחוק, חיבור מחדש והרשאות בדפדפן', 'בדיקה זו טרם מומשה')

await mkdir(reports, { recursive: true })
for (const [suite, tests] of Object.entries(suites)) {
  const failed = tests.filter((t) => t.status === 'failed').length
  const missing = tests.filter((t) => t.status === 'skipped').length
  const verdict = failed ? 'failed' : missing ? 'incomplete' : 'passed'
  const report = { suite, startedAt: start.toISOString(), finishedAt: new Date().toISOString(), verdict, totals: { passed: tests.length - failed - missing, failed, skipped: missing }, tests }
  await writeFile(resolve(reports, `${suite}.json`), JSON.stringify(report, null, 2) + '\n')
  await writeFile(resolve(reports, `${suite}.md`), `# ${suite} QA — ${verdict}\n\n${tests.map((t) => `## ${t.status}: ${t.description}\n\n- קטגוריה: ${t.category}\n- צפוי: ${t.expected}\n- בפועל: ${t.actual.replaceAll('\n', ' ').slice(0, 800)}\n- זמן: ${t.durationMs} ms\n`).join('\n')}`)
  process.stdout.write(`${suite}: ${verdict} (${report.totals.passed}/${tests.length} passed)\n`)
}
if (!baseline && Object.values(suites).flat().some((t) => t.status !== 'passed')) process.exitCode = 1
else if (Object.values(suites).flat().some((t) => t.status === 'failed')) process.exitCode = 1
