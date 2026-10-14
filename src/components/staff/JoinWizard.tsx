'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AuthHandoff, GoogleG } from '@/components/AuthHandoff'
import StaffPushCard from '@/components/staff/StaffPushCard'
import { haptic } from '@/lib/haptics'
import {
  WIZARD_STEPS, joinPath, messageFor, progressIndex, wizardStep,
  type ClaimReason, type JoinStatus,
} from '@/lib/staff/join'

// The onboarding wizard (2026-10-14) — a new employee's first minute.
//
//   welcome → connect Google → confirm the account → done
//
// "They must link their account with Gmail in order to access the shift system": this is the screen that does the
// linking. It is a wizard rather than a single button because the one mistake that matters is linking the WRONG
// Google account (a personal one on a shared phone, the owner's own while testing the link) — so after Google
// returns, the account that came back is shown by name and the person confirms it, or swaps it, before anything is
// written.
//
// Everything that decides anything lives on the server (migration 059 + /api/join/claim). This component only
// walks the person through it, and every refusal is a sentence from lib/staff/join.ts — never a code.
//
// The Google hand-off is the house two-step interstitial (AuthHandoff), in its `staff` wording: any new Google
// sign-in surface uses it (CLAUDE.md).

export interface JoinWizardProps {
  /** '' when the link was malformed — the wizard then shows the dead end without ever asking the server. */
  token: string
  status: JoinStatus
  firstName: string | null
  badgeLabel: string | null
  signedInEmail: string | null
  /** The signed-in account is already on the roster (so this link cannot be used with it). */
  alreadyStaff: boolean
  notSetUp: boolean
  limited: boolean
}

