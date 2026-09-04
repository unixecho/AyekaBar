'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import OwnerHeader from '@/components/OwnerHeader'
import SheetShell, { sheetPrimary, sheetSecondary } from '@/components/shifts/SheetShell'
import SegmentedControl from '@/components/shifts/SegmentedControl'
import LangSwitch from '@/components/shifts/LangSwitch'
import WeekGrid from '@/components/shifts/WeekGrid'
import AvailabilityPortal from '@/components/shifts/AvailabilityPortal'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { publishedWeek, weekStartFor } from '@/lib/shifts/store'
import { addDays, durationMinutes, fmtDuration, weekLabel } from '@/lib/shifts/time'
import type { Assignment, ISODate } from '@/lib/shifts/types'

// What an employee sees. It reads `db.published` and nothing else — the draft
// the manager is halfway through is not filtered out here, it is not reachable
// from here at all.
//
// This screen is the replacement for a WhatsApp photo of a whiteboard, so the
// first thing it answers is "when am I working", not "what does the week look
// like". Everything else is one tap away.

type View = 'mine' | 'all'

export default function StaffWorkspace() {
  const { db, t, tri, viewer, isMock, today, setViewerStaffId, dispatch } = useShifts()
  const [weekStart, setWeekStart] = useState<ISODate>(() => weekStartFor(today, db.venue))
  const [view, setView] = useState<View>('mine')
  const [swapFor, setSwapFor] = useState<Assignment | null>(null)

  const bundle = publishedWeek(db, weekStart)
  const staffId = viewer.staffId

  const myAssignments = useMemo(
    () => (bundle && staffId ? bundle.assignments.filter((a) => a.staffId === staffId) : []),
    [bundle, staffId])

  const myMinutes = myAssignments.reduce((sum, a) => {
    const shift = bundle?.shifts.find((s) => s.id === a.shiftId)
    return sum + (shift ? durationMinutes(shift.start, shift.end) : 0)
  }, 0)

  // Offers anyone may take: open, not mine, and the shift still exists.
  const openOffers = db.swaps.filter((s) =>
    s.status === 'open' && s.fromStaffId !== staffId
    && db.assignments.some((a) => a.id === s.assignmentId))

  return (
    <main id="main" style={{ minHeight: '100dvh', padding: '20px 16px 40px', maxWidth: 1180, margin: '0 auto' }}>
      <OwnerHeader right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LangSwitch />
          <Link href="/staff/dashboard" style={{
            fontSize: '0.8rem', color: 'var(--text-dim)', textDecoration: 'none',
            padding: '6px 11px', borderRadius: 999, border: '1px solid var(--line)',
          }}>
            {t('back')}
          </Link>
        </div>
      } />

      {/* Prototype affordance: the signed-in Google account is not part of the
          demo roster, so there would otherwise be no "me" to show. */}
      {isMock && (
        <div className="sh-panel" style={{ marginBottom: 12, padding: 10 }}>
          <p className="sh-sub" style={{ margin: '0 0 8px' }}>
            🧪 {t('prototype')} — {tri({ he: 'צפייה בתור', en: 'Viewing as', ar: 'العرض كـ' })}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {db.staff.filter((s) => s.active).map((person) => (
              <button
                key={person.id} type="button" className="press"
                onClick={() => setViewerStaffId(person.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 11px', borderRadius: 999, font: 'inherit',
                  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${person.id === staffId ? `${person.colour}66` : 'var(--line)'}`,
                  background: person.id === staffId ? `${person.colour}18` : 'var(--bg-elev-2)',
                  color: person.id === staffId ? 'var(--text)' : 'var(--text-dim)',
                }}
              >
                <span className="sh-dot" style={{ background: person.colour ?? 'var(--line-strong)' }} aria-hidden>
                  {person.initial ?? person.name[0]}
                </span>
                {person.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- week bar ---- */}
      <div className="sh-panel" style={{ marginBottom: 14, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NavButton label={t('prevWeek')} onClick={() => setWeekStart(addDays(weekStart, -7))} back />
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, direction: 'ltr' }}>{weekLabel(weekStart)}</div>
            {bundle && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                {t('published')} · {t('version')} {bundle.week.version}
              </span>
            )}
          </div>
          <NavButton label={t('nextWeek')} onClick={() => setWeekStart(addDays(weekStart, 7))} />
        </div>
      </div>

      {!bundle ? (
        <div className="sh-panel" style={{ textAlign: 'center', padding: '34px 16px' }}>
          <div aria-hidden style={{ fontSize: '1.8rem', marginBottom: 10 }}>🗓️</div>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-dim)' }}>{t('notPublished')}</p>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <SegmentedControl<View>
              ariaLabel={t('title')} value={view} onChange={setView}
              options={[
                { value: 'mine', label: t('onlyMine'), badge: myAssignments.length },
                { value: 'all', label: t('everyone') },
              ]}
            />
          </div>

          {view === 'mine' && !myAssignments.length && (
            <div className="sh-panel" style={{ textAlign: 'center', padding: '24px 16px', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-dim)' }}>{t('noShiftsForYou')}</p>
            </div>
          )}

          <WeekGrid
            weekStart={weekStart}
            shifts={bundle.shifts}
            assignments={bundle.assignments}
            dayNotes={bundle.week.dayNotes}
            highlightStaffId={staffId}
            onlyStaffId={view === 'mine' ? staffId : null}
          />

          {view === 'mine' && myAssignments.length > 0 && (
            <section className="sh-panel" style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>{t('weekHours')}</h3>
                <span style={{
                  fontSize: '1.1rem', fontWeight: 800, color: 'var(--neon-soft)',
                  direction: 'ltr', fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmtDuration(myMinutes)}
                </span>
              </div>

              {db.settings.features.ENABLE_SHIFT_SWAPS && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {myAssignments.map((a) => {
                    const shift = bundle.shifts.find((s) => s.id === a.shiftId)
                    if (!shift) return null
                    // The live assignment carries the swap state; the published
                    // snapshot is frozen and cannot know about it.
                    const live = db.assignments.find((x) => x.id === a.id)
                    const offered = db.swaps.some((s) =>
                      s.assignmentId === a.id && (s.status === 'open' || s.status === 'peer_accepted'))
                    return (
                      <div key={a.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
                        borderRadius: 12, border: '1px solid var(--line)', background: 'var(--bg-elev-2)',
                      }}>
                        <span style={{ flex: 1, fontSize: '0.84rem' }}>
                          {shift.date} · <span style={{ direction: 'ltr', display: 'inline-block' }}>{shift.start}–{shift.end}</span>
                        </span>
                        <button
                          type="button" className="press"
                          disabled={offered || !live}
                          onClick={() => setSwapFor(live ?? null)}
                          style={{
                            padding: '7px 13px', borderRadius: 999, font: 'inherit',
                            fontSize: '0.76rem', fontWeight: 600,
                            cursor: offered ? 'default' : 'pointer',
                            border: '1px solid var(--line-strong)',
                            background: 'transparent',
                            color: offered ? 'var(--text-faint)' : 'var(--text-dim)',
                          }}
                        >
                          {offered ? t('swapOpen') : t('requestSwap')}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* Offers from colleagues, if swaps are on. */}
          {db.settings.features.ENABLE_SHIFT_SWAPS && openOffers.length > 0 && (
            <section className="sh-panel" style={{ marginTop: 14 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: '0.9rem', fontWeight: 700 }}>{t('swaps')}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {openOffers.map((swap) => {
                  const assignment = db.assignments.find((a) => a.id === swap.assignmentId)
                  const shift = assignment ? db.shifts.find((s) => s.id === assignment.shiftId) : null
                  const from = db.staff.find((s) => s.id === swap.fromStaffId)
                  return (
                    <div key={swap.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderRadius: 12, border: '1px dashed var(--line-strong)', background: 'var(--bg-elev-2)',
                    }}>
                      <span style={{ flex: 1, fontSize: '0.84rem' }}>
                        <strong>{from?.name}</strong>
                        {shift && <> · {shift.date} <span style={{ direction: 'ltr', display: 'inline-block' }}>{shift.start}–{shift.end}</span></>}
                        {swap.reason && <span className="sh-sub" style={{ display: 'block' }}>💬 {swap.reason}</span>}
                      </span>
                      <button
                        type="button" className="press"
                        disabled={!staffId}
                        onClick={() => dispatch({ type: 'swap.peer_accept', swapId: swap.id, staffId: staffId! })}
                        style={{
                          padding: '8px 14px', borderRadius: 999, border: 'none',
                          background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
                          color: 'var(--bg)', font: 'inherit', fontSize: '0.78rem', fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {t('takeShift')}
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      <div style={{ marginTop: 14 }}>
        <AvailabilityPortal weekStart={addDays(weekStart, 7)} />
      </div>

      {swapFor && <SwapSheet assignment={swapFor} onClose={() => setSwapFor(null)} />}
    </main>
  )
}

function SwapSheet({ assignment, onClose }: { assignment: Assignment; onClose: () => void }) {
  const { db, t, tri, dispatch, viewer } = useShifts()
  const [reason, setReason] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const shift = db.shifts.find((s) => s.id === assignment.shiftId)

  return (
    <SheetShell
      title={t('requestSwap')}
      subtitle={shift ? `${shift.date} · ${shift.start}–${shift.end}` : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="press" style={sheetSecondary} onClick={onClose}>{t('cancel')}</button>
          <button
            type="button" className="press" style={sheetPrimary()}
            onClick={async () => {
              await dispatch({
                type: 'swap.request', assignmentId: assignment.id,
                fromStaffId: viewer.staffId!, toStaffId: target, reason,
              })
              onClose()
            }}
          >
            {t('requestSwap')}
          </button>
        </>
      }
    >
      <p className="sh-sub" style={{ margin: '0 0 10px' }}>
        {tri({
          he: 'הבקשה נשלחת לצוות. אחרי שעמית/ה לוקח/ת אותה, המנהל/ת עדיין צריך/ה לאשר — עד אז המשמרת שלך.',
          en: 'The offer goes to the team. After a peer takes it, the manager still has to approve — until then the shift is yours.',
          ar: 'يُرسل العرض للطاقم. بعد قبول زميل، يبقى على المدير الاعتماد — حتى ذلك الحين الوردية لك.',
        })}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        <button
          type="button" className="press" onClick={() => setTarget(null)}
          style={pill(target === null)}
        >
          {t('offerToAll')}
        </button>
        {db.staff.filter((s) => s.active && s.id !== viewer.staffId).map((person) => (
          <button
            key={person.id} type="button" className="press"
            onClick={() => setTarget(person.id)}
            style={pill(target === person.id)}
          >
            {person.name}
          </button>
        ))}
      </div>

      <textarea
        value={reason} onChange={(e) => setReason(e.target.value)}
        rows={2} placeholder={t('swapReason')}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 12, resize: 'vertical',
          border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
          color: 'var(--text)', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none',
        }}
      />
    </SheetShell>
  )
}

const pill = (active: boolean) => ({
  padding: '7px 12px', borderRadius: 999, font: 'inherit',
  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${active ? 'rgba(255,94,58,0.5)' : 'var(--line)'}`,
  background: active ? 'rgba(255,94,58,0.12)' : 'var(--bg-elev)',
  color: active ? 'var(--text)' : 'var(--text-dim)',
} as const)

function NavButton({ label, onClick, back = false }: { label: string; onClick: () => void; back?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label} className="press"
      style={{
        flex: '0 0 auto', width: 38, height: 38, borderRadius: 999,
        border: '1px solid var(--line)', background: 'var(--bg-elev-2)',
        color: 'var(--text-dim)', cursor: 'pointer', display: 'grid', placeItems: 'center',
      }}
    >
      <svg className="dir-flip" viewBox="0 0 24 24" width={17} height={17} fill="none"
        stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d={back ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
      </svg>
    </button>
  )
}
