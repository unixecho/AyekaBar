'use client'

import { useState, type ReactNode } from 'react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import type { ISODate, SwapRequest } from '@/lib/shifts/types'

// The manager's inbox: swap requests waiting on a decision, and the
// availability people submitted for the week being built.
//
// Both halves are behind their own feature flag and both are OFF for Ayeka
// Bar. The panel still renders with the flag off — it says the feature exists
// and where the switch is, rather than disappearing. A capability that vanishes
// without explanation is one the owner never discovers they had.

export default function RequestsPanel({ weekStart }: { weekStart: ISODate }) {
  const { db, t, tri, dispatch, viewer } = useShifts()
  const { features } = db.settings
  const [note, setNote] = useState<Record<string, string>>({})

  const swaps = db.swaps
  const pending = swaps.filter((s) => s.status === 'peer_accepted')
  const open = swaps.filter((s) => s.status === 'open')
  const closed = swaps.filter((s) => ['approved', 'rejected', 'cancelled'].includes(s.status))
  const submissions = db.availability.filter((a) => a.weekStart === weekStart && a.status === 'submitted')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ---- swaps ---- */}
      <section className="sh-panel">
        <Head title={t('swaps')} off={!features.ENABLE_SHIFT_SWAPS} offLabel={t('featureOff')} />

        {features.ENABLE_SHIFT_SWAPS && (
          <>
            {!swaps.length && <p className="sh-sub" style={{ margin: 0 }}>{t('noSwaps')}</p>}

            {pending.map((swap) => (
              <SwapRow key={swap.id} swap={swap}>
                {viewer.canManage && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    <input
                      value={note[swap.id] ?? ''}
                      onChange={(e) => setNote((n) => ({ ...n, [swap.id]: e.target.value }))}
                      placeholder={t('swapReason')}
                      style={{
                        padding: '9px 11px', borderRadius: 10, border: '1px solid var(--line-strong)',
                        background: 'var(--bg-elev)', color: 'var(--text)', fontSize: '0.82rem',
                        fontFamily: 'inherit', outline: 'none',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button" className="press"
                        onClick={() => dispatch({ type: 'swap.decide', swapId: swap.id, approve: true, note: note[swap.id] ?? '' })}
                        style={decisionButton('#4ade80')}
                      >
                        ✓ {t('approve')}
                      </button>
                      <button
                        type="button" className="press"
                        onClick={() => dispatch({ type: 'swap.decide', swapId: swap.id, approve: false, note: note[swap.id] ?? '' })}
                        style={decisionButton('#ff6b6b')}
                      >
                        ✕ {t('reject')}
                      </button>
                    </div>
                  </div>
                )}
              </SwapRow>
            ))}

            {open.map((swap) => <SwapRow key={swap.id} swap={swap} />)}

            {closed.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-faint)' }}>
                  {closed.length} · {t('auditTitle')}
                </summary>
                <div style={{ marginTop: 8 }}>
                  {closed.map((swap) => <SwapRow key={swap.id} swap={swap} />)}
                </div>
              </details>
            )}
          </>
        )}
      </section>

      {/* ---- availability ---- */}
      <section className="sh-panel">
        <Head title={t('availability')} off={!features.ENABLE_AVAILABILITY_SUBMISSIONS} offLabel={t('featureOff')} />

        {features.ENABLE_AVAILABILITY_SUBMISSIONS && (
          submissions.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {submissions.map((sub) => {
                const person = db.staff.find((s) => s.id === sub.staffId)
                const blocked = sub.entries.filter((e) => e.kind === 'unavailable')
                const partial = sub.entries.filter((e) => e.kind === 'partial')
                return (
                  <div key={sub.id} style={{
                    padding: '10px 12px', borderRadius: 12,
                    border: '1px solid var(--line)', background: 'var(--bg-elev-2)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="sh-dot" style={{ background: person?.colour ?? 'var(--line-strong)' }} aria-hidden>
                        {person?.initial ?? person?.name[0] ?? '?'}
                      </span>
                      <span className="sh-label" style={{ flex: 1 }}>{person?.name ?? '—'}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                        {blocked.length} · {t('unavailable')}
                      </span>
                    </div>
                    {(blocked.length > 0 || partial.length > 0) && (
                      <p className="sh-sub" style={{ margin: '6px 0 0', direction: 'ltr', textAlign: 'start' }}>
                        {[...blocked.map((e) => `⛔ ${e.date}`),
                          ...partial.map((e) => `🕒 ${e.date} ${e.from}–${e.to}`)].join('   ')}
                      </p>
                    )}
                    {sub.note && <p className="sh-sub" style={{ margin: '6px 0 0' }}>💬 {sub.note}</p>}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="sh-sub" style={{ margin: 0 }}>
              {tri({
                he: 'אף אחד לא הגיש זמינות לשבוע הזה.',
                en: 'Nobody has submitted availability for this week.',
                ar: 'لم يقدّم أحد توفره لهذا الأسبوع.',
              })}
            </p>
          )
        )}
      </section>
    </div>
  )
}

function Head({ title, off, offLabel }: { title: string; off: boolean; offLabel: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
        {off && (
          <span style={{
            padding: '2px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700,
            border: '1px solid var(--line-strong)', color: 'var(--text-faint)',
          }}>
            OFF
          </span>
        )}
      </div>
      {off && <p className="sh-sub" style={{ margin: '4px 0 0' }}>{offLabel}</p>}
    </div>
  )
}

function SwapRow({ swap, children }: { swap: SwapRequest; children?: ReactNode }) {
  const { db, t } = useShifts()
  const assignment = db.assignments.find((a) => a.id === swap.assignmentId)
  const shift = assignment ? db.shifts.find((s) => s.id === assignment.shiftId) : null
  const from = db.staff.find((s) => s.id === swap.fromStaffId)
  const to = swap.toStaffId ? db.staff.find((s) => s.id === swap.toStaffId) : null

  const statusLabel =
    swap.status === 'open' ? t('swapOpen')
    : swap.status === 'peer_accepted' ? t('swapPeerAccepted')
    : swap.status === 'approved' ? t('swapApproved')
    : swap.status === 'rejected' ? t('swapRejected')
    : t('swapCancelled')

  const statusColor =
    swap.status === 'approved' ? '#4ade80'
    : swap.status === 'rejected' ? '#ff6b6b'
    : swap.status === 'peer_accepted' ? '#fbbf24'
    : 'var(--text-dim)'

  return (
    <div style={{
      padding: '11px 12px', borderRadius: 12, marginBottom: 8,
      border: '1px solid var(--line)', background: 'var(--bg-elev-2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="sh-label">{from?.name ?? '—'}</span>
        <span aria-hidden style={{ color: 'var(--text-faint)' }}>→</span>
        <span className="sh-label" style={{ color: to ? 'var(--text)' : 'var(--text-faint)' }}>
          {to?.name ?? t('offerToAll')}
        </span>
        <span style={{
          marginInlineStart: 'auto', fontSize: '0.72rem', fontWeight: 700, color: statusColor,
        }}>
          {statusLabel}
        </span>
      </div>
      {shift && (
        <p className="sh-sub" style={{ margin: '4px 0 0' }}>
          {shift.date} · <span style={{ direction: 'ltr', display: 'inline-block' }}>{shift.start}–{shift.end}</span>
        </p>
      )}
      {swap.reason && <p className="sh-sub" style={{ margin: '4px 0 0' }}>💬 {swap.reason}</p>}
      {swap.decisionNote && <p className="sh-sub" style={{ margin: '4px 0 0' }}>🗒️ {swap.decisionNote}</p>}
      {children}
    </div>
  )
}

const decisionButton = (color: string) => ({
  flex: 1, padding: '10px 0', borderRadius: 11, font: 'inherit',
  fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${color}55`, background: `${color}14`, color,
} as const)