export default function JoinWizard(p: JoinWizardProps) {
  const supabase = createClient()
  const [introSeen, setIntroSeen] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<ClaimReason | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const signedIn = !!p.signedInEmail
  const step = wizardStep({ status: p.status, signedIn, claimed, introSeen })

  useEffect(() => { document.title = 'הצטרפות לצוות · אייכה בר' }, [])
  // Each screen is announced: focus moves to its heading so a screen-reader user lands on the new content.
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [step, refusal])

  async function startGoogle() {
    setBusy(true); setError(null)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Back to THIS page, signed in. /auth/callback only ever follows a same-origin path.
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(joinPath(p.token))}`,
        // Force the account chooser — the whole point of this screen is picking the right account.
        queryParams: { prompt: 'select_account' },
      },
    })
    if (err) { setBusy(false); setError('שגיאה בהתחברות ל-Google. נסו שוב.') }
    // success → the browser leaves for Google
  }

  async function switchAccount() {
    setBusy(true); setError(null)
    try { await fetch('/api/auth/signout', { method: 'POST' }) } catch { /* the chooser below still works */ }
    await startGoogle()
  }

  async function confirm() {
    setBusy(true); setError(null); setRefusal(null)
    try {
      const res = await fetch('/api/join/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: p.token }),
      })
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; message?: string }
      if (res.ok && json.ok) { haptic('impact'); setClaimed(true); return }
      const known = json.error && json.error in KNOWN ? (json.error as ClaimReason) : null
      if (known) setRefusal(known)
      else setError(json.message ?? 'משהו השתבש. נסו שוב.')
    } catch {
      setError('אין חיבור. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  const who = p.firstName ?? 'חבר/ת צוות'

  return (
    <main id="main" tabIndex={-1} style={pageStyle}>
      <div style={cardStyle}>
        <header className="rise" style={{ textAlign: 'center', animationDelay: '30ms' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.svg" alt="" width={48} height={48}
            style={{ display: 'block', margin: '0 auto 8px', filter: 'drop-shadow(0 0 16px rgba(255,94,58,0.4))' }} />
          <div style={brandStyle}>אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר</div>
        </header>

        {step !== 'dead' && <Progress index={progressIndex(step)} />}

        {/* ── dead end: the link cannot be used ──────────────────────────── */}
        {step === 'dead' && (
          <Dead
            headingRef={headingRef}
            title={p.notSetUp ? 'ההצטרפות בקישור עדיין לא הופעלה' : p.limited ? 'יותר מדי ניסיונות' : messageFor(p.status === 'ok' ? 'unknown' : p.status).title}
            body={p.notSetUp ? 'פנו למנהל.' : p.limited ? 'נסו שוב בעוד כמה דקות.' : messageFor(p.status === 'ok' ? 'unknown' : p.status).body}
            signedIn={signedIn}
          />
        )}

        {/* ── 1 · welcome ────────────────────────────────────────────────── */}
        {step === 'welcome' && (
          <section className="rise" style={sectionStyle} aria-labelledby="join-h">
            <div aria-hidden style={{ fontSize: '2.2rem', textAlign: 'center' }}>👋</div>
            <h1 id="join-h" ref={headingRef} tabIndex={-1} style={h1Style}>ברוכים הבאים, {who}</h1>
            <p style={leadStyle}>
              הוספנו אתכם לצוות של אייכה בר{p.badgeLabel ? <> בתור <strong style={{ color: 'var(--text)' }}>{p.badgeLabel}</strong></> : null}.
              עוד רגע ותוכלו לראות את המשמרות שלכם.
            </p>
            <ol style={listStyle}>
              <li><Num n={1} /> מחברים חשבון Google (Gmail)</li>
              <li><Num n={2} /> מאשרים שזה החשבון הנכון</li>
              <li><Num n={3} /> רואים את הסידור ומקבלים עדכונים</li>
            </ol>
            <button type="button" className="press" style={primaryBtn} onClick={() => { haptic('select'); setIntroSeen(true) }}>
              בואו נתחבר
            </button>
          </section>
        )}

        {/* ── 2 · connect ────────────────────────────────────────────────── */}
        {step === 'connect' && (
          <section className="rise" style={sectionStyle} aria-labelledby="join-h">
            <h1 id="join-h" ref={headingRef} tabIndex={-1} style={h1Style}>חיבור חשבון Google</h1>
            <p style={leadStyle}>
              כדי לראות את הסידור צריך לחבר חשבון Google — Gmail או כל חשבון Google אחר. בחרו את החשבון שבו אתם משתמשים
              בדרך כלל; הוא יהיה הכניסה שלכם לצוות.
            </p>
            <ul style={factsStyle}>
              <li>🔒 אנחנו מקבלים רק את השם והאימייל</li>
              <li>⚡ בלי סיסמה חדשה לזכור</li>
            </ul>
            {error && <p role="alert" style={errorStyle}>{error}</p>}
            <button type="button" className="press" style={googleBtn} onClick={() => setAuthOpen(true)} disabled={busy}>
              <GoogleG size={18} />המשך עם Google
            </button>
            <button type="button" className="press" style={linkBtn} onClick={() => setIntroSeen(false)}>← חזרה</button>
          </section>
        )}

        {/* ── 3 · confirm ────────────────────────────────────────────────── */}
        {step === 'confirm' && !claimed && (
          <section className="rise" style={sectionStyle} aria-labelledby="join-h">
            {p.alreadyStaff || refusal === 'already_staff' ? (
              <>
                <h1 id="join-h" ref={headingRef} tabIndex={-1} style={h1Style}>{messageFor('already_staff').title}</h1>
                <p style={leadStyle}>{messageFor('already_staff').body}</p>
                <AccountBox email={p.signedInEmail} />
                <Link href="/staff/dashboard" className="press" style={{ ...primaryBtn, textDecoration: 'none' }}>לאזור הצוות</Link>
                <button type="button" className="press" style={ghostBtn} onClick={switchAccount} disabled={busy}>
                  {busy ? 'מחליף…' : 'החלפת חשבון והמשך'}
                </button>
              </>
            ) : refusal ? (
              <>
                <h1 id="join-h" ref={headingRef} tabIndex={-1} style={h1Style}>{messageFor(refusal).title}</h1>
                <p style={leadStyle}>{messageFor(refusal).body}</p>
                <AccountBox email={p.signedInEmail} />
                {(refusal === 'not_google' || refusal === 'no_user') && (
                  <button type="button" className="press" style={ghostBtn} onClick={switchAccount} disabled={busy}>
                    {busy ? 'מחליף…' : 'החלפת חשבון'}
                  </button>
                )}
              </>
            ) : (
              <>
                <h1 id="join-h" ref={headingRef} tabIndex={-1} style={h1Style}>זה החשבון הנכון?</h1>
                <p style={leadStyle}>
                  החשבון הזה יהיה הכניסה של <strong style={{ color: 'var(--text)' }}>{who}</strong>
                  {p.badgeLabel ? ` (${p.badgeLabel})` : ''} לצוות אייכה בר.
                </p>
                <AccountBox email={p.signedInEmail} />
                {error && <p role="alert" style={errorStyle}>{error}</p>}
                <button type="button" className="press" style={primaryBtn} onClick={confirm} disabled={busy}>
                  {busy ? 'מחבר…' : 'אישור וחיבור'}
                </button>
                <button type="button" className="press" style={ghostBtn} onClick={switchAccount} disabled={busy}>
                  זה לא החשבון שלי — החלפה
                </button>
              </>
            )}
          </section>
        )}

        {/* ── 4 · done ───────────────────────────────────────────────────── */}
        {step === 'done' && (
          <section className="rise" style={sectionStyle} aria-labelledby="join-h" role="status">
            <div aria-hidden style={{ fontSize: '2.2rem', textAlign: 'center' }}>✅</div>
            <h1 id="join-h" ref={headingRef} tabIndex={-1} style={h1Style}>החשבון חובר</h1>
            <p style={leadStyle}>
              {p.signedInEmail ? <><bdi dir="ltr">{p.signedInEmail}</bdi> מחובר עכשיו לצוות. </> : null}
              מעכשיו אפשר לראות את המשמרות ולבקש החלפות.
            </p>
            <Link href="/staff/dashboard" className="press" style={{ ...primaryBtn, textDecoration: 'none' }}>לאזור הצוות</Link>
            <Link href="/staff/schedule" className="press" style={{ ...ghostBtn, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              🗓️ המשמרות שלי
            </Link>
            {/* The last step the scheduler rebuild already designed a card for: alerts on this phone. */}
            <div style={{ textAlign: 'start' }}><StaffPushCard variant="wizard" /></div>
          </section>
        )}
      </div>

      <AuthHandoff
        open={authOpen} busy={busy} error={error} lang="he" variant="staff"
        onContinue={startGoogle}
        onClose={() => { setAuthOpen(false); setError(null) }}
      />
    </main>
  )
}

const KNOWN: Record<ClaimReason, true> = {
  unknown: true, no_user: true, not_google: true, revoked: true, used: true, expired: true, inactive: true,
  owner_role: true, taken: true, already_staff: true, email_in_use: true,
}

function Progress({ index }: { index: number }) {
  return (
    <ol aria-label="שלבי ההצטרפות" style={{ display: 'flex', justifyContent: 'center', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
      {WIZARD_STEPS.map((s, i) => (
        <li key={s.key} aria-current={i === index ? 'step' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{
            width: i === index ? 22 : 8, height: 8, borderRadius: 999,
            background: i <= index ? 'var(--neon)' : 'var(--line-strong)',
            transition: 'width .3s var(--ease), background .3s var(--ease)',
          }} />
          <span className="sr-only" style={srOnly}>{s.label}{i === index ? ' (השלב הנוכחי)' : ''}</span>
        </li>
      ))}
    </ol>
  )
}

function Num({ n }: { n: number }) {
  return (
    <span aria-hidden style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 999,
      background: 'rgba(255,138,92,0.14)', color: 'var(--neon-soft)', fontSize: '0.78rem', fontWeight: 800, flex: '0 0 auto',
    }}>{n}</span>
  )
}

function AccountBox({ email }: { email: string | null }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg)', border: '1px solid var(--line-strong)',
      borderRadius: 14, padding: '12px 14px',
    }}>
      <span aria-hidden style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 999, background: '#fff', flex: '0 0 auto' }}>
        <GoogleG size={18} />
      </span>
      <div style={{ minWidth: 0, textAlign: 'start' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>מחובר/ת כעת עם</div>
        <div dir="ltr" style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)', overflowWrap: 'anywhere', textAlign: 'start' }}>{email ?? '—'}</div>
      </div>
    </div>
  )
}

function Dead({ headingRef, title, body, signedIn }: {
  headingRef: React.RefObject<HTMLHeadingElement>; title: string; body: string; signedIn: boolean
}) {
  return (
    <section className="rise" style={sectionStyle} aria-labelledby="join-h">
      <div aria-hidden style={{
        width: 64, height: 64, margin: '0 auto', borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: '1.7rem',
        background: 'radial-gradient(closest-side, rgba(251,191,36,0.2), rgba(251,191,36,0.04))', border: '1px solid rgba(251,191,36,0.35)',
      }}>🔗</div>
      <h1 id="join-h" ref={headingRef} tabIndex={-1} style={h1Style}>{title}</h1>
      <p style={leadStyle}>{body}</p>
      {signedIn
        ? <Link href="/staff/dashboard" className="press" style={{ ...primaryBtn, textDecoration: 'none' }}>לאזור הצוות</Link>
        : <Link href="/login" className="press" style={{ ...ghostBtn, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>לדף הכניסה</Link>}
    </section>
  )
}

// ── styles ─────────────────────────────────────────────────────────────────
const pageStyle: CSSProperties = {
  minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  // /join is a customer-area route (the accessibility widget is on here, unlike /staff and /owner), so the bottom
  // keeps a 48px button + 16px gutter + breathing room clear: the last control is never under it.
  padding: 'calc(env(safe-area-inset-top) + 20px) 16px calc(env(safe-area-inset-bottom) + 84px)',
  background: 'radial-gradient(ellipse 80% 40% at 85% -5%, rgba(255,94,58,0.14), transparent 60%), var(--bg)',
}
const cardStyle: CSSProperties = {
  width: '100%', maxWidth: 400, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 22,
  padding: '26px 20px', display: 'flex', flexDirection: 'column', gap: 18,
}
const brandStyle: CSSProperties = {
  fontSize: '1.5rem', fontWeight: 800, color: 'var(--text)', textShadow: '0 0 18px rgba(255,94,58,0.5)',
}
const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'start' }
const h1Style: CSSProperties = { margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--text)', textAlign: 'center', outline: 'none' }
const leadStyle: CSSProperties = { margin: 0, fontSize: '0.92rem', color: 'var(--text-dim)', lineHeight: 1.65, textAlign: 'center' }
const listStyle: CSSProperties = {
  margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10,
  fontSize: '0.9rem', color: 'var(--text)',
}
const factsStyle: CSSProperties = {
  margin: 0, padding: '12px 14px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8,
  fontSize: '0.86rem', color: 'var(--text-dim)', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--bg)',
}
const errorStyle: CSSProperties = { margin: 0, fontSize: '0.86rem', fontWeight: 600, color: '#ff6b6b', lineHeight: 1.5, textAlign: 'center' }
const primaryBtn: CSSProperties = {
  minHeight: 48, width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)',
  color: 'var(--bg)', fontSize: '1rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const googleBtn: CSSProperties = {
  minHeight: 48, width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', background: '#fff', color: '#1a1c1e',
  fontSize: '1rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
}
const ghostBtn: CSSProperties = {
  minHeight: 46, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text)', fontSize: '0.92rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const linkBtn: CSSProperties = {
  alignSelf: 'center', minHeight: 44, padding: '8px 16px', background: 'none', border: 0, color: 'var(--text-faint)',
  fontSize: '0.85rem', fontFamily: 'inherit', cursor: 'pointer',
}
const srOnly: CSSProperties = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
