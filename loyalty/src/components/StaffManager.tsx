'use client'

import { useEffect, useState, useCallback } from 'react'
import { BADGE_OPTIONS, badgeMeta, PERMISSION_META } from '@/lib/staff/badges'
import RolePicker from '@/components/RolePicker'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'

interface Member {
  id: string
  /** null = pending invite: authorized by email, hasn't signed in with Google yet. */
  auth_user_id: string | null
  role: 'staff' | 'owner'
  badge: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  created_at: string
  invited_at: string | null
  claimed_at: string | null
  /** Published on the public /team page? */
  show_on_site: boolean
  display_order: number | null
  /** Public-facing name override (e.g. Hebrew spelling). */
  display_name: string | null
}

const T = {
  title: 'ניהול צוות',
  subtitle: 'הוסף/י אנשי צוות לפי אימייל — גם לפני שנכנסו לראשונה. בכניסה עם Google הם יזוהו אוטומטית ויקבלו גישה לחלון הצוות.',
  addTitle: 'הוספת איש/אשת צוות',
  emailPh: 'האימייל של איש הצוות (Google)',
  addBtn: 'הוסף',
  adding: 'מוסיף…',
  ownerGrant: 'הרשאות ניהול',
  roster: 'הצוות',
  empty: 'עדיין אין אנשי צוות. הוסף/י את הראשון/ה למעלה.',
  you: 'את/ה',
  makeOwner: 'תן/י הרשאות',
  removeOwner: 'בטל/י הרשאות',
  displayNameLabel: 'שם לתצוגה באתר',
  displayNamePh: 'למשל: אופיר מינץ',
  displayNameHint: 'ברירת מחדל: השם מחשבון Google. כאן אפשר לקבוע איך השם ייכתב בעמוד הצוות — גם ראשי התיבות יתעדכנו.',
  remove: 'הסר/י מהצוות',
  revoke: 'בטל/י הזמנה',
  confirmRemove: 'להסיר את איש הצוות?',
  confirmRemoveBody: 'הגישה שלו/ה לחלון הצוות תיפסק מיד, והוא/היא ייעלמו מעמוד הצוות באתר.',
  confirmRevoke: 'לבטל את ההזמנה?',
  confirmRevokeBody: 'האימייל הזה כבר לא יוכל להיכנס לחלון הצוות.',
  pending: 'ממתין לכניסה ראשונה',
  pendingNote: 'ההרשאה תיכנס לתוקף ברגע שיתחבר/תתחבר עם Google מהאימייל הזה.',
  active: 'מחובר/ת',
  addedPending: 'נוסף/ה. ההרשאה תופעל בכניסה הראשונה עם Google מהאימייל הזה.',
  addedActive: 'נוסף/ה לצוות. הגישה פעילה מיד.',
  updated: 'האימייל כבר היה ברשימה — התפקיד עודכן.',
}

type Notice = { kind: 'ok' | 'err'; text: string } | null

