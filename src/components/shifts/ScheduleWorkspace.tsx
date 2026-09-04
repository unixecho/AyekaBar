'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import OwnerHeader from '@/components/OwnerHeader'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import SheetShell, { sheetPrimary, sheetSecondary } from '@/components/shifts/SheetShell'
import SegmentedControl from '@/components/shifts/SegmentedControl'
import LangSwitch from '@/components/shifts/LangSwitch'
import WeekGrid from '@/components/shifts/WeekGrid'
import ShiftSheet, { type ShiftSheetMode } from '@/components/shifts/ShiftSheet'
import WarningsPanel from '@/components/shifts/WarningsPanel'
import ManagerPanel from '@/components/shifts/ManagerPanel'
import RequestsPanel from '@/components/shifts/RequestsPanel'
import AuditTrail from '@/components/shifts/AuditTrail'
import OnboardingFlow from '@/components/shifts/OnboardingFlow'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { draftWeek, isOptimisticId, neighbouringOf, weekSignature, weekStartFor } from '@/lib/shifts/store'
import { evaluate, summarize } from '@/lib/shifts/rules'
import { addDays, durationMinutes, fmtDuration, weekLabel } from '@/lib/shifts/time'
import type { ISODate } from '@/lib/shifts/types'

// The manager's screen. Five tabs over one week.
//
// The week bar is the spine: which week, what state it is in, and the single
// button that makes it real. Publishing is the only action here with an
// audience, so it is the only one that gets an accent colour — everything else
// edits a draft nobody but the manager can see.

type Tab = 'week' | 'warnings' | 'requests' | 'settings' | 'log'

