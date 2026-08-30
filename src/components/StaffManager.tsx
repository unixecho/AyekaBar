'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { BADGE_OPTIONS, badgeMeta, isManagement } from '@/lib/staff/badges'
import { accessLabel } from '@/lib/staff/access'
import RolePicker from '@/components/RolePicker'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import Switch from '@/components/Switch'

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
  /** false = removed. The row (and their order/audit history) stays intact
   *  — same pattern the floor plan already uses for a deleted table
   *  (migration 028) — and access is revoked (see 041_staff_soft_delete.sql).
   *  Restorable with one tap, same as a removed table. */
  active: boolean
}

const T = {
  title: 'ניהול צוות',
  subtitle: 'הוסף/י אנשי צוות לפי אימייל — גם לפני שנכנסו לראשונה. בכניסה עם Google הם יזוהו אוטומטית ויקבלו גישה לחלון הצוות. מי שלא צריך/ה גישה למערכת אפשר להוסיף בלי אימייל, לשיבוץ בסידור העבודה בלבד.',

  // ── Roster sections (2026-08-29, +removed 2026-08-30) ─────────────
  management: 'הנהלה',
  managementHint: 'בעלים, מנהל/ת כללי/ת ואחראי/ת משמרת. משתנה לעיתים רחוקות.',
  employees: 'עובדים',
  employeesHint: 'שאר הצוות — הרשימה שמתעדכנת באמת.',
  emptyGroup: 'אין אף אחד בקבוצה הזו.',
  removed: 'הוסרו',
  removedHint: 'ההרשאות שלהם בוטלו וההיסטוריה שלהם נשמרה. שחזור מחזיר גישה בכניסה הבאה עם Google.',

  // ── Add-form modes ────────────────────────────────────────────────
  modeAccount: 'עם חשבון',
  modeAccountHint: 'כניסה עם Google, גישה לחלון הצוות ולסידור.',
  modeOffline: 'בלי חשבון',
  modeOfflineHint: 'מופיע/ה בסידור העבודה בלבד. אין כניסה למערכת ואין צורך באימייל.',
  firstNamePh: 'שם פרטי',
  lastNamePh: 'שם משפחה (לא חובה)',
  addedOffline: 'נוסף/ה לצוות לצורכי סידור עבודה. אין למנוי הזה כניסה למערכת.',
  offlineChip: 'לסידור בלבד',
  offlineNote: 'אין חשבון מקושר — אי אפשר להיכנס למערכת ולא להופיע בעמוד הצוות באתר. אפשר לשבץ בסידור העבודה.',
  realNameLabel: 'שם',
  realNameHint: 'השם שיופיע בסידור העבודה.',
  levels: '🔑 הרשאות מלאות = גישה לכל אזור הניהול. תפקיד "בעלים" מקבל זאת אוטומטית. "מנהל/ת כללי/ת" יכול/ה לערוך את התפריט גם בלי הרשאות מלאות. כל השאר — חלון הצוות בלבד (קוד QR).',
  addTitle: 'הוספת איש/אשת צוות',
  emailPh: 'האימייל של איש הצוות (Google)',
  addBtn: 'הוסף',
  adding: 'מוסיף…',
  ownerGrant: 'הרשאות מלאות (גישה לכל אזור הניהול)',
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
  restore: 'שחזור',
  confirmRemove: 'להסיר את איש הצוות?',
  confirmRemoveBody: 'הגישה שלו/ה לחלון הצוות תיפסק מיד, והוא/היא ייעלמו מעמוד הצוות באתר. אפשר לשחזר בכל שלב מרשימת "הוסרו" למטה.',
  confirmRevoke: 'לבטל את ההזמנה?',
  confirmRevokeBody: 'האימייל הזה כבר לא יוכל להיכנס לחלון הצוות. אפשר לשחזר בכל שלב מרשימת "הוסרו" למטה.',
  pending: 'ממתין לכניסה ראשונה',
  pendingNote: 'ההרשאה תיכנס לתוקף ברגע שיתחבר/תתחבר עם Google מהאימייל הזה.',
  active: 'מחובר/ת',
  addedPending: 'נוסף/ה. ההרשאה תופעל בכניסה הראשונה עם Google מהאימייל הזה.',
  addedActive: 'נוסף/ה לצוות. הגישה פעילה מיד.',
  updated: 'האימייל כבר היה ברשימה — התפקיד עודכן.',
  reactivated: 'המנוי שוחזר לצוות.',
  restoredNotice: 'שוחזר/ה לצוות.',
  restoreFailed: 'השחזור נכשל',
  schedulable: 'זמין/ה לסידור עבודה',
  schedulableHint: 'מופיע/ה כמי שאפשר לשבץ במסך סידור העבודה (owner/schedule).',
}

