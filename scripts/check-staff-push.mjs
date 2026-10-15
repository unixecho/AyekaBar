// Checks for staff push notifications: the pure timing/routing rules (the real TypeScript, transpiled)
// and the wiring that must not drift (who may subscribe, what the service worker does, where the
// card is mounted, how the database scheduler is guarded).
//
//   node scripts/check-staff-push.mjs

import ts from 'typescript'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
let pass = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = (t) => console.log(`\n${t}`)

const dir = mkdtempSync(join(tmpdir(), 'check-staff-push-'))
process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* temp dir */
  }
})
const out = ts.transpileModule(read('src/lib/push/staff-rules.ts'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
writeFileSync(join(dir, 'rules.mjs'), out)
const R = await import(pathToFileURL(join(dir, 'rules.mjs')).href)

section('when an upcoming-shift alert goes out')
check('the alert goes out within the hour before a shift', R.SHIFT_SOON_MINUTES > 0 && R.SHIFT_SOON_MINUTES <= 180)

section('where tapping an alert goes')
check('a path the app wrote is kept', R.pushPathFor('shift.soon', { url: '/staff/schedule?tab=requests' }) === '/staff/schedule?tab=requests')
check('an absolute URL in a stored link is ignored (no open redirect)', R.pushPathFor('swap.open', { url: 'https://evil.example/x' }) === '/staff/schedule')
check('a protocol-relative URL is ignored', R.pushPathFor('swap.open', { url: '//evil.example' }) === '/staff/schedule')
check('a javascript: URL is ignored', R.pushPathFor('x', { url: 'javascript:alert(1)' }) === '/staff/schedule')
check('everything from the scheduler defaults to the schedule', ['swap.request', 'schedule.published', 'request.approved'].every((k) => R.pushPathFor(k, { tab: 'requests' }) === '/staff/schedule'))
check('no link at all is fine', R.pushPathFor('swap.open', null) === '/staff/schedule')

section('wiring')
const api = read('src/app/api/staff/push/route.ts')
check('subscribing takes the person from the session, never the body', /resolveStaffIdentity\(\)/.test(api) && /staff_id: me\.id/.test(api) && !/staff_id:\s*input/.test(api))
check('unsubscribe and status are scoped to the signed-in person', (api.match(/\.eq\('staff_id', me\.id\)/g) ?? []).length >= 2)
check('only https push endpoints are accepted', /startsWith\('https:\/\/'\)/.test(api))
const cron = read('src/app/api/cron/staff-push/route.ts')
check('the cron route accepts only CRON_SECRET or the database-held secret, otherwise 401', /process\.env\.CRON_SECRET/.test(cron) && /staff_push_verify_cron/.test(cron) && /if \(!allowed\) throw Unauthorized/.test(cron) && /bearer\.length >= 32/.test(cron))
check('an unset CRON_SECRET can never match an empty bearer', /!!envSecret && bearer === envSecret/.test(cron))
const sw = read('public/sw.js')
check('the service worker tags staff alerts so they replace instead of stacking', /tag: typeof data\.tag === 'string'/.test(sw))
check('a tap opens the staff app, never an arbitrary page', /\|\| '\/staff'/.test(sw))
// The bodies moved out of the pages 2026-10-15 (the developer's single dashboard shows them as lenses).
const ownerDash = read('src/components/dashboard/OwnerDashboard.tsx')
check('the card is on the staff home and the owner dashboard', /<StaffPushCard/.test(read('src/components/dashboard/EmployeeDashboard.tsx')) && /<StaffPushCard/.test(ownerDash))
check('request-driven writes push what they just notified', /afterResponse\(\(\) => flushStaffPush\(\)\)/.test(read('src/app/api/shifts/dispatch/route.ts')))
const push = read('src/lib/push/staff.ts')
check('rows are claimed BEFORE sending (at-most-once, no double sends from overlapping runs)', push.indexOf('.update({ push_sent_at: now })') > -1 && push.indexOf('.update({ push_sent_at: now })') < push.indexOf('sendToOne(service, device, payload)'))
// 2026-10-13: the delivery routine moved to lib/push/deliver.ts so the customer-order alerts
// (lib/push/orders.ts) prune dead subscriptions the same way — assert it where it lives, and that
// BOTH senders go through it rather than carrying a private copy.
const deliver = read('src/lib/push/deliver.ts')
check('a gone subscription (404/410) is deleted', /404 \|\| statusCode === 410/.test(deliver) && /from\('staff_push_subscriptions'\)\.delete\(\)/.test(deliver))
check('the schedule alerts deliver through the shared routine', /from '\.\/deliver'/.test(push) && !/webpush\.sendNotification/.test(push))
const mig = read('supabase/migrations/054_staff_push_notifications.sql')
check('the developer actions are refused server-side for everyone else', /isPushDeveloper\(me\)\) throw Forbidden/.test(api) && /action: z\.literal\('dev_send'\)/.test(api))
check('the developer panel is rendered only on the owner dashboard', (ownerDash.match(/<DevPushPanel/g) ?? []).length === 1)
const dev = read('src/lib/push/dev.ts')
check('developer test rows are stamped read and go through the real inbox + flush', /read_at: now/.test(dev) && /flushStaffPush\(\)/.test(dev) && /from\('schedule_notifications'\)/.test(dev))
const sched = read('supabase/migrations/055_staff_push_scheduler.sql')
check('scheduler migration: runs every 2 minutes under a fixed job name, secret from Vault, guarded for databases without the extensions', /cron\.schedule\('staff-push', '\*\/2 \* \* \* \*'/.test(sched) && /vault\.create_secret|vault\.decrypted_secrets/.test(sched) && /pg_available_extensions/.test(sched) && !/Bearer [0-9a-f]{20,}/.test(sched))
check('migration: RLS on, no browser grants', /enable row level security/.test(mig) && /revoke all on public\.staff_push_subscriptions from public, anon, authenticated/.test(mig))

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
