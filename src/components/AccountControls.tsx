'use client'

import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'

// The customer-facing "my data" controls Israeli privacy law (and plain
// fairness) says a person gets over data collected about them: see it,
// fix it, take a copy, or have it gone. Loyalty club is the only data this
// app collects about a customer today, so this is the only surface these
// need to live on — see CLAUDE.md's Auth model / the 2026-08-31 privacy
// mapping for why nothing else applies yet.

interface Props {
  firstName: string | null
  lastName: string | null
  phone: string | null
}

export default function AccountControls({ firstName, lastName, phone }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [first, setFirst] = useState(firstName ?? '')
  const [last, setLast] = useState(lastName ?? '')
  const [phoneVal, setPhoneVal] = useState(phone ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)

  async function save() {
    // A11y (WCAG 2.4.3): the in-flight guard belongs HERE, not on the
    // button's `disabled` — same fix FeedbackSheet.tsx's own send button
    // already documents: disabling a button that currently has focus
    // blurs it in every browser, so a keyboard user who pressed this would
    // be dropped to <body> at the exact moment the result needs
    // announcing. Found 2026-09-04 — the exact anti-pattern was already
    // fixed once elsewhere in this app and never brought here.
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/customer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: first, lastName: last, phone: phoneVal }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setSaveError(data?.error ?? 'העדכון נכשל')
        return
      }
      setEditing(false)
      router.refresh()
    } catch {
      setSaveError('שגיאה בחיבור לשרת')
    } finally {
      setSaving(false)
    }
  }

  function downloadData() {
    // The route sets Content-Disposition: attachment, so a plain
    // navigation is enough — no need for a manual blob/anchor dance.
    window.location.href = '/api/customer/profile?export=1'
  }

  function requestDelete() {
    // Guards re-entry now that the row button is aria-disabled rather than
    // disabled (see save()'s own comment for why) — a second click while
    // deleting must not re-open the confirm sheet.
    if (deleting) return
    setConfirmRequest({
      title: 'למחוק את החשבון?',
      body: 'הנקודות, ההיסטוריה והפרופיל שלך יימחקו לצמיתות. אי אפשר לבטל את זה.',
      confirmLabel: 'מחק את החשבון שלי',
      onConfirm: async () => {
        if (deleting) return
        setDeleting(true)
        try {
          const res = await fetch('/api/customer/profile', { method: 'DELETE' })
          if (res.ok) {
            router.push('/')
            return
          }
          setDeleting(false)
        } catch {
          setDeleting(false)
        }
      },
    })
  }

  return (
    <div className="rise" style={card}>
      <h2 style={heading}>הנתונים שלי</h2>

      {!editing ? (
        <button type="button" className="press" onClick={() => setEditing(true)} style={rowBtn}>
          <span>ערוך פרטים</span>
          <span aria-hidden style={chev}>‹</span>
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0 10px' }}>
          {/* A11y (WCAG 1.3.5): no autocomplete at all — FeedbackSheet.tsx's
              email field already does this correctly, these three just
              hadn't been brought in line. Found 2026-09-04. */}
          <input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" placeholder="שם פרטי" maxLength={60} style={input} />
          <input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" placeholder="שם משפחה" maxLength={60} style={input} />
          <input value={phoneVal} onChange={(e) => setPhoneVal(e.target.value)} autoComplete="tel" placeholder="טלפון (רשות)" dir="ltr" maxLength={30} style={input} />
          {/* A11y (WCAG 4.1.3): plain text, never announced. */}
          {saveError && <span role="alert" style={{ color: '#ff6b6b', fontSize: '0.82rem' }}>{saveError}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" className="press" disabled={!first.trim()}
              aria-disabled={saving} aria-busy={saving}
              onClick={save} style={{ ...primaryBtn, opacity: saving || !first.trim() ? 0.5 : 1, cursor: saving ? 'progress' : primaryBtn.cursor }}
            >
              {saving ? 'שומר...' : 'שמור'}
            </button>
            <button type="button" className="press" onClick={() => { setEditing(false); setSaveError(null); setFirst(firstName ?? ''); setLast(lastName ?? ''); setPhoneVal(phone ?? '') }} style={secondaryBtn}>
              ביטול
            </button>
          </div>
        </div>
      )}

      <button type="button" className="press" onClick={downloadData} style={rowBtn}>
        <span>הורד את הנתונים שלי</span>
        <span aria-hidden style={chev}>‹</span>
      </button>

      <button
        type="button" className="press" onClick={requestDelete}
        aria-disabled={deleting} aria-busy={deleting}
        style={{ ...rowBtn, color: '#ff6b6b', opacity: deleting ? 0.6 : 1, cursor: deleting ? 'progress' : rowBtn.cursor }}
      >
        <span>{deleting ? 'מוחק...' : 'מחק את החשבון שלי'}</span>
        <span aria-hidden style={chev}>‹</span>
      </button>

      <ConfirmSheet request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  )
}

const card: CSSProperties = {
  background: 'var(--bg-elev)', border: '1px solid var(--line)',
  borderRadius: 18, padding: '18px 20px', display: 'flex', flexDirection: 'column',
}
const heading: CSSProperties = { fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 6px' }
const rowBtn: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  width: '100%', padding: '13px 2px', border: 'none', borderTop: '1px solid var(--line)',
  background: 'transparent', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer', textAlign: 'start',
}
const chev: CSSProperties = { color: 'var(--text-faint)', fontSize: '1.1rem', transform: 'scaleX(-1)' }
const input: CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 10,
  border: '1px solid var(--line-strong)', background: 'var(--bg)',
  color: 'var(--text)', fontSize: '0.92rem', fontFamily: 'inherit',
}
const primaryBtn: CSSProperties = {
  flex: 1, padding: '11px 0', borderRadius: 10, border: 'none',
  // WCAG 1.4.3: white on solid --neon computes to 3.04:1, under 4.5:1.
  background: 'var(--neon)', color: 'var(--bg)', fontSize: '0.9rem', fontWeight: 700,
  fontFamily: 'inherit', cursor: 'pointer',
}
const secondaryBtn: CSSProperties = {
  flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text-dim)', fontSize: '0.9rem', fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer',
}
