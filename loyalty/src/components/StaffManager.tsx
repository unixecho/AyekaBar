'use client'

import { useEffect, useState, useCallback } from 'react'
import { BADGE_OPTIONS, badgeMeta } from '@/lib/staff/badges'

interface Member {
  auth_user_id: string
  role: 'staff' | 'owner'
  badge: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  created_at: string
}

const T = {
  title: 'ניהול צוות',
  subtitle: 'הוסף/י אנשי צוות לפי אימייל ושייך/י תפקיד. אנשי צוות נכנסים עם Google.',
  addTitle: 'הוספת איש/אשת צוות',
  emailPh: 'האימייל של איש הצוות (Google)',
  addBtn: 'הוסף',
  adding: 'מוסיף…',
  ownerGrant: 'הרשאת בעלים',
  roster: 'הצוות',
  empty: 'עדיין אין אנשי צוות. הוסף/י את הראשון/ה למעלה.',
  you: 'את/ה',
  makeOwner: 'הפוך/הפכי לבעלים',
  removeOwner: 'הסר/י בעלות',
  remove: 'הסר/י מהצוות',
  confirmRemove: 'להסיר את איש הצוות מהרשימה?',
}

export default function StaffManager({ currentUserId }: { currentUserId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [badge, setBadge] = useState(BADGE_OPTIONS[0].key)
  const [asOwner, setAsOwner] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)

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
    setAdding(true); setAddError(null)
    try {
      const res = await fetch('/api/owner/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, badge, role: asOwner ? 'owner' : 'staff' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'שמירה נכשלה')
      setEmail(''); setAsOwner(false)
      await load()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setAdding(false)
    }
  }

  async function patchMember(authUserId: string, patch: { badge?: string; role?: 'staff' | 'owner' }) {
    setBusyId(authUserId)
    try {
      const res = await fetch('/api/owner/staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authUserId, ...patch }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMembers((cur) => cur?.map((m) => m.auth_user_id === authUserId ? json.member : m) ?? cur)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'עדכון נכשל')
    } finally {
      setBusyId(null)
    }
  }

  async function removeMember(authUserId: string) {
    if (!confirm(T.confirmRemove)) return
    setBusyId(authUserId)
    try {
      const res = await fetch('/api/owner/staff', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authUserId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMembers((cur) => cur?.filter((m) => m.auth_user_id !== authUserId) ?? cur)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'מחיקה נכשלה')
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
        {addError && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: 0, lineHeight: 1.5 }}>{addError}</p>}
        <button type="submit" disabled={adding || !email} className="press" style={addBtnStyle}>
          {adding ? T.adding : T.addBtn}
        </button>
      </form>

      {/* Roster */}
      <div>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 10px' }}>{T.roster}</h3>

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
                key={m.auth_user_id}
                m={m}
                delay={Math.min(i, 8) * 40}
                isSelf={m.auth_user_id === currentUserId}
                busy={busyId === m.auth_user_id}
                onBadge={(badge) => patchMember(m.auth_user_id, { badge })}
                onToggleOwner={() => patchMember(m.auth_user_id, { role: m.role === 'owner' ? 'staff' : 'owner' })}
                onRemove={() => removeMember(m.auth_user_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MemberRow({
  m, delay, isSelf, busy, onBadge, onToggleOwner, onRemove,
}: {
  m: Member; delay: number; isSelf: boolean; busy: boolean
  onBadge: (badge: string) => void
  onToggleOwner: () => void
  onRemove: () => void
}) {
  const meta = badgeMeta(m.badge, m.role)
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ')
    || m.email?.split('@')[0] || 'משתמש'
  const inits = ((m.first_name?.[0] ?? '') + (m.last_name?.[0] ?? '')).trim()
    || (m.email?.[0] ?? '?').toUpperCase()

  return (
    <div className="rise" style={{
      background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14,
      padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10,
      opacity: busy ? 0.55 : 1, transition: 'opacity .2s var(--ease)', animationDelay: `${delay}ms`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div aria-hidden style={{
          width: 42, height: 42, borderRadius: 999, flex: '0 0 auto',
          background: `${meta.color}22`, border: `1px solid ${meta.color}55`, color: meta.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.95rem',
        }}>{inits}</div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            {isSelf && <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)', border: '1px solid var(--line-strong)', borderRadius: 999, padding: '1px 7px' }}>{T.you}</span>}
          </div>
          <div dir="ltr" style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
          <div dir="ltr" style={{ fontSize: '0.62rem', color: 'var(--text-faint)', textAlign: 'start', fontFamily: 'monospace', marginTop: 2 }}>{m.auth_user_id}</div>
        </div>

        <span style={{
          display: 'flex', alignItems: 'center', gap: 5, flex: '0 0 auto',
          background: `${meta.color}18`, border: `1px solid ${meta.color}44`, color: meta.color,
          borderRadius: 999, padding: '4px 10px', fontSize: '0.76rem', fontWeight: 700,
        }}>
          <span>{meta.emoji}</span>{meta.he}
        </span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={m.badge && !['owner'].includes(m.badge) ? m.badge : (BADGE_OPTIONS.find(b => b.key === m.badge)?.key ?? '')}
          onChange={(e) => onBadge(e.target.value)}
          disabled={busy}
          style={selectStyle}
        >
          <option value="" disabled>תפקיד…</option>
          {BADGE_OPTIONS.map((b) => <option key={b.key} value={b.key}>{b.emoji} {b.he}</option>)}
          {m.badge && !BADGE_OPTIONS.some(b => b.key === m.badge) && (
            <option value={m.badge}>{m.badge}</option>
          )}
        </select>

        {!isSelf && (
          <>
            <button type="button" onClick={onToggleOwner} disabled={busy} className="press" style={ghostBtn}>
              {m.role === 'owner' ? T.removeOwner : T.makeOwner}
            </button>
            <button type="button" onClick={onRemove} disabled={busy} className="press"
              style={{ ...ghostBtn, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)', marginInlineStart: 'auto' }}>
              {T.remove}
            </button>
          </>
        )}
      </div>
    </div>
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
const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 9, border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev-2)', color: 'var(--text)', fontSize: '0.82rem',
  fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
}
const ghostBtn: React.CSSProperties = {
  padding: '7px 11px', borderRadius: 9, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text-dim)', fontSize: '0.8rem',
  fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
}
