'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import StaffPushCard from '@/components/staff/StaffPushCard'
import { haptic } from '@/lib/haptics'
import { TOUR_END_HREF, TOUR_SLIDES, TOUR_TILES, clampSlide, isLastSlide } from '@/lib/staff/tour'

// The employee's first-run tour (2026-10-15) — the wizard's last screen. Owner: "instead of going to the Home page show
// the employee a quick intro on the dashboard and what they can do in it … at the end leave them at the dashboard logged
// in."
//
// A miniature of the real dashboard sits on top and lights the tile each slide is about (the tiles are the registry's —
// scripts/check-join.mjs compares them), the words are in lib/staff/tour.ts. It stores nothing: closing the tab simply
// means the person opens the dashboard without having seen it, which is harmless. Every slide moves focus to its
// heading, "דילוג" leaves at any time, and the last slide's button goes to the dashboard (the person is signed in).

export default function StaffTour({ who }: { who: string }) {
  const [index, setIndex] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const i = clampSlide(index)
  const slide = TOUR_SLIDES[i]!
  const last = isLastSlide(i)

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [i])

  function go(next: number) { haptic('select'); setIndex(clampSlide(next)) }

  return (
    <section className="rise" style={sectionStyle} aria-labelledby="tour-h" role="region">
      <p style={kickerStyle}>
        {i === 0 ? `החשבון חובר, ${who}! ✅` : `סיור קצר · ${i + 1} מתוך ${TOUR_SLIDES.length}`}
      </p>

      <Miniature lit={slide.tile} all={slide.key === 'overview'} />

      <div key={slide.key} className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h1 id="tour-h" ref={headingRef} tabIndex={-1} style={h1Style}>{slide.title}</h1>
        <p style={leadStyle}>{slide.lead}</p>
        <ul style={pointsStyle}>
          {slide.points.map((p) => <li key={p} style={{ display: 'flex', gap: 8 }}><span aria-hidden style={{ color: 'var(--neon-soft)' }}>•</span><span>{p}</span></li>)}
        </ul>
        {slide.key === 'alerts' && <div style={{ textAlign: 'start' }}><StaffPushCard variant="wizard" /></div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }} aria-hidden>
        {TOUR_SLIDES.map((s, k) => (
          <span key={s.key} style={{
            width: k === i ? 18 : 7, height: 7, borderRadius: 999,
            background: k <= i ? 'var(--neon)' : 'var(--line-strong)',
            transition: 'width .3s var(--ease), background .3s var(--ease)',
          }} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        {i > 0 && <button type="button" className="press" style={{ ...ghostBtn, flex: '0 0 auto', width: 'auto', padding: '10px 18px' }} onClick={() => go(i - 1)}>הקודם</button>}
        {last
          ? <Link href={TOUR_END_HREF} className="press" style={{ ...primaryBtn, flex: 1, textDecoration: 'none' }}>סיום — לאזור הצוות</Link>
          : <button type="button" className="press" style={{ ...primaryBtn, flex: 1 }} onClick={() => go(i + 1)}>{i === 0 ? 'מתחילים' : 'הבא'}</button>}
      </div>
      {!last && <Link href={TOUR_END_HREF} className="press" style={skipStyle}>דילוג על הסיור</Link>}
    </section>
  )
}

/** The dashboard in miniature: the four work tiles, the one this slide is about lit, the rest dimmed. */
function Miniature({ lit, all }: { lit: string | null; all: boolean }) {
  return (
    <div aria-hidden style={{
      border: '1px solid var(--line)', borderRadius: 16, background: 'var(--bg)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ height: 30, borderRadius: 9, background: 'var(--bg-elev)', border: '1px dashed var(--line-strong)', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: '0.7rem', color: 'var(--text-faint)' }}>
        המשמרת הקרובה שלי
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {TOUR_TILES.map((t) => {
          const on = all || lit === t.id
          return (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', borderRadius: 11, fontSize: '0.78rem', fontWeight: 700,
              minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.25,
              color: on ? 'var(--text)' : 'var(--text-faint)',
              background: on ? 'rgba(255,138,92,0.12)' : 'var(--bg-elev)',
              border: `1px solid ${on ? 'var(--neon)' : 'var(--line)'}`,
              opacity: on ? 1 : 0.55,
              boxShadow: on && !all ? 'var(--glow)' : 'none',
              transition: 'opacity .3s var(--ease), border-color .3s var(--ease), background .3s var(--ease)',
            }}>
              <span style={{ fontSize: '1.15rem', flex: '0 0 auto' }}>{t.icon}</span><span style={{ minWidth: 0 }}>{t.he}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'start' }
const kickerStyle: CSSProperties = { margin: 0, textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, color: 'var(--neon-soft)' }
const h1Style: CSSProperties = { margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', textAlign: 'center', outline: 'none' }
const leadStyle: CSSProperties = { margin: 0, fontSize: '0.92rem', color: 'var(--text-dim)', lineHeight: 1.65, textAlign: 'center' }
const pointsStyle: CSSProperties = {
  margin: 0, padding: '12px 14px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8,
  fontSize: '0.86rem', color: 'var(--text-dim)', lineHeight: 1.6, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--bg)',
}
const primaryBtn: CSSProperties = {
  minHeight: 48, width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)',
  color: 'var(--bg)', fontSize: '1rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const ghostBtn: CSSProperties = {
  minHeight: 46, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text)', fontSize: '0.92rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const skipStyle: CSSProperties = {
  alignSelf: 'center', minHeight: 44, padding: '10px 16px', color: 'var(--text-faint)', fontSize: '0.85rem', textDecoration: 'none',
  display: 'flex', alignItems: 'center',
}