export default function ScheduleWorkspace() {
  const { db, t, tri, dispatch, viewer, isMock, today } = useShifts()
  const [weekStart, setWeekStart] = useState<ISODate>(() => weekStartFor(today, db.venue))
  const [tab, setTab] = useState<Tab>('week')
  const [sheet, setSheet] = useState<ShiftSheetMode | null>(null)
  const [noteDate, setNoteDate] = useState<ISODate | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)

  // A week row is created lazily, the first time someone looks at that week.
  // Creating all 52 up front would fill the audit log with weeks nobody opened.
  //
  // Gated on canManage: `week.ensure` is a manager-only write (ACTION_ROUTES),
  // so for anyone else it can only ever be refused — and since a refusal rolls
  // the optimistic week back out, this effect would immediately fire again and
  // loop, one rejected request and one error toast per turn.
  useEffect(() => {
    if (!viewer.canManage) return
    if (!db.weeks.some((w) => w.weekStart === weekStart)) {
      void dispatch({ type: 'week.ensure', weekStart })
    }
  }, [weekStart, db.weeks, dispatch, viewer.canManage])

  // MEMOISED, and the memo below depends on it. `draftWeek()` builds a fresh
  // object every call, so calling it in the render body handed `warnings` a
  // dependency that was never equal to last render's — which meant the entire
  // rules engine re-ran on every state change on this screen, opening a sheet
  // and switching a tab included. That synchronous re-evaluation, not the
  // sheet itself, was most of the delay between tapping ＋ and seeing it.
  const bundle = useMemo(() => draftWeek(db, weekStart), [db, weekStart])
  const neighbouring = useMemo(() => neighbouringOf(db, weekStart), [db, weekStart])
  const published = db.published[weekStart] ?? null

  const warnings = useMemo(() => {
    if (!bundle) return []
    return evaluate({
      venue: db.venue,
      settings: db.settings,
      week: bundle.week,
      shifts: bundle.shifts,
      assignments: bundle.assignments,
      staff: db.staff,
      availability: db.availability,
      neighbouring,
    })
  }, [db.venue, db.settings, db.staff, db.availability, bundle, neighbouring])

  const counts = summarize(warnings)
  const dirty = !!published && weekSignature(bundle) !== weekSignature(published)
  const isPublished = bundle?.week.status === 'published'

  const hoursByStaff = useMemo(() => {
    const minutesOf = new Map<string, number>()
    for (const s of bundle?.shifts ?? []) minutesOf.set(s.id, durationMinutes(s.start, s.end))
    const map = new Map<string, number>()
    for (const a of bundle?.assignments ?? []) {
      const minutes = minutesOf.get(a.shiftId)
      if (minutes === undefined) continue
      map.set(a.staffId, (map.get(a.staffId) ?? 0) + minutes)
    }
    return map
  }, [bundle])

  async function publish() {
    setPublishing(true)
    await dispatch({ type: 'week.publish', weekStart })
    setPublishing(false)
  }

  function onPublishClick() {
    if (counts.errors > 0) {
      // Errors individually, warnings/infos as a count — a confirmation
      // that gets read rather than reflexively dismissed (decision D11).
      // Dismissed warnings are NOT filtered out of this gate: dismissal
      // mutes the list view (WarningsPanel), it does not change what is
      // actually true about the week, and publishing is exactly the moment
      // that should still know the whole truth.
      const errors = warnings.filter((w) => w.severity === 'error')
      const MAX_LISTED = 4
      const listed = errors.slice(0, MAX_LISTED).map((e) => tri(e.message)).join(' · ')
      const overflow = errors.length > MAX_LISTED
        ? ` ${t('andNMoreErrors').replace('{n}', String(errors.length - MAX_LISTED))}`
        : ''
      const rest = [
        counts.warns ? `${counts.warns} ${t('warnsLabel')}` : null,
        counts.infos ? `${counts.infos} ${t('infosLabel')}` : null,
      ].filter(Boolean).join(', ')
      const body = listed + overflow + (rest ? ` — ${rest}` : '')

      setConfirm({
        title: t('publishWithErrors'),
        body,
        confirmLabel: t('publishAnyway'),
        onConfirm: () => { void publish() },
      })
      return
    }
    void publish()
  }

  if (!db.settings.onboardedAt && !setupOpen) {
    return <OnboardingFlow onDone={() => setTab('week')} />
  }

  return (
    <main id="main" style={{ minHeight: '100dvh', padding: '20px 16px 40px', maxWidth: 1180, margin: '0 auto' }}>
      <OwnerHeader right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LangSwitch />
          <Link href="/owner/dashboard" style={{
            fontSize: '0.8rem', color: 'var(--text-dim)', textDecoration: 'none',
            padding: '6px 11px', borderRadius: 999, border: '1px solid var(--line)',
          }}>
            {t('back')}
          </Link>
        </div>
      } />

      {isMock && <PrototypeBanner />}

      {/* ---- week bar ---- */}
      <div className="rise sh-panel" style={{ marginBottom: 14, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ArrowButton label={t('prevWeek')} onClick={() => setWeekStart(addDays(weekStart, -7))} back />
          <div style={{ flex: 1, minWidth: 130, textAlign: 'center' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, direction: 'ltr' }}>{weekLabel(weekStart)}</div>
            <StatusChip published={isPublished} dirty={dirty} version={bundle?.week.version ?? 0} />
          </div>
          <ArrowButton label={t('nextWeek')} onClick={() => setWeekStart(addDays(weekStart, 7))} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button" className="press"
            onClick={onPublishClick}
            disabled={publishing || !bundle}
            style={{
              flex: '1 1 160px', padding: '12px 0', borderRadius: 13, border: 'none',
              background: isPublished && !dirty
                ? 'var(--bg-elev-2)'
                : 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
              color: isPublished && !dirty ? 'var(--text-faint)' : 'var(--bg)',
              font: 'inherit', fontSize: '0.9rem', fontWeight: 700,
              cursor: publishing ? 'default' : 'pointer',
              boxShadow: isPublished && !dirty ? 'none' : 'var(--glow)',
            }}
          >
            {publishing ? t('publishing') : isPublished ? (dirty ? t('republish') : t('published')) : t('publish')}
          </button>

          <Link
            href={`/owner/schedule/print?week=${weekStart}`}
            target="_blank"
            className="press"
            style={{ ...ghost, flex: '0 0 auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
          >
            🖨 {t('print')}
          </Link>

          <button
            type="button" className="press" style={{ ...ghost, flex: '0 0 auto' }}
            onClick={() => dispatch({ type: 'week.copy', from: addDays(weekStart, -7), to: weekStart })}
          >
            {t('copyLastWeek')}
          </button>

          <button
            type="button" className="press" style={{ ...ghost, flex: '0 0 auto' }}
            onClick={() => setConfirm({
              title: t('clearWeek'), body: t('clearWeekBody'),
              confirmLabel: t('clearWeek'),
              onConfirm: () => { void dispatch({ type: 'week.clear', weekStart }) },
            })}
          >
            {t('clearWeek')}
          </button>

          {isPublished && (
            <button
              type="button" className="press" style={{ ...ghost, flex: '0 0 auto' }}
              onClick={() => dispatch({ type: 'week.unpublish', weekStart })}
            >
              {t('unpublish')}
            </button>
          )}
        </div>

        <p className="sh-sub" style={{ margin: '10px 0 0' }}>
          {isPublished && !dirty ? t('publishedHint') : t('draftHint')}
        </p>
      </div>

      {/* ---- tabs ---- */}
      <div className="rise" style={{ marginBottom: 14, animationDelay: '60ms' }}>
        <SegmentedControl<Tab>
          ariaLabel={t('managerTitle')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'week', label: t('tabWeek') },
            { value: 'warnings', label: t('tabWarnings'), badge: counts.errors + counts.warns },
            { value: 'requests', label: t('tabRequests'), badge: db.swaps.filter((s) => s.status === 'peer_accepted').length },
            { value: 'settings', label: t('tabSettings') },
            { value: 'log', label: t('tabAudit') },
          ]}
        />
      </div>

      <div className="rise" style={{ animationDelay: '110ms' }}>
        {tab === 'week' && bundle && (
          <>
            <WeekGrid
              weekStart={weekStart}
              shifts={bundle.shifts}
              assignments={bundle.assignments}
              dayNotes={bundle.week.dayNotes}
              warnings={warnings}
              // A shift whose id is still client-minted has not reached
              // Postgres yet (see OPTIMISTIC_ID_PREFIX in store.ts), so
              // nothing inside the sheet could address it. Sub-second, and
              // only after a create or a "copy last week"; the tap simply
              // does nothing until the real row lands.
              onShiftClick={viewer.canManage
                ? (shift) => { if (!isOptimisticId(shift.id)) setSheet({ type: 'edit', shift }) }
                : undefined}
              onAddShift={viewer.canManage ? (date) => setSheet({ type: 'create', date }) : undefined}
              onDayNote={viewer.canManage ? setNoteDate : undefined}
            />

            {/* Hours per person. The number a manager checks last and cares
                about most — it is what someone's pay looks like. */}
            <section className="sh-panel" style={{ marginTop: 14 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: '0.9rem', fontWeight: 700 }}>{t('weekHours')}</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {db.staff.filter((s) => s.active).map((person) => {
                  const minutes = hoursByStaff.get(person.id) ?? 0
                  const over = minutes > db.settings.safety.maxWeeklyHours * 60
                  return (
                    <span key={person.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                      padding: '6px 11px', borderRadius: 999,
                      border: `1px solid ${over ? 'rgba(255,107,107,0.45)' : 'var(--line)'}`,
                      background: over ? 'rgba(255,107,107,0.08)' : 'var(--bg-elev-2)',
                      fontSize: '0.78rem', fontWeight: 600,
                      color: minutes ? 'var(--text)' : 'var(--text-faint)',
                    }}>
                      <span className="sh-dot" style={{ background: person.colour ?? 'var(--line-strong)' }} aria-hidden>
                        {person.initial ?? person.name[0]}
                      </span>
                      {person.name}
                      <span style={{ direction: 'ltr', fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>
                        {fmtDuration(minutes)}
                      </span>
                    </span>
                  )
                })}
              </div>
            </section>
          </>
        )}

        {tab === 'warnings' && (
          <WarningsPanel
            warnings={warnings}
            shifts={bundle?.shifts ?? []}
            dismissedWarnings={bundle?.week.dismissedWarnings ?? []}
            onOpenShift={viewer.canManage
              ? (shift) => {
                  setTab('week')
                  // Same reason as onShiftClick above — a brand-new shift
                  // warns ("unstaffed") before the server has answered for it.
                  if (!isOptimisticId(shift.id)) setSheet({ type: 'edit', shift })
                }
              : undefined}
            onDismiss={(warningId, dismissed) => { void dispatch({ type: 'warning.dismiss', weekStart, warningId, dismissed }) }}
          />
        )}

        {tab === 'requests' && <RequestsPanel weekStart={weekStart} />}

        {tab === 'settings' && <ManagerPanel onRerunSetup={() => setSetupOpen(true)} />}

        {tab === 'log' && <AuditTrail />}
      </div>

      {sheet && (
        <ShiftSheet
          mode={sheet}
          weekStart={weekStart}
          readOnly={!viewer.canManage}
          onClose={() => setSheet(null)}
        />
      )}

      {noteDate && bundle && (
        <NoteSheet
          date={noteDate}
          initial={bundle.week.dayNotes[noteDate] ?? ''}
          onClose={() => setNoteDate(null)}
          onSave={(note) => {
            // Not awaited: dispatch() has already applied the note locally by
            // the time it returns its promise, so holding the sheet open for
            // the round trip would only add the delay back.
            void dispatch({ type: 'note.day', weekStart, date: noteDate, note })
            setNoteDate(null)
          }}
        />
      )}

      {setupOpen && <OnboardingFlow onDone={() => setSetupOpen(false)} />}

      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />

      {/* Keeps the venue name in the DOM for the print sheet's header and for
          anyone auditing which venue a screenshot came from. */}
      <p className="sh-noprint" style={{ marginTop: 24, fontSize: '0.7rem', color: 'var(--text-faint)', textAlign: 'center' }}>
        {tri(db.venue.name)}
      </p>
    </main>
  )
}

function NoteSheet({ date, initial, onClose, onSave }: {
  date: ISODate
  initial: string
  onClose: () => void
  onSave: (note: string) => void | Promise<void>
}) {
  const { t } = useShifts()
  const [value, setValue] = useState(initial)

  return (
    <SheetShell
      title={t('dayNote')}
      subtitle={date}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="press" style={sheetSecondary} onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="press" style={sheetPrimary()} onClick={() => onSave(value)}>{t('save')}</button>
        </>
      }
    >
      <textarea
        value={value} onChange={(e) => setValue(e.target.value)}
        placeholder={t('notePlaceholder')} rows={4} autoFocus
        style={{
          width: '100%', padding: '12px 13px', borderRadius: 12, resize: 'vertical',
          border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
          color: 'var(--text)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none',
        }}
      />
    </SheetShell>
  )
}

