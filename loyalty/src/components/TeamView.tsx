'use client'

import { type CSSProperties } from 'react'
import Link from 'next/link'
import { badgeMeta } from '@/lib/staff/badges'
import LanguageSwitch, { useLanguage, type Lang } from '@/components/LanguageSwitch'
import type { TeamMember } from '@/lib/team/fetch'

const I18N: Record<Lang, {
  title: string; tagline: string; leadership: string; team: string
  empty: string; back: string
}> = {
  he: {
    title: 'הצוות',
    tagline: 'האנשים שמאחורי הבר',
    leadership: 'הנהלה',
    team: 'הצוות שלנו',
    empty: 'הצוות יעלה לכאן בקרוב.',
    back: 'חזרה לדף הבית',
  },
  en: {
    title: 'The Team',
    tagline: 'The people behind the bar',
    leadership: 'Leadership',
    team: 'Our team',
    empty: 'The team will appear here soon.',
    back: 'Back to home',
  },
  ar: {
    title: 'الطاقم',
    tagline: 'الأشخاص خلف البار',
    leadership: 'الإدارة',
    team: 'طاقمنا',
    empty: 'سيظهر الطاقم هنا قريباً.',
    back: 'العودة إلى الصفحة الرئيسية',
  },
}

/** Leadership tier gets the large treatment, everyone else the grid. */
const LEAD_BADGES = new Set(['owner', 'general_manager'])
const isLeader = (m: TeamMember) =>
  m.role === 'owner' || (m.badge != null && LEAD_BADGES.has(m.badge))

export default function TeamView({ members }: { members: TeamMember[] }) {
  const [lang, setLang] = useLanguage()
  const t = I18N[lang]

  const leaders = members.filter(isLeader)
  const rest = members.filter((m) => !isLeader(m))

  return (
    <main style={{
      minHeight: '100dvh', position: 'relative',
      padding: 'calc(env(safe-area-inset-top) + 26px) 20px calc(env(safe-area-inset-bottom) + 40px)',
    }}>
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <LanguageSwitch lang={lang} onChange={setLang} />

      <div style={{ maxWidth: 940, margin: '0 auto' }}>
        {/* Masthead */}
        <header style={{ textAlign: 'center', marginBottom: 40 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/logo.svg" alt="" width={64} height={64}
            style={{
              display: 'block', margin: '0 auto 12px',
              filter: 'drop-shadow(0 0 20px rgba(255,94,58,0.45))',
              animation: 'rise-in .6s var(--ease) .05s backwards',
            }}
          />
          <h1 style={{
            fontSize: 'clamp(2rem, 7vw, 2.9rem)', fontWeight: 800, margin: 0, letterSpacing: 1,
            color: 'var(--text)', textShadow: '0 0 26px rgba(255,94,58,0.55)',
            animation: 'rise-in .6s var(--ease) .12s backwards',
          }}>{t.title}</h1>
          <p style={{
            color: 'var(--text-dim)', margin: '8px 0 0', fontSize: '1rem', fontWeight: 500,
            animation: 'rise-in .6s var(--ease) .2s backwards',
          }}>{t.tagline}</p>
        </header>

        {members.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '40px 0' }}>{t.empty}</p>
        ) : (
          <>
            {leaders.length > 0 && (
              <Section label={t.leadership} delay={280}>
                <div style={{
                  display: 'grid', gap: 18,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  justifyContent: 'center',
                }}>
                  {leaders.map((m, i) => (
                    <Card key={m.id} m={m} lang={lang} featured delay={320 + i * 70} />
                  ))}
                </div>
              </Section>
            )}

            {rest.length > 0 && (
              <Section label={t.team} delay={leaders.length ? 420 : 280}>
                <div style={{
                  display: 'grid', gap: 14,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                }}>
                  {rest.map((m, i) => (
                    <Card key={m.id} m={m} lang={lang} delay={460 + Math.min(i, 10) * 55} />
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: 44 }}>
          <Link href="/" className="press" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px',
            borderRadius: 13, border: '1px solid var(--line)', background: 'var(--bg-elev)',
            color: 'var(--text-dim)', textDecoration: 'none', fontWeight: 600, fontSize: '0.92rem',
          }}>
            <span className="dir-flip">←</span>{t.back}
          </Link>
        </div>
      </div>
    </main>
  )
}

function Section({ label, delay, children }: {
  label: string; delay: number; children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: 38, animation: `rise-in .6s var(--ease) ${delay}ms backwards` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h2 style={{
          fontSize: '0.8rem', fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase',
          color: 'var(--neon-soft)', margin: 0, whiteSpace: 'nowrap',
        }}>{label}</h2>
        <span aria-hidden style={{
          flex: 1, height: 1,
          background: 'linear-gradient(to left, transparent, var(--line-strong))',
        }} />
      </div>
      {children}
    </section>
  )
}

function Card({ m, lang, featured = false, delay }: {
  m: TeamMember; lang: Lang; featured?: boolean; delay: number
}) {
  const meta = badgeMeta(m.badge, m.role)
  const size = featured ? 132 : 92

  return (
    <article style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      gap: 12, padding: featured ? '24px 16px' : '18px 12px',
      borderRadius: 18, border: '1px solid var(--line)',
      background: featured
        ? 'linear-gradient(160deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012))'
        : 'var(--bg-elev)',
      animation: `rise-in .55s var(--ease) ${delay}ms backwards`,
    }}>
      <Portrait member={m} color={meta.color} size={size} />

      <div>
        <h3 style={{
          margin: 0, color: 'var(--text)', fontWeight: 700,
          fontSize: featured ? '1.12rem' : '0.95rem', lineHeight: 1.3,
        }}>{m.name}</h3>
        <p style={{
          margin: '5px 0 0', color: meta.color, fontWeight: 600,
          fontSize: featured ? '0.86rem' : '0.78rem',
        }}>
          <span aria-hidden style={{ marginInlineEnd: 5 }}>{meta.emoji}</span>
          {meta[lang]}
        </p>
      </div>
    </article>
  )
}

/** Real portrait when one exists, otherwise a generated monogram — the bar has
 *  no photos yet, and an empty circle reads as a broken image. */
function Portrait({ member, color, size }: {
  member: TeamMember; color: string; size: number
}) {
  // Derived from the name actually being shown, so an owner who sets the
  // Hebrew spelling "אופיר מינץ" gets "אמ" rather than the Google-profile "OM".
  // Separated by a middot — "א·מ" reads as initials, "אמ" reads as a word.
  const initials = member.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('·') || '?'

  const frame: CSSProperties = {
    width: size, height: size, borderRadius: 20, flex: '0 0 auto',
    // The accent ring is what makes a placeholder look deliberate rather than
    // missing, and it carries the badge colour so roles read at a glance.
    border: `1px solid ${color}55`,
    boxShadow: `0 0 26px ${color}22, inset 0 0 22px ${color}0f`,
    overflow: 'hidden', display: 'grid', placeItems: 'center',
  }

  if (member.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.photoUrl} alt={member.name} width={size} height={size}
        loading="lazy" decoding="async"
        style={{ ...frame, objectFit: 'cover' }}
      />
    )
  }

  return (
    <div aria-hidden style={{
      ...frame,
      background: `linear-gradient(150deg, ${color}26, ${color}0a 60%, transparent)`,
    }}>
      <span style={{
        // The dot carries its own spacing, so extra letter-spacing here just
        // detaches it from the letters.
        fontSize: size * 0.30, fontWeight: 800, color,
        textShadow: `0 0 18px ${color}66`, whiteSpace: 'nowrap',
      }}>{initials}</span>
    </div>
  )
}