type Notice = { kind: 'ok' | 'err'; text: string } | null

export default function StaffManager({ currentUserId }: { currentUserId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 'account' = the original flow, authorized by Google address.
  // 'offline'  = a roster entry with a name and no way in. See the POST route.
  const [mode, setMode] = useState<'account' | 'offline'>('account')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [badge, setBadge] = useState(BADGE_OPTIONS[0].key)
  const [asOwner, setAsOwner] = useState(false)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)

  // staff.id -> schedulable. A separate fetch because this is the shift
  // scheduler's own state (schedule_members, not a public.staff column —
  // see PLAN_SHIFTS.md Part II decision D8), read through its own read-only
  // route rather than coupling /api/owner/staff to a different module's
  // tables. Missing from the map (not yet fetched, or the scheduler venue
  // isn't set up) reads as false — the same "no row = not schedulable"
  // default the scheduler itself uses.
  const [schedulable, setSchedulable] = useState<Record<string, boolean>>({})

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

  const loadSchedulable = useCallback(async () => {
    try {
      const res = await fetch('/api/shifts/roster', { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json() as { staff?: { id: string; active: boolean }[] }
      const map: Record<string, boolean> = {}
      for (const s of json.staff ?? []) map[s.id] = s.active
      setSchedulable(map)
    } catch {
      // Scheduler not reachable (module not installed elsewhere, or offline)
      // — every switch just reads off, which is the correct default anyway.
    }
  }, [])

  useEffect(() => { load(); loadSchedulable() }, [load, loadSchedulable])

  async function toggleSchedulable(id: string, next: boolean) {
    setSchedulable((cur) => ({ ...cur, [id]: next }))
    try {
      const res = await fetch('/api/shifts/member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: id, schedulable: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setSchedulable((cur) => ({ ...cur, [id]: !next }))
      setNotice({ kind: 'err', text: 'עדכון הזמינות לסידור נכשל' })
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true); setNotice(null)
    try {
      const payload = mode === 'offline'
        ? { firstName, lastName, badge }
        : { email, badge, role: asOwner ? 'owner' : 'staff' }

      const res = await fetch('/api/owner/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'שמירה נכשלה')
      setEmail(''); setFirstName(''); setLastName(''); setAsOwner(false)
      setNotice({
        kind: 'ok',
        text: json.offline ? T.addedOffline
          : json.reactivated ? T.reactivated
          : json.updated ? T.updated
          : json.pending ? T.addedPending
          : T.addedActive,
      })
      await load()
      // A new offline row exists to be scheduled, so its schedulable state is
      // the next thing the owner will look at — refresh it with the roster
      // rather than leaving the switch reading a stale default.
      await loadSchedulable()
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
      firstName?: string; lastName?: string
      /** Restore only — the API refuses `false` here; use removeMember for
       *  that (it carries the self-lockout / last-owner guards this doesn't). */
      active?: true
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
      if (patch.active) setNotice({ kind: 'ok', text: T.restoredNotice })
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : (patch.active ? T.restoreFailed : 'עדכון נכשל') })
    } finally {
      setBusyId(null)
    }
  }

  const restoreMember = (id: string) => patchMember(id, { active: true })

  function askRemove(m: Member) {
    // Only a real invite gets the "revoke" wording. An offline row was never
    // an invitation to anything, so "cancel the invite?" would describe an
    // action that never happened.
    const pending = !m.auth_user_id && !!m.email
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
      // The row moves to "הוסרו" rather than vanishing — same DELETE-means-
      // deactivate the API now does (041_staff_soft_delete.sql). Mirrors
      // auth_user_id locally too, so a removed row that gets re-rendered
      // before the next full load() doesn't briefly still look "מחובר/ת".
      setMembers((cur) => cur?.map((x) => x.id === m.id ? { ...x, active: false, auth_user_id: null } : x) ?? cur)
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'ההסרה נכשלה' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{T.title}</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.5 }}>{T.subtitle}</p>
        <p style={{
          fontSize: '0.76rem', color: 'var(--text-faint)', margin: '8px 0 0', lineHeight: 1.6,
          padding: '10px 12px', borderRadius: 12,
          border: '1px solid var(--line)', background: 'var(--bg-elev)',
        }}>{T.levels}</p>
      </div>

      {/* Add form */}
      <form onSubmit={addMember} className="rise" style={{ ...cardStyle, animationDelay: '60ms' }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>{T.addTitle}</div>

        {/* Which kind of person this is. Not a checkbox buried under the
            field it changes — it decides what the form even asks for, so it
            comes first and reads as two doors rather than one door with an
            option on it. */}
        <div style={{ display: 'flex', gap: 6 }}>
          {([
            { key: 'account' as const, label: T.modeAccount },
            { key: 'offline' as const, label: T.modeOffline },
          ]).map((m) => {
            const active = mode === m.key
            return (
              <button
                type="button" key={m.key} className="press"
                onClick={() => { setMode(m.key); setNotice(null) }}
                aria-pressed={active}
                style={{
                  flex: 1, padding: '9px 8px', borderRadius: 11,
                  border: `1px solid ${active ? 'var(--neon-soft)' : 'var(--line-strong)'}`,
                  background: active ? 'rgba(255,138,92,0.11)' : 'transparent',
                  color: active ? 'var(--neon-soft)' : 'var(--text-dim)',
                  fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                }}
              >{m.label}</button>
            )
          })}
        </div>
        <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', margin: '-4px 0 0', lineHeight: 1.5 }}>
          {mode === 'offline' ? T.modeOfflineHint : T.modeAccountHint}
        </p>

        {mode === 'account' ? (
          <input
            type="email" required dir="ltr" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder={T.emailPh}
            style={inputStyle}
          />
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text" required value={firstName} maxLength={60}
              onChange={(e) => setFirstName(e.target.value)} placeholder={T.firstNamePh}
              style={{ ...inputStyle, flex: 1 }}
            />
            <input
              type="text" value={lastName} maxLength={60}
              onChange={(e) => setLastName(e.target.value)} placeholder={T.lastNamePh}
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
        )}
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
        {/* Admin rights on a row that can never authenticate grant nothing —
            the API refuses it, so the control is not offered either. */}
        {mode === 'account' && (
          <button
            type="button" role="switch" aria-checked={asOwner} className="press"
            onClick={() => setAsOwner((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: 0, border: 'none', background: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'start' }}
          >
            <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-dim)' }}>{T.ownerGrant} ⭐</span>
            <Switch on={asOwner} small />
          </button>
        )}
        {notice && (
          <p style={{
            color: notice.kind === 'err' ? '#ff6b6b' : 'var(--neon-soft)',
            fontSize: '0.82rem', margin: 0, lineHeight: 1.5,
          }}>{notice.text}</p>
        )}
        <button
          type="submit"
          disabled={adding || (mode === 'account' ? !email : !firstName.trim())}
          className="press" style={addBtnStyle}
        >
          {adding ? T.adding : T.addBtn}
        </button>
      </form>

      {/* Roster — two sections, not one list.
          "staff should be divided by הנהלה and עובדים so that they are two
          distinct parts and only one changes often." The split is on the JOB
          TITLE (isManagement), never on access level: a shift manager runs the
          floor whether or not anyone handed them admin rights, and access
          keeps its own chip on every row. */}
      <div>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 12px' }}>{T.roster}</h3>

        {/* A shimmering placeholder for the row addMember() is about to
            insert — the same SkeletonRow the initial load uses, not a
            spinner, so "something is being added" reads the same visual
            language as "something is loading." Sits above the sections since
            which one the new row lands in isn't known until the response
            comes back. */}
        {adding && (
          <div style={{ marginBottom: 8 }}>
            <SkeletonRow />
          </div>
        )}

        {members === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2].map((i) => <SkeletonRow key={i} />)}
          </div>
        ) : loadError ? (
          <p style={{ color: '#ff6b6b', fontSize: '0.85rem' }}>{loadError}</p>
        ) : members.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', textAlign: 'center', padding: '18px 0' }}>{T.empty}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {([
              { key: 'mgmt', title: T.management, hint: T.managementHint, rows: members.filter((m) => m.active && isManagement(m)) },
              { key: 'staff', title: T.employees, hint: T.employeesHint, rows: members.filter((m) => m.active && !isManagement(m)) },
            ]).map((group, gi) => (
              <div key={group.key}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                      {group.title}
                    </h4>
                    <span style={{
                      borderRadius: 999, padding: '1px 8px', fontSize: '0.7rem', fontWeight: 700,
                      color: 'var(--text-faint)', border: '1px solid var(--line-strong)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>{group.rows.length}</span>
                  </div>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '3px 0 0', lineHeight: 1.5 }}>
                    {group.hint}
                  </p>
                </div>

                {group.rows.length === 0 ? (
                  <p style={{ color: 'var(--text-faint)', fontSize: '0.8rem', padding: '10px 0' }}>{T.emptyGroup}</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {group.rows.map((m, i) => (
                      <MemberRow
                        key={m.id}
                        m={m}
                        delay={Math.min(gi * 2 + i, 8) * 40}
                        isSelf={!!m.auth_user_id && m.auth_user_id === currentUserId}
                        busy={busyId === m.id}
                        schedulable={schedulable[m.id] ?? false}
                        onBadge={(badge) => patchMember(m.id, { badge })}
                        onToggleOwner={() => patchMember(m.id, { role: m.role === 'owner' ? 'staff' : 'owner' })}
                        onDisplayName={(displayName) => patchMember(m.id, { displayName })}
                        onRealName={(first, last) => patchMember(m.id, { firstName: first, lastName: last })}
                        onToggleSchedulable={() => toggleSchedulable(m.id, !(schedulable[m.id] ?? false))}
                        onRemove={() => askRemove(m)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Removed — mirrors FloorBuilder's "הוסרו" list for a deleted
                table: the row is gone from the active roster, not gone from
                the database, and restoring is one tap (041_staff_soft_delete.sql). */}
            {members.some((m) => !m.active) && (
              <div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                      {T.removed}
                    </h4>
                    <span style={{
                      borderRadius: 999, padding: '1px 8px', fontSize: '0.7rem', fontWeight: 700,
                      color: 'var(--text-faint)', border: '1px solid var(--line-strong)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>{members.filter((m) => !m.active).length}</span>
                  </div>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '3px 0 0', lineHeight: 1.5 }}>
                    {T.removedHint}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {members.filter((m) => !m.active).map((m) => (
                    <RemovedMemberRow
                      key={m.id}
                      m={m}
                      busy={busyId === m.id}
                      onRestore={() => restoreMember(m.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmSheet request={confirmReq} onClose={() => setConfirmReq(null)} />
    </div>
  )
}

function MemberRow({
  m, delay, isSelf, busy, schedulable, onBadge, onToggleOwner, onDisplayName, onRealName, onToggleSchedulable, onRemove,
}: {
  m: Member; delay: number; isSelf: boolean; busy: boolean; schedulable: boolean
  onBadge: (badge: string) => void
  onToggleOwner: () => void
  onDisplayName: (name: string | null) => void
  onRealName: (first: string, last: string) => void
  onToggleSchedulable: () => void
  onRemove: () => void
}) {
  // A shimmer, not a dimmed row, while a remove/restore/edit is in flight —
  // "skeleton loading... no refresh needed upon removal," 2026-08-30. The
  // row still occupies its slot (no layout jump when it resolves), it just
  // reads as "working" the same way the initial roster load does, rather
  // than as a row that's merely faded and might be broken.
  if (busy) return <MemberRowSkeleton delay={delay} />

  const meta = badgeMeta(m.badge, m.role)
  const access = accessLabel(m)
  // The owner badge already grants everything, so offering a separate
  // "give admin rights" toggle for that person is meaningless.
  const opImplied = m.badge === 'owner'
  // Three states, not two. `pending` means "authorized, hasn't signed in yet";
  // `offline` means "will never sign in, exists to be scheduled". They look
  // similar in the data (auth_user_id null) and mean opposite things to the
  // owner — one is waiting on somebody, the other is finished.
  const offline = !m.auth_user_id && !m.email
  const pending = !m.auth_user_id && !offline
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
      // Dashed = still waiting on a person. An offline row is not waiting on
      // anybody — it is complete — so it reads as solid like a linked account.
      borderStyle: pending ? 'dashed' : 'solid',
      borderRadius: 14,
      padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10,
      animationDelay: `${delay}ms`,
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
            {offline && (
              <span style={{ ...chipStyle, color: '#a3e635', borderColor: 'rgba(163,230,53,0.35)' }}>
                📋 {T.offlineChip}
              </span>
            )}
          </div>
          {/* No address, no line. An empty row where the email lives reads as
              a failed load rather than as a deliberate absence. */}
          {!offline && (
            <div dir="ltr" style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
          )}
          {!!m.auth_user_id && (
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

          {/* One chip stating the resolved level. Showing "בעלים" next to a
              separate "הרשאות" was redundant — the owner badge IS full access. */}
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: `${access.color}18`,
            border: `1px solid ${access.color}44`, color: access.color,
            borderRadius: 999, padding: '3px 9px', fontSize: '0.7rem', fontWeight: 700,
          }}>
            <span>{access.emoji}</span>{access.he}
          </span>
        </div>
      </div>

      {pending && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', margin: 0, lineHeight: 1.5 }}>
          {T.pendingNote}
        </p>
      )}

      {offline && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', margin: 0, lineHeight: 1.5 }}>
          {T.offlineNote}
        </p>
      )}

      {/* Real name — offline rows ONLY. For everyone else first/last are a
          snapshot of the Google profile that claim_staff_invite() rewrites on
          sign-in, so an edit there would silently revert. An offline row has
          no profile behind it: this is the only name it will ever have, and a
          typo in it has to be fixable. The API enforces the same rule. */}
      {offline && (
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 5 }}>
            {T.realNameLabel}
          </label>
          <RealNameFields
            first={m.first_name ?? ''}
            last={m.last_name ?? ''}
            disabled={busy}
            onCommit={onRealName}
          />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', margin: '5px 0 0', lineHeight: 1.5 }}>
            {T.realNameHint}
          </p>
        </div>
      )}

      {/* Display name — public only, so it sits with the site controls. Not
          offered to a row that cannot appear on the public page at all. */}
      {!pending && !offline && (
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

      {/* Schedulable — the shift scheduler's own state, not a public.staff
          column (PLAN_SHIFTS.md Part II decision D8). Available even for a
          pending invite: the point is rostering someone before their first
          shift, same reasoning as the scheduler's own roster panel. */}
      <button
        type="button" role="switch" aria-checked={schedulable} disabled={busy} className="press"
        onClick={onToggleSchedulable}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '9px 2px', border: 'none', borderTop: '1px solid var(--line)',
          background: 'none', borderRadius: 0, font: 'inherit', cursor: 'pointer', textAlign: 'start',
        }}
      >
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
            {T.schedulable}
          </span>
          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 2 }}>
            {T.schedulableHint}
          </span>
        </span>
        <Switch on={schedulable} />
      </button>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <RolePicker value={m.badge} disabled={busy} onChange={onBadge} />

        {!isSelf && (
          <>
            {/* Admin rights need an account to attach to — the API refuses
                this for an offline row, so it isn't offered here either. */}
            {!opImplied && !offline && (
              <button type="button" onClick={onToggleOwner} disabled={busy} className="press" style={ghostBtn}>
                {m.role === 'owner' ? T.removeOwner : T.makeOwner}
              </button>
            )}
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

/** A removed person's row — deliberately much simpler than MemberRow. Once
 *  someone is off the active roster there is nothing left to edit (badge,
 *  display name, schedulability all stop mattering the moment access is
 *  revoked); the only action that makes sense here is restoring them, so
 *  that's the only control this renders. Same shimmer-while-busy treatment
 *  as MemberRow, for the same reason. */
function RemovedMemberRow({ m, busy, onRestore }: { m: Member; busy: boolean; onRestore: () => void }) {
  if (busy) return <MemberRowSkeleton delay={0} />

  const meta = badgeMeta(m.badge, m.role)
  const offline = !m.auth_user_id && !m.email
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ')
    || m.email?.split('@')[0] || 'משתמש'
  const inits = ((m.first_name?.[0] ?? '') + (m.last_name?.[0] ?? '')).trim()
    || (m.email?.[0] ?? '?').toUpperCase()

  return (
    <div className="rise" style={{
      background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14,
      padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12, opacity: 0.85,
    }}>
      <div aria-hidden style={{
        width: 42, height: 42, borderRadius: 999, flex: '0 0 auto',
        background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line-strong)',
        color: 'var(--text-faint)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.95rem',
      }}>{inits}</div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: `${meta.color}14`, border: `1px solid ${meta.color}33`, color: `${meta.color}bb`,
            borderRadius: 999, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700,
          }}>
            <span>{meta.emoji}</span>{meta.he}
          </span>
        </div>
        {!offline && (
          <div dir="ltr" style={{ fontSize: '0.8rem', color: 'var(--text-faint)', textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
        )}
      </div>

      <button type="button" onClick={onRestore} disabled={busy} className="press" style={{ ...ghostBtn, flex: '0 0 auto' }}>
        ↺ {T.restore}
      </button>
    </div>
  )
}

/** First + last for an offline roster entry.
 *
 *  ── Commits on GROUP blur, not field blur ───────────────────────────
 *  Both inputs carry `disabled={busy}`, and committing sets `busyId`
 *  synchronously. Committing on individual field blur therefore disabled the
 *  field the owner was moving INTO: correcting the first name and clicking
 *  the surname box fired focusout → PATCH → disabled, the click landed on a
 *  disabled input, and everything typed for the next few hundred ms went to
 *  document.body and was lost with no feedback. Tab did the same, skipping
 *  the disabled field entirely.
 *
 *  Checking `relatedTarget` against the wrapper means moving between the two
 *  fields is not a commit at all — the PATCH fires once, when focus leaves
 *  the pair, by which point disabling nothing the owner is using.
 *
 *  The two also commit TOGETHER because the server validates a non-empty
 *  first name: sending a lone surname edit while the first-name box sat empty
 *  mid-edit would be refused for a reason the owner never caused. */
function RealNameFields({ first, last, disabled, onCommit }: {
  first: string; last: string; disabled: boolean
  onCommit: (first: string, last: string) => void
}) {
  const [draftFirst, setDraftFirst] = useState(first)
  const [draftLast, setDraftLast] = useState(last)
  useEffect(() => { setDraftFirst(first) }, [first])
  useEffect(() => { setDraftLast(last) }, [last])

  // Escape reverts and then blurs, and that blur fires SYNCHRONOUSLY — before
  // React re-renders with the reverted values — so the group's blur handler
  // would close over the pre-revert drafts and save the edit the owner just
  // discarded. A ref, not state, for the same reason: it has to be visible to
  // the handler in this same tick.
  const skipCommit = useRef(false)

  const commit = () => {
    const f = draftFirst.trim()
    const l = draftLast.trim()
    // An empty first name is not a deletion request — the row would have no
    // name at all, and the API refuses it. Restore rather than reject.
    if (!f) { setDraftFirst(first); setDraftLast(last); return }
    if (f === first.trim() && l === last.trim()) return
    onCommit(f, l)
  }

  const field: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 11,
    border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)',
    color: 'var(--text)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none',
  }

  const revert = () => {
    skipCommit.current = true
    setDraftFirst(first); setDraftLast(last)
  }

  return (
    <div
      style={{ display: 'flex', gap: 8 }}
      onBlur={(e) => {
        // Focus moving to the sibling input stays inside the group — not a
        // commit. `relatedTarget` is null when focus leaves the document
        // entirely (tab away, window blur), which does count.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        if (skipCommit.current) { skipCommit.current = false; return }
        commit()
      }}
    >
      <input
        value={draftFirst} disabled={disabled} maxLength={60} placeholder={T.firstNamePh}
        onChange={(e) => setDraftFirst(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { revert(); e.currentTarget.blur() }
        }}
        style={{ ...field, flex: 1 }}
      />
      <input
        value={draftLast} disabled={disabled} maxLength={60} placeholder={T.lastNamePh}
        onChange={(e) => setDraftLast(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { revert(); e.currentTarget.blur() }
        }}
        style={{ ...field, flex: 1 }}
      />
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

/** What a MemberRow becomes while it's busy — same shimmer, roughly the same
 *  footprint as a real row (avatar + two lines + a couple of controls), so
 *  the roster doesn't jump when the request resolves and the real row (or
 *  its new "הוסרו"/roster section) takes its place. */
function MemberRowSkeleton({ delay }: { delay: number }) {
  return (
    <div className="rise" style={{
      background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14,
      padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10,
      animationDelay: `${delay}ms`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="sk" style={{ width: 42, height: 42, borderRadius: 999, flex: '0 0 auto' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div className="sk" style={{ width: '45%', height: 13, borderRadius: 6 }} />
          <div className="sk" style={{ width: '65%', height: 10, borderRadius: 6 }} />
        </div>
        <div className="sk" style={{ width: 70, height: 24, borderRadius: 999, flex: '0 0 auto' }} />
      </div>
      <div className="sk" style={{ width: '100%', height: 34, borderRadius: 10 }} />
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