function StatusChip({ published, dirty, version }: { published: boolean; dirty: boolean; version: number }) {
  const { t } = useShifts()
  const label = !published ? t('draft') : dirty ? t('hasChanges') : `${t('published')} · ${t('version')} ${version}`
  const color = !published ? 'var(--text-faint)' : dirty ? '#fbbf24' : '#4ade80'
  return (
    <span style={{
      display: 'inline-block', marginTop: 4, padding: '2px 9px', borderRadius: 999,
      fontSize: '0.68rem', fontWeight: 700, color, border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  )
}

function ArrowButton({ label, onClick, back = false }: { label: string; onClick: () => void; back?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label} className="press"
      style={{
        flex: '0 0 auto', width: 38, height: 38, borderRadius: 999,
        border: '1px solid var(--line)', background: 'var(--bg-elev-2)',
        color: 'var(--text-dim)', cursor: 'pointer', display: 'grid', placeItems: 'center',
      }}
    >
      {/* Chevrons are mirrored by `dir` through .dir-flip, so "previous" points
          the physically correct way in Hebrew and in English alike. */}
      <svg className="dir-flip" viewBox="0 0 24 24" width={17} height={17} fill="none"
        stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d={back ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
      </svg>
    </button>
  )
}

function PrototypeBanner() {
  const { t } = useShifts()
  return (
    <div className="sh-noprint" style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
      padding: '9px 12px', borderRadius: 12,
      border: '1px dashed rgba(56,225,255,0.4)', background: 'rgba(56,225,255,0.06)',
    }}>
      <span aria-hidden>🧪</span>
      <span style={{ fontSize: '0.76rem', color: 'var(--text-dim)', lineHeight: 1.45 }}>
        <strong style={{ color: 'var(--neon-2)' }}>{t('prototype')}</strong> · {t('prototypeHint')}
      </span>
    </div>
  )
}

const ghost = {
  padding: '12px 16px', borderRadius: 13, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text-dim)', font: 'inherit',
  fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer',
} as const
