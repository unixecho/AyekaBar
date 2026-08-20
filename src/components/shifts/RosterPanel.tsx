'use client'

import { useEffect } from 'react'
import Switch from '@/components/Switch'
import { useShifts } from '@/components/shifts/ShiftsProvider'

// Who is on the schedule, and who runs it — one list, two independent
// switches per person.
//
//   בסידור          Does this person appear in the scheduler at all?
//                    Any schedule manager may flip it. No row in
//                    schedule_members = off; this starts EVERYONE off, which
//                    is why the week grid shows nobody assignable until a
//                    manager opts people in here (PLAN_SHIFTS.md Part II,
//                    decision D8).
//   מנהל/ת סידור     May this person draft and publish? OP/GM only
//                    (viewer.canDelegate) — unchanged from the original
//                    delegation section this replaces.
//
// Deliberately reads db.staff WITHOUT filtering by `.active` — that field
// now MEANS "schedulable" (see the comment on ScheduleStaff.active in
// types.ts), so filtering on it here would hide every person this panel
// exists to roster in the first place.
//
// LIVE-UPDATING, as asked: the panel calls refresh() on a 30s interval and
// on window focus, the same polling shape MenuView already uses for the
// publish stamp. refresh() re-reads the whole loaded window (see
// ShiftsProvider) — a full reload rather than a dedicated roster-only
// fetch, because a schedule surface has already paid that cost by the time
// this panel is open; StaffManager.tsx (which has no window to reload) uses
// the lighter GET /api/shifts/roster instead.

export default function RosterPanel() {
  const { db, t, dispatch, refresh, viewer, isMock } = useShifts()
  const { settings } = db

  useEffect(() => {
    // The mock's own load() already re-fetches the real roster on every
    // call (see mock.ts) — polling it on a timer would just thrash
    // localStorage for no benefit a demo needs.
    if (isMock) return
    const interval = setInterval(() => { void refresh() }, 30_000)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [isMock, refresh])

  const toggleSchedulable = (staffId: string, next: boolean) => {
    void dispatch({ type: 'member.update', staffId, patch: { schedulable: next } })
  }

  const toggleDelegate = (staffId: string, granted: boolean) => {
    void dispatch({
      type: 'settings.update',
      patch: {
        scheduleManagers: granted
          ? settings.scheduleManagers.filter((id) => id !== staffId)
          : [...settings.scheduleManagers, staffId],
      },
    })
  }

  const schedulableCount = db.staff.filter((s) => s.active).length

  return (
    <section className="sh-panel">
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
          {t('rosterTitle')}
        </h3>
        <p className="sh-sub" style={{ margin: '3px 0 0' }}>{t('rosterHint')}</p>
        {schedulableCount === 0 && (
          <p style={{
            margin: '8px 0 0', padding: '8px 10px', borderRadius: 10,
            background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
            color: '#fbbf24', fontSize: '0.78rem', fontWeight: 600,
          }}>
            ⚠️ {t('noOneSchedulableYet')}
          </p>
        )}
      </div>

      {!db.staff.length && <p className="sh-sub" style={{ margin: 0 }}>{t('noStaff')}</p>}

      {db.staff.map((person) => {
        const byRole = person.badge === 'owner' || person.badge === 'general_manager' || person.role === 'owner'
        const delegated = settings.scheduleManagers.includes(person.id)

        return (
          <div key={person.id} style={{ padding: '10px 2px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span className="sh-dot" style={{ background: person.colour ?? 'var(--line-strong)' }} aria-hidden>
                {person.initial ?? person.name[0]}
              </span>
              <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>
                {person.name}
              </span>
              {person.pending && (
                <span style={{
                  fontSize: '0.68rem', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.35)',
                  borderRadius: 999, padding: '1px 7px', flex: '0 0 auto',
                }}>
                  ⏳ {t('pendingBadge')}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button
                type="button" role="switch" aria-checked={person.active} className="press"
                onClick={() => toggleSchedulable(person.id, !person.active)}
                style={rowBtnStyle}
              >
                <span style={{ flex: 1 }}>{t('schedulableLabel')}</span>
                <Switch on={person.active} small />
              </button>

              {viewer.canDelegate && (
                <button
                  type="button" role="switch" aria-checked={byRole || delegated}
                  disabled={byRole} className={byRole ? undefined : 'press'}
                  onClick={() => !byRole && toggleDelegate(person.id, delegated)}
                  style={{ ...rowBtnStyle, opacity: byRole ? 0.75 : 1, cursor: byRole ? 'default' : 'pointer' }}
                >
                  <span style={{ flex: 1 }}>
                    {t('delegated')}
                    {byRole && <span className="sh-sub"> · {t('byRole')}</span>}
                  </span>
                  <Switch on={byRole || delegated} small />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}

const rowBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  padding: '7px 2px', background: 'none', border: 'none', borderRadius: 8,
  font: 'inherit', fontSize: '0.82rem', color: 'var(--text-dim)', textAlign: 'start',
}
