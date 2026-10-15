#!/usr/bin/env node
// Harness for the developer's PERMANENT DELETE of a person (2026-10-15).
//
//   node scripts/check-hard-delete.mjs
//
// The owner's rule: "give the dev an option to hard delete users so managers can only deactivate."
// The decisions are pure (lib/staff/hard-delete.ts) so this runs the REAL TypeScript; the claims that matter most are
// structural, so it also reads the routes and the roster as text:
//   • the managers' route can never delete a row — it only deactivates;
//   • the permanent delete lives in its own route behind `requireDev`, never `requireOwner`;
//   • the button is only ever drawn for the developer, and the page decides that from the server-side access row.

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const outDir = join(tmpdir(), `ayeka-hard-delete-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'hd.mjs'), ts.transpileModule(read('src/lib/staff/hard-delete.ts'), {
  fileName: 'hard-delete.ts', compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
}).outputText)
const H = await import(pathToFileURL(join(outDir, 'hd.mjs')).href)

let pass = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) } }
const section = (t) => console.log(`\n${t}`)
const HEBREW = /[֐-׿]/

section('who may be deleted for good')
{
  const ctx = { actorAuthUserId: 'me', payslips: 0 }
  const row = (o = {}) => ({ id: 'x', auth_user_id: null, role: 'staff', active: false, ...o })
  check('a deactivated, ordinary person with no payslips → allowed', H.hardDeleteRefusal(row(), ctx) === null)
  check('nobody → not_found', H.hardDeleteRefusal(null, ctx) === 'not_found')
  check('yourself → refused (even if somehow deactivated)', H.hardDeleteRefusal(row({ auth_user_id: 'me' }), ctx) === 'self')
  check('an owner → refused', H.hardDeleteRefusal(row({ role: 'owner' }), ctx) === 'owner')
  check('someone still active → refused: deactivate first, so it is always two deliberate steps', H.hardDeleteRefusal(row({ active: true }), ctx) === 'still_active')
  check('someone with payslips → refused (payroll records are never silently taken or orphaned)', H.hardDeleteRefusal(row(), { ...ctx, payslips: 2 }) === 'has_payslips')
  check('the most basic reason wins: an active owner is "owner", not "still_active"', H.hardDeleteRefusal(row({ role: 'owner', active: true }), ctx) === 'owner')
  const reasons = ['not_found', 'self', 'owner', 'still_active', 'has_payslips']
  check('every refusal has a Hebrew sentence and a 4xx', reasons.every((r) => HEBREW.test(H.HARD_DELETE_MESSAGES[r]) && H.HARD_DELETE_STATUS[r] >= 400 && H.HARD_DELETE_STATUS[r] < 500))
}

section('what is left behind when orders still point at the person')
{
  const t = H.tombstonePatch()
  check('no name from the person, no address, no photo, no public page, no login',
    t.email === null && t.display_name === null && t.photo_url === null && t.initial === null && t.show_on_site === false && t.auth_user_id === null && t.claimed_at === null && t.active === false)
  check('the placeholder name is the shared constant', t.first_name === H.TOMBSTONE_FIRST_NAME && t.last_name === H.TOMBSTONE_LAST_NAME)
  check('a row wearing it is a tombstone — and a real person never is', H.isTombstone({ ...t }) && !H.isTombstone({ ...t, email: 'a@b.c' }) && !H.isTombstone({ ...t, active: true }) && !H.isTombstone({ first_name: 'עובד', last_name: 'אחר', active: false, email: null }))
  check('a foreign-key violation is recognised by code and by message; other errors are not', H.isForeignKeyViolation({ code: '23503' }) && H.isForeignKeyViolation({ message: 'update or delete violates foreign key constraint' }) && !H.isForeignKeyViolation({ code: '42501', message: 'permission denied' }) && !H.isForeignKeyViolation(null))
  check('the result sentence says what happened, in Hebrew, and flags a login that was kept',
    HEBREW.test(H.hardDeleteDone('deleted', true)) && /אנונימית/.test(H.hardDeleteDone('anonymized', true)) && /לא נמחק/.test(H.hardDeleteDone('deleted', false)))
}

section('wiring (read as text)')
{
  const managers = code('src/app/api/owner/staff/route.ts')
  check('the managers\' route only DEACTIVATES: it never deletes a staff row', !/\.from\('staff'\)\s*\.delete\(/.test(managers) && !/auth\.admin\.deleteUser/.test(managers))
  check('…and it hides anonymous tombstones from the roster', /isTombstone\(/.test(managers))
  const dev = code('src/app/api/owner/dev/staff/route.ts')
  check('the permanent delete is behind requireDev — and never requireOwner', /requireDev\(\)/.test(dev) && !/requireOwner|requireMenuEditor/.test(dev))
  check('…the guard runs before the body is read', dev.indexOf('requireDev()') < dev.indexOf('request.json()'))
  check('…the id must be a UUID, and the call is rate limited', /UUID\.test/.test(dev) && /dev-hard-delete:/.test(dev))
  check('…every refusal comes from the pure rules (self / owner / still active / payslips)', /hardDeleteRefusal\(/.test(dev) && dev.indexOf('hardDeleteRefusal(') < dev.indexOf('.delete()'))
  check('…it deletes the row first and ONLY anonymises on a foreign-key violation', /isForeignKeyViolation\(del\.error\)/.test(dev) && /tombstonePatch\(\)/.test(dev))
  check('…the login is deleted last (it cascades into the staff row, so the row must already be gone or unlinked)', dev.indexOf('tombstonePatch()') < dev.indexOf('auth.admin.deleteUser') && dev.indexOf(".from('staff').delete()") < dev.indexOf('auth.admin.deleteUser'))
  check('…a person\'s private messages to the manager go when the row is only anonymised', /from\('shift_availability'\)\.delete\(\)/.test(dev))
  const ui = code('src/components/StaffManager.tsx')
  check('the button exists only in the "removed" list and only when canHardDelete, never for yourself',
    /onHardDelete=\{canHardDelete && !\(m\.auth_user_id && m\.auth_user_id === currentUserId\)/.test(ui) && /\{onHardDelete && \(/.test(ui))
  check('it asks first with the iOS-style confirm sheet, never window.confirm', /askHardDelete/.test(ui) && !/window\.confirm|confirm\(/.test(ui.replace(/onConfirm|confirmLabel|confirmReq|setConfirmReq|confirmRemove|confirmRevoke|confirmHardDelete|confirmJoin|confirmDelete/g, '')))
  const page = code('src/app/owner/staff/page.tsx')
  check('the page decides canHardDelete from the server-side access row (isDev)', /canHardDelete=\{isDev\(me\)\}/.test(page))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