export default function StaffManager({ currentUserId }: { currentUserId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [badge, setBadge] = useState(BADGE_OPTIONS[0].key)
  const [asOwner, setAsOwner] = useState(false)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch('/api/owner/staff', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'load failed')
      setMembers(json.staff)
    } catch {
      setLoadError('טעינת הצוות נכשלה.')
      setMembers([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function addMember(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true); setNotice(null)
    try {
      const res = await fetch('/api/owner/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, badge, role: asOwner ? 'owner' : 'staff' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'שמירה נכשלה')
      setEmail(''); setAsOwner(false)
      setNotice({
        kind: 'ok',
        text: json.updated ? T.updated : json.pending ? T.addedPending : T.addedActive,
      })
      await load()
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'שמירה נכשלה' })
    } finally {
      setAdding(false)
    }
  }

  async function patchMember(
    id: string,
    patch: {
      badge?: string; role?: 'staff' | 'owner'
      showOnSite?: boolean; displayName?: string | null
    },
  ) {
    setBusyId(id)
    try {
      const res = await fetch('/api/owner/staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMembers((cur) => cur?.map((m) => m.id === id ? json.member : m) ?? cur)
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'עדכון נכשל' })
    } finally {
      setBusyId(null)
    }
  }

  function askRemove(m: Member) {
    const pending = !m.auth_user_id
    setConfirmReq({
      title: pending ? T.confirmRevoke : T.confirmRemove,
      body: pending ? T.confirmRevokeBody : T.confirmRemoveBody,
      confirmLabel: pending ? T.revoke : T.remove,
      onConfirm: () => { void removeMember(m) },
    })
  }

  async function removeMember(m: Member) {
    setBusyId(m.id)
    try {
      const res = await fetch('/api/owner/staff', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMembers((cur) => cur?.filter((x) => x.id !== m.id) ?? cur)
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'מחיקה נכשלה' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{T.title}</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.5 }}>{T.subtitle}</p>
      </div>

      {/* Add form */}
      <form onSubmit={addMember} className="rise" style={{ ...cardStyle, animationDelay: '60ms' }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>{T.addTitle}</div>
        <input
          type="email" required dir="ltr" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder={T.emailPh}
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {BADGE_OPTIONS.map((b) => {
            const active = badge === b.key
            return (
              <button
                type="button" key={b.key} onClick={() => setBadge(b.key)}
                className="press"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999,
                  border: `1px solid ${active ? b.color : 'var(--line-strong)'}`,
                  background: active ? `${b.color}22` : 'transparent',
                  color: active ? b.color : 'var(--text-dim)',
                  fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                <span>{b.emoji}</span>{b.he}
              </button>
            )
          })}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-dim)', cursor: 'pointer' }}>
          <input type="checkbox" checked={asOwner} onChange={(e) => setAsOwner(e.target.checked)} />
          {T.ownerGrant} ⭐
        </label>
        {notice && (
          <p style={{
            color: notice.kind === 'err' ? '#ff6b6b' : 'var(--neon-soft)',
            fontSize: '0.82rem', margin: 0, lineHeight: 1.5,
          }}>{notice.text}</p>
        )}
        <button type="submit" disabled={adding || !email} className="press" style={addBtnStyle}>
          {adding ? T.adding : T.addBtn}
        </button>
      </form>

      {/* Roster */}
      <div>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 12px' }}>{T.roster}</h3>

        {members === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2].map((i) => <SkeletonRow key={i} />)}
          </div>
        ) : loadError ? (
          <p style={{ color: '#ff6b6b', fontSize: '0.85rem' }}>{loadError}</p>
        ) : members.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', textAlign: 'center', padding: '18px 0' }}>{T.empty}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {members.map((m, i) => (
              <MemberRow
                key={m.id}
                m={m}
                delay={Math.min(i, 8) * 40}
                isSelf={!!m.auth_user_id && m.auth_user_id === currentUserId}
                busy={busyId === m.id}
                onBadge={(badge) => patchMember(m.id, { badge })}
                onToggleOwner={() => patchMember(m.id, { role: m.role === 'owner' ? 'staff' : 'owner' })}
                onDisplayName={(displayName) => patchMember(m.id, { displayName })}
                onRemove={() => askRemove(m)}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmSheet request={confirmReq} onClose={() => setConfirmReq(null)} />
    </div>
  )
}

