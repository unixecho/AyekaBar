'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import WeekGrid from '@/components/shifts/WeekGrid'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { draftWeek, publishedWeek } from '@/lib/shifts/store'
import { weekLabel } from '@/lib/shifts/time'
import type { ISODate } from '@/lib/shifts/types'

// The sheet that gets printed and taped up behind the bar.
//
// It prints the PUBLISHED week when there is one and the draft otherwise, and
// it says which, in large letters. A printed draft that looks identical to a
// printed schedule is the single most dangerous artefact this whole system
// could produce — someone works a shift that was never real.
//
// No PDF library. The browser's own print-to-PDF produces a smaller, sharper,
// selectable file than anything a bundled renderer would, it already knows how
// to lay out Hebrew, and it costs zero kilobytes — which is the standing rule
// in this repo about not adding a dependency for what CSS already does.

export default function PrintView({ weekStart }: { weekStart: ISODate }) {
  const { db, t, tri, lang } = useShifts()

  const published = publishedWeek(db, weekStart)
  const bundle = published ?? draftWeek(db, weekStart)
  const isDraft = !published

  // Opening the print dialog automatically is tempting and wrong: the page is
  // also used to eyeball the sheet before committing paper to it.
  useEffect(() => {
    document.title = `${tri(db.venue.name)} · ${weekLabel(weekStart)}`
  }, [db.venue.name, weekStart, tri])

  if (!bundle) {
    return <p style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>{t('notPublished')}</p>
  }

  return (
    <main id="main" tabIndex={-1} className="sh-print" style={{ padding: '20px 16px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <div className="sh-noprint" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* 2026-08-30: this screen had no way back at all — this is a print
            sheet, viewed on-screen before committing it to paper, and printed
            hard copies obviously have no use for a nav link, hence .sh-noprint. */}
        <Link href="/owner/schedule" className="press" style={{
          display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none',
          fontSize: '0.8rem', color: 'var(--text-dim)', padding: '6px 11px',
          borderRadius: 999, border: '1px solid var(--line)',
        }}>
          ← {t('back')}
        </Link>
        <button
          type="button" className="press"
          onClick={() => window.print()}
          style={{
            padding: '12px 20px', borderRadius: 13, border: 'none',
            background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
            color: 'var(--bg)', font: 'inherit', fontSize: '0.9rem', fontWeight: 700,
            cursor: 'pointer', boxShadow: 'var(--glow)',
          }}
        >
          🖨 {t('openPrint')}
        </button>
        <span style={{ alignSelf: 'center', fontSize: '0.78rem', color: 'var(--text-faint)' }}>
          {t('printHint')}
        </span>
      </div>

      <header style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 14,
        paddingBottom: 10, borderBottom: '1px solid var(--line-strong)',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>
            {tri(db.venue.name)} · {t('title')}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.9rem', direction: 'ltr' }}>{weekLabel(weekStart)}</p>
        </div>
        <div style={{ textAlign: 'end', fontSize: '0.76rem' }}>
          {isDraft ? (
            <strong style={{
              display: 'inline-block', padding: '4px 12px', borderRadius: 6,
              border: '2px solid currentColor', fontSize: '0.9rem',
            }}>
              {t('draft')}
            </strong>
          ) : (
            <span>{t('published')} · {t('version')} {bundle.week.version}</span>
          )}
          <div style={{ marginTop: 4, opacity: 0.7 }}>
            {t('printedOn')} {new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'he-IL').format(new Date())}
          </div>
        </div>
      </header>

      <WeekGrid
        weekStart={weekStart}
        shifts={bundle.shifts}
        assignments={bundle.assignments}
        dayNotes={bundle.week.dayNotes}
      />

      {/* A legend, because the printed chips carry a colour and an emoji and
          nothing on paper explains either. */}
      <footer style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid var(--line-strong)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: '0.72rem' }}>
          {db.settings.roles.map((role) => (
            <span key={role.id}>{role.emoji} {tri(role.name)}</span>
          ))}
        </div>
      </footer>
    </main>
  )
}
