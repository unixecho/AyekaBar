#!/usr/bin/env node
// The app-level security rails from the 2026-11-03 audit: the /api guard in middleware, the push endpoint allow-list, the
// response headers, and the loyalty switch on its API routes. Pure rules run as the real TypeScript; the wiring is read
// as text.
//
//   node scripts/check-security.mjs

import ts from 'typescript'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const outDir = join(tmpdir(), `ayeka-security-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })
async function load(file) {
  const out = join(outDir, file.replace(/[\\/]/g, '_').replace(/\.ts$/, '.mjs'))
  writeFileSync(out, ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  return import(pathToFileURL(out).href)
}

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)

const G = await load('src/lib/http/api-guard.ts')
const E = await load('src/lib/push/endpoint.ts')
const HOST = 'www.ayeka.bar'
const req = (over) => ({ method: 'POST', pathname: '/api/owner/staff', origin: `https://${HOST}`, host: HOST, contentLength: '20', ...over })
const status = (over) => G.apiRefusal(req(over))?.status ?? null

section('same-origin')
check('our own origin passes', status({}) === null)
check('another site is refused', status({ origin: 'https://evil.example' }) === 403)
check('a SUBDOMAIN is refused: it is the same site, so SameSite=Lax does not stop it', status({ origin: 'https://staff.ayeka.bar' }) === 403)
check('the bare domain is refused too (the site lives on www)', status({ origin: 'https://ayeka.bar' }) === 403)
check('a look-alike host is refused', status({ origin: 'https://www.ayeka.bar.evil.example' }) === 403)
check('an http downgrade with a different port is refused', status({ origin: 'http://www.ayeka.bar:8080' }) === 403)
check('the "null" origin of a sandboxed frame is refused', status({ origin: 'null' }) === 403)
check('garbage is refused', status({ origin: '::::' }) === 403)
check('every state-changing method is covered', ['POST', 'PUT', 'PATCH', 'DELETE'].every((method) => status({ method, origin: 'https://evil.example' }) === 403))
check('a missing Origin reaches the route, whose session check still applies', status({ origin: null }) === null)
check('reads are not affected', ['GET', 'HEAD', 'OPTIONS'].every((method) => status({ method, origin: 'https://evil.example', contentLength: null }) === null))
check('pages are not affected', status({ pathname: '/owner/staff', origin: 'https://evil.example' }) === null)
check('a path that merely starts with "api" is not treated as the API', status({ pathname: '/apiary', origin: 'https://evil.example' }) === null)
check('the POS route keeps its own origin list', status({ pathname: '/api/push/staff-event', origin: 'https://staff.ayeka.bar' }) === null)
check('…and no other route is exempt', G.API_CROSS_ORIGIN_ROUTES.length === 1)

section('body size')
check('a body with no declared length is refused', status({ contentLength: null }) === 411)
check('…on PUT and PATCH as well', ['PUT', 'PATCH'].every((method) => status({ method, contentLength: null }) === 411))
check('a bodyless DELETE passes', status({ method: 'DELETE', contentLength: null }) === null)
check('sign-out and the QR route may omit it', G.API_BODYLESS_ROUTES.every((pathname) => status({ pathname, contentLength: null }) === null))
check('a bad length is refused', status({ contentLength: '12abc' }) === 400 && status({ contentLength: '-1' }) === 400)
check('at the ceiling passes', status({ contentLength: String(G.API_BODY_CEILING_BYTES) }) === null)
check('above the ceiling is refused', status({ contentLength: String(G.API_BODY_CEILING_BYTES + 1) }) === 413)
check('upload routes may exceed it', G.API_UPLOAD_ROUTES.every((pathname) => status({ pathname, contentLength: String(8 * 1024 * 1024) }) === null))

section('the route lists match the routes on disk')
{
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
  const routes = walk(join(ROOT, 'src/app/api')).filter((p) => p.endsWith('route.ts'))
  const toPath = (p) => '/api/' + p.slice(join(ROOT, 'src/app/api').length + 1).replace(/\\/g, '/').replace(/\/route\.ts$/, '')
  const bodyless = routes.filter((p) => {
    const s = readFileSync(p, 'utf8')
    return /export (async function|const) (POST|PUT|PATCH)\b/.test(s) && !/request\.(json|formData|text)\(\)/.test(s)
  }).map(toPath).sort()
  check('every POST route that reads no body is listed, and only those', JSON.stringify(bodyless) === JSON.stringify([...G.API_BODYLESS_ROUTES].sort()), bodyless.join(', '))
  const paths = routes.map(toPath)
  check('every listed upload route exists', G.API_UPLOAD_ROUTES.every((r) => paths.includes(r)))
  check('the cross-origin route exists', G.API_CROSS_ORIGIN_ROUTES.every((r) => paths.includes(r)))
}

section('middleware wiring')
{
  const mw = read('src/proxy.ts')
  check('the guard runs before any Supabase call', mw.indexOf('apiRefusal(') > 0 && mw.indexOf('apiRefusal(') < mw.indexOf('createServerClient('))
  check('the matcher does not skip /api', !/\(\?!api|\(\?!.*\|api\|/.test(mw))
  check('a deactivated row opens nothing', /\.eq\('active', true\)/.test(mw) && /\.eq\('active', true\)/.test(read('src/lib/owner/guard.ts')) && /\.eq\('active', true\)/.test(read('src/lib/staff/guard.ts')))
}

section('push endpoints')
for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QAbc', 'https://api.push.apple.com/x', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://updates.push.services.mozilla.com/wpush/v2/x']) {
  check(`allowed: ${new URL(ok).hostname}`, E.isAllowedPushEndpoint(ok))
}
for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://evilpush.apple.com/x',
  'https://fcm.googleapis.com@evil.example/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://169.254.169.254/latest', 'https://localhost/x', 'not a url', '']) {
  check(`refused: ${bad || '(empty)'}`, !E.isAllowedPushEndpoint(bad))
}
check('checked when a subscription is saved', /refine\(isAllowedPushEndpoint/.test(read('src/app/api/staff/push/route.ts')))
{
  const d = read('src/lib/push/deliver.ts')
  check('checked again before anything is sent', d.indexOf('isAllowedPushEndpoint(row.endpoint)') > 0 && d.indexOf('isAllowedPushEndpoint(row.endpoint)') < d.indexOf('sendNotification'))
}

section('response headers')
{
  const cfg = read('next.config.mjs')
  for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "default-src 'self'", 'connect-src']) {
    check(`CSP carries ${d}`, cfg.includes(d))
  }
  check("production scripts get no 'unsafe-eval' or remote host", /isProd \? '' : " 'unsafe-eval'/.test(cfg))
  check('Permissions-Policy is set', /Permissions-Policy/.test(cfg))
  check('X-Powered-By is off', /poweredByHeader: false/.test(cfg))
  check('the image optimizer is off', /images: \{ unoptimized: true \}/.test(cfg))
}
{
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
  const uses = walk(join(ROOT, 'src')).filter((p) => /\.tsx?$/.test(p) && /from ['"]next\/image['"]/.test(readFileSync(p, 'utf8')))
  check('nothing imports next/image, so turning the optimizer off breaks nothing', uses.length === 0, uses.join(', '))
}
{
  const lock = JSON.parse(read('package-lock.json'))
  // Next 15+ pulls sharp in as its own optional dependency, so "not installed" can no longer be the rule. What keeps it
  // out of reach is that nothing can ask for it: the optimizer is switched off and nothing imports next/image.
  check('the image optimizer, the only caller of sharp, is switched off', /images: { unoptimized: true }/.test(read('next.config.mjs')))
  const [major, minor, patch] = lock.packages['node_modules/next'].version.split('.').map(Number)
  check('Next is on a release that carries the 2026 Server Components DoS fixes (16.4.1 or newer)', major > 16 || (major === 16 && (minor > 4 || (minor === 4 && patch >= 1))), lock.packages['node_modules/next'].version)
}

section('the loyalty switch holds on its API routes')
for (const f of ['src/app/api/loyalty/checkin/route.ts', 'src/app/api/rewards/redeem/route.ts', 'src/app/api/loyalty/generate-qr/route.ts']) {
  check(`${f.split('/').slice(-2, -1)[0]} re-reads it`, /await getLoyaltyEnabled\(\)/.test(read(f)))
}
check('an oversized QR token never reaches fraud_log', read('src/app/api/loyalty/checkin/route.ts').indexOf('MAX_TOKEN_LENGTH') > 0)

section('this public repository stays clean')
{
  const ignore = read('.gitignore')
  for (const f of ['.env.local', '.migration-backup/', 'AGENTS.md', '.codex/', '.mcp.json', 'CLAUDE.md', 'HANDOFF.md']) {
    check(`ignored: ${f}`, ignore.split(/\r?\n/).includes(f))
  }
}

section('zod — the version the audit asked for, and a bad body is still the caller\'s 400')
{
  const { z, ZodError } = await import('zod')
  const pkg = JSON.parse(read('node_modules/zod/package.json'))
  const [major, minor, patch] = pkg.version.split('.').map(Number)
  check('zod is at least 4.6.6 (GHSA-mrhx-c7xc-m3w5)', major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6))), pkg.version)
  let caught = null
  try { z.object({ a: z.string().uuid() }).strict().parse(null) } catch (e) { caught = e }
  check('parse() throws what apiRoute catches as ZodError', caught instanceof ZodError)
  check('the failing path of a null body is empty, so it reads (body)', caught?.issues?.[0]?.path?.length === 0)
  check('apiRoute still maps ZodError to a 400', /err instanceof ZodError[\s\S]{0,200}ApiError\(400/.test(read('src/lib/http/errors.ts')))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('FAILED:'); failures.forEach((f) => console.log(`  ${f}`)); process.exit(1) }