function MemberRow({
  m, delay, isSelf, busy, onBadge, onToggleOwner, onDisplayName, onRemove,
}: {
  m: Member; delay: number; isSelf: boolean; busy: boolean
  onBadge: (badge: string) => void
  onToggleOwner: () => void
  onDisplayName: (name: string | null) => void
  onRemove: () => void
}) {
  const meta = badgeMeta(m.badge, m.role)
  const pending = !m.auth_user_id
  // The roster always identifies people by their REAL name + email — this is
  // where the owner works out who someone is. The display name is a separate,
  // clearly-labelled field below that only affects the public page.
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ')
    || m.email?.split('@')[0] || 'משתמש'
  const inits = ((m.first_name?.[0] ?? '') + (m.last_name?.[0] ?? '')).trim()
    || (m.email?.[0] ?? '?').toUpperCase()

  return (
    <div className="rise" style={{
      background: 'var(--bg-elev)',
      border: `1px solid ${pending ? 'rgba(255,255,255,0.09)' : 'var(--line)'}`,
      borderStyle: pending ? 'dashed' : 'solid',
      borderRadius: 14,
      padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10,
      opacity: busy ? 0.55 : 1, transition: 'opacity .2s var(--ease)', animationDelay: `${delay}ms`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div aria-hidden style={{
          width: 42, height: 42, borderRadius: 999, flex: '0 0 auto',
          background: pending ? 'rgba(255,255,255,0.04)' : `${meta.color}22`,
          border: `1px ${pending ? 'dashed' : 'solid'} ${pending ? 'var(--line-strong)' : `${meta.color}55`}`,
          color: pending ? 'var(--text-faint)' : meta.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.95rem',
        }}>{pending ? '✉' : inits}</div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            {isSelf && <span style={chipStyle}>{T.you}</span>}
            {pending && (
              <span style={{ ...chipStyle, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.35)' }}>
                ⏳ {T.pending}
              </span>
            )}
          </div>
          <div dir="ltr" style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
          {!pending && (
            <div dir="ltr" style={{ fontSize: '0.62rem', color: 'var(--text-faint)', textAlign: 'start', fontFamily: 'monospace', marginTop: 2 }}>{m.auth_user_id}</div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: '0 0 auto' }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: `${meta.color}18`, border: `1px solid ${meta.color}44`, color: meta.color,
            borderRadius: 999, padding: '4px 10px', fontSize: '0.76rem', fontWeight: 700,
            opacity: pending ? 0.75 : 1,
          }}>
            <span>{meta.emoji}</span>{meta.he}
          </span>

          {/* Admin access is its own chip now — a co-owner carries the "בעלים"
              job title AND this, and a general manager can carry this without
              being an owner of the business. */}
          {m.role === 'owner' && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: `${PERMISSION_META.color}18`,
              border: `1px solid ${PERMISSION_META.color}44`, color: PERMISSION_META.color,
              borderRadius: 999, padding: '3px 9px', fontSize: '0.7rem', fontWeight: 700,
            }}>
              <span>{PERMISSION_META.emoji}</span>{PERMISSION_META.he}
            </span>
          )}
        </div>
      </div>

      {pending && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', margin: 0, lineHeight: 1.5 }}>
          {T.pendingNote}
        </p>
      )}

      {/* Display name — public only, so it sits with the site controls. */}
      {!pending && (
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 5 }}>
            {T.displayNameLabel}
          </label>
          <DisplayNameField
            value={m.display_name ?? ''}
            placeholder={name}
            disabled={busy}
            onCommit={onDisplayName}
          />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', margin: '5px 0 0', lineHeight: 1.5 }}>
            {T.displayNameHint}
          </p>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <RolePicker value={m.badge} disabled={busy} onChange={onBadge} />

        {!isSelf && (
          <>
            <button type="button" onClick={onToggleOwner} disabled={busy} className="press" style={ghostBtn}>
              {m.role === 'owner' ? T.removeOwner : T.makeOwner}
            </button>
            <button type="button" onClick={onRemove} disabled={busy} className="press"
              style={{ ...ghostBtn, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)', marginInlineStart: 'auto' }}>
              {pending ? T.revoke : T.remove}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** Local draft + explicit commit on blur/Enter, so every keystroke isn't a
 *  PATCH. Empty clears the override back to the Google name. */
function DisplayNameField({ value, placeholder, disabled, onCommit }: {
  value: string; placeholder: string; disabled: boolean
  onCommit: (name: string | null) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  const commit = () => {
    const next = draft.trim()
    if (next === (value ?? '').trim()) return
    onCommit(next || null)
  }

  return (
    <input
      value={draft} disabled={disabled} placeholder={placeholder} maxLength={60}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur() }
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur() }
      }}
      style={{
        width: '100%', padding: '10px 12px', borderRadius: 11,
        border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)',
        color: 'var(--text)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none',
      }}
    />
  )
}

function SkeletonRow() {
  return (
    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="sk" style={{ width: 42, height: 42, borderRadius: 999, flex: '0 0 auto' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div className="sk" style={{ width: '55%', height: 12, borderRadius: 6 }} />
        <div className="sk" style={{ width: '75%', height: 10, borderRadius: 6 }} />
      </div>
      <div className="sk" style={{ width: 64, height: 22, borderRadius: 999, flex: '0 0 auto' }} />
    </div>
  )
}

const chipStyle: React.CSSProperties = {
  fontSize: '0.68rem', color: 'var(--text-faint)',
  border: '1px solid var(--line-strong)', borderRadius: 999, padding: '1px 7px',
}
const cardStyle: React.CSSProperties = {
  background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 16,
  padding: '16px', display: 'flex', flexDirection: 'column', gap: 12,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 13px', borderRadius: 11,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)',
  color: 'var(--text)', fontSize: '0.95rem', fontFamily: 'inherit', outline: 'none',
}
const addBtnStyle: React.CSSProperties = {
  width: '100%', padding: '11px 0', borderRadius: 11, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
  boxShadow: 'var(--glow)', color: '#fff', fontSize: '0.95rem',
  fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  padding: '7px 11px', borderRadius: 9, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text-dim)', fontSize: '0.8rem',
  fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
}
