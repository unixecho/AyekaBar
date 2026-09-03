'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { PORTAL_LINKS_DEFAULT, type PortalLinkKey } from '@/lib/settings/keys'
import { PORTAL_REVIEWS_DEFAULT } from '@/lib/reviews/seed'
import type { PortalReviewsBlock } from '@/lib/reviews/types'
import LanguageSwitch, { useLanguage, type Lang } from '@/components/LanguageSwitch'
import ReviewWall from '@/components/ReviewWall'
import FeedbackButton from '@/components/FeedbackButton'

const LINKS = {
  menu: '/menu',
  loyalty: '/loyalty',
}
const NAV_LABELS = { gmaps: 'Google Maps', waze: 'Waze', amaps: 'Apple Maps' }

const I18N: Record<Lang, {
  brand: ReactNode; tagline: string; navigate: string; menu: string; instagram: string
  facebook: string; review: string; loyalty: string; soon: string; team: string
  footer: string; scrollCue: string; accessibility: string
}> = {
  he: { brand: <>אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר</>, tagline: 'חריש · ישראל', navigate: 'ניווט אלינו', menu: 'תפריט דיגיטלי', instagram: 'אינסטגרם', facebook: 'פייסבוק', review: 'השארת ביקורת', loyalty: 'מועדון נאמנות', soon: 'בקרוב', team: 'הצוות שלנו', footer: '© אייכה בר', scrollCue: 'ביקורות', accessibility: 'הצהרת נגישות' },
  en: { brand: 'Ayeka Bar', tagline: 'Harish · Israel', navigate: 'Navigate to us', menu: 'Digital menu', instagram: 'Instagram', facebook: 'Facebook', review: 'Leave a review', loyalty: 'Loyalty Club', soon: 'Coming soon', team: 'Our team', footer: '© Ayeka Bar', scrollCue: 'Reviews', accessibility: 'Accessibility statement' },
  ar: { brand: <>אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר</>, tagline: 'حريش · إسرائيل', navigate: 'الوصول إلينا', menu: 'القائمة الرقمية', instagram: 'إنستغرام', facebook: 'فيسبوك', review: 'اترك تقييماً', loyalty: 'نادي الولاء', soon: 'قريباً', team: 'طاقمنا', footer: '© אייכה בר', scrollCue: 'التقييمات', accessibility: 'بيان إمكانية الوصول' },
}

const ICONS = {
  navigate: <path d="M3 11l19-9-9 19-2-8-8-2z" />,
  team: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><circle cx="17" cy="9.5" r="2.4" /><path d="M15.5 14.2c2.6-.5 5 1.3 5 4.3" /></>,
  menu: <><path d="M4 5h16" /><path d="M4 10h16" /><path d="M4 15h10" /><path d="M4 20h7" /></>,
  loyalty: <><rect x="2" y="6" width="20" height="14" rx="3" /><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><circle cx="12" cy="13" r="2" /><path d="M9 17c0-1.7 1.3-3 3-3s3 1.3 3 3" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></>,
  // Stroked "f" in a rounded square, to sit in the same weight as Instagram's.
  facebook: <><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M12.4 20.6V9.7c0-1.4.8-2.2 2.2-2.2h1.3" /><path d="M10 12.7h5.3" /></>,
  review: <path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L4.3 9.4l6-.9z" />,
  pin: <><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2.2" /></>,
}

function Ic({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
}

export default function Portal({
  loyaltyEnabled = false,
  loyaltyVisible = true,
  links = PORTAL_LINKS_DEFAULT,
  reviews = PORTAL_REVIEWS_DEFAULT,
  feedbackEnabled = true,
}: {
  loyaltyEnabled?: boolean
  /** Off = no loyalty entry on the portal at all, teaser included. */
  loyaltyVisible?: boolean
  links?: Record<PortalLinkKey, string>
  reviews?: PortalReviewsBlock
  /** The owner's switch for the feedback box. Display only — the endpoint
   *  re-reads the same setting and refuses on its own. */
  feedbackEnabled?: boolean
}) {
  const [lang, setLang] = useLanguage()
  const [navOpen, setNavOpen] = useState(false)
  const t = I18N[lang]

  let d = 0
  const delay = () => `${260 + (d++) * 85}ms`

  return (
    <main id="main" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'calc(env(safe-area-inset-top) + 20px) 20px calc(env(safe-area-inset-bottom) + 24px)', position: 'relative' }}>
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <LanguageSwitch lang={lang} onChange={setLang} />

      {/* The hero still owns exactly one screen, so the portal's first paint is
          unchanged and the review wall below becomes a deliberate scroll-down
          reward rather than something competing with the buttons. */}
      <div style={{
        width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 26,
        justifyContent: 'center', position: 'relative',
        minHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 44px)',
      }}>
        {/* brand */}
        <div style={{ textAlign: 'center', animation: `rise-in .6s var(--ease) .1s backwards` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.svg" alt="אייכה בר" width={84} height={84}
            style={{ display: 'block', margin: '0 auto 10px', filter: 'drop-shadow(0 0 20px rgba(255,94,58,0.45))' }} />
          <h1 style={{ fontSize: '2.6rem', fontWeight: 800, color: 'var(--text)', textShadow: '0 0 26px rgba(255,94,58,0.6), 0 0 4px rgba(255,138,92,0.75)', margin: 0, letterSpacing: 1 }}>{t.brand}</h1>
          <p style={{ color: 'var(--text-dim)', marginTop: 8, fontSize: '1rem', fontWeight: 500 }}>{t.tagline}</p>
        </div>

        {/* actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Navigate — expandable */}
          <div style={{ animation: `rise-in .55s var(--ease) ${delay()} backwards` }}>
            <button className="press" onClick={() => setNavOpen((v) => !v)} style={{ ...btnStyle(false), width: '100%' }}>
              <span style={icWrap}><Ic>{ICONS.navigate}</Ic></span>
              <span style={{ flex: 1, textAlign: 'start' }}>{t.navigate}</span>
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-faint)', transform: navOpen ? 'rotate(180deg)' : 'none', transition: 'transform .3s var(--ease)' }}><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <div style={{ display: 'grid', gridTemplateRows: navOpen ? '1fr' : '0fr', transition: 'grid-template-rows .4s var(--ease)' }}>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0 2px' }}>
                  {(['gmaps', 'waze', 'amaps'] as const).map((p) => (
                    <a key={p} href={links[p]} target="_blank" rel="noopener noreferrer" className="press" style={subOptStyle}>
                      <span style={{ ...icWrap, color: 'var(--neon-soft)' }}><Ic>{ICONS.pin}</Ic></span>
                      <span style={{ flex: 1, textAlign: 'start' }}>{NAV_LABELS[p]}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Menu — hero */}
          <Link href={LINKS.menu} className="press" style={{ ...btnStyle(true), animation: `rise-in .55s var(--ease) ${delay()} backwards` }}>
            <span style={icWrap}><Ic>{ICONS.menu}</Ic></span>
            <span style={{ flex: 1, textAlign: 'start' }}>{t.menu}</span>
            <Arrow />
          </Link>

          {/* Loyalty — hidden entirely when the owner hides it, otherwise a
              teaser until the club is switched on. Skipping the block also
              skips its delay() call, so the buttons below simply move one step
              earlier in the stagger instead of leaving a gap in the timing. */}
          {loyaltyVisible && (loyaltyEnabled ? (
            <Link href={LINKS.loyalty} className="press" style={{ ...btnStyle(false), animation: `rise-in .55s var(--ease) ${delay()} backwards` }}>
              <span style={icWrap}><Ic>{ICONS.loyalty}</Ic></span>
              <span style={{ flex: 1, textAlign: 'start' }}>{t.loyalty}</span>
              <Arrow />
            </Link>
          ) : (
            <div aria-disabled style={{
              ...btnStyle(false), cursor: 'default', color: 'var(--text-dim)',
              background: 'rgba(255,255,255,0.02)', borderStyle: 'dashed',
              animation: `rise-in .55s var(--ease) ${delay()} backwards`,
            }}>
              <span style={{ ...icWrap, color: 'var(--text-faint)' }}><Ic>{ICONS.loyalty}</Ic></span>
              <span style={{ flex: 1, textAlign: 'start' }}>{t.loyalty}</span>
              <span style={soonChip}>{t.soon}</span>
            </div>
          ))}

          {/* Instagram */}
          <a href={links.instagram} target="_blank" rel="noopener noreferrer" className="press" style={{ ...btnStyle(false), animation: `rise-in .55s var(--ease) ${delay()} backwards` }}>
            <span style={icWrap}><Ic>{ICONS.instagram}</Ic></span>
            <span style={{ flex: 1, textAlign: 'start' }}>{t.instagram}</span>
            <Arrow />
          </a>

          {/* Facebook — takes the slot the review button used to hold. The
              review CTA moved under the wall, where the quotes have already
              made the case for leaving one. */}
          <a href={links.facebook} target="_blank" rel="noopener noreferrer" className="press" style={{ ...btnStyle(false), animation: `rise-in .55s var(--ease) ${delay()} backwards` }}>
            <span style={icWrap}><Ic>{ICONS.facebook}</Ic></span>
            <span style={{ flex: 1, textAlign: 'start' }}>{t.facebook}</span>
            <Arrow />
          </a>
        </div>

        {/* 2026-08-19: "more obvious, inviting, intuitive and professional,
            iOS style" — was a bare, decorative, non-interactive chevron
            (aria-hidden, pointer-events:none). Now a real button: a glass
            capsule sized to an actual iOS touch target (44pt), the chevron
            doubled (the common "more below" motif — a single arrow reads as
            "back/forward" as often as "scroll"), a short label, and a soft
            breathing glow so it visually invites a tap instead of waiting to
            be noticed. Tapping it — not just looking at it — is the
            "intuitive" half: it smooth-scrolls straight to the wall.
            Without a cue almost nobody scrolls a link-hub that fits the
            screen, and the wall is the whole point of scrolling. The label
            ("Reviews") is deliberately shorter than and worded differently
            from the wall's own eyebrow ("What people say") right below it —
            a glance-able pointer, not a second copy of the same sentence. */}
        <button
          type="button"
          className="rw-cue press"
          aria-label={t.scrollCue}
          onClick={() => document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          style={{ animation: `rise-in .55s var(--ease) ${delay()} backwards` }}
        >
          <span className="rw-cue-badge">
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 5.5l6 6 6-6" />
              <path d="M6 12.5l6 6 6-6" />
            </svg>
          </span>
          <span className="rw-cue-label">{t.scrollCue}</span>
        </button>
      </div>

      <ReviewWall block={reviews} lang={lang} />

      <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 16, marginTop: 22 }}>
        {/* Deliberately not btnStyle(true) — that's the Menu button's look, and
            reusing it here would make the review CTA read as "just another
            button" right after a wall built to sell the idea of leaving one.
            Same shape language (padding, radius, icon slot, Arrow), different
            finish: a warm gold gradient (vs. the hero's plain orange) plus a
            slow shimmer sweep via the .review-cta class in globals.css. */}
        <a href={links.review} target="_blank" rel="noopener noreferrer" className="press review-cta" style={reviewCtaStyle}>
          <span style={{ ...icWrap, color: '#ffcf70' }}><Ic>{ICONS.review}</Ic></span>
          <span style={{ flex: 1, textAlign: 'start' }}>{t.review}</span>
          <Arrow />
        </a>

        {/* The private half of the same conversation the gold CTA above asks
            for in public. Sits after it on purpose (PLAN_CUSTOMER_FEEDBACK
            §6) and is styled down to match — see FeedbackButton's own note. */}
        <FeedbackButton lang={lang} enabled={feedbackEnabled} />

        {/* A11y backlog A6: a landmark, not a plain <div>. NOTE — this footer
            sits inside <main> above, and per the HTML/ARIA spec a <footer>
            nested in <main> (or article/aside/nav/section) does NOT get the
            implicit `contentinfo` role the way a top-level one does; an
            explicit role is what actually makes it a landmark here. */}
        <footer role="contentinfo" style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-faint)' }}>
          <p style={{ margin: '0 0 6px' }}>{t.footer}</p>
          <Link href="/accessibility" style={{ color: 'var(--text-faint)', textDecoration: 'underline' }}>{t.accessibility}</Link>
        </footer>
      </div>
    </main>
  )
}

function Arrow() {
  return <svg className="dir-flip" viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-faint)' }}><path d="M9 6l6 6-6 6" /></svg>
}

const icWrap: CSSProperties = { width: 26, display: 'grid', placeItems: 'center', color: 'var(--neon-soft)', flex: '0 0 auto' }

// Same footprint as btnStyle(true) — padding, radius, layout — so the review
// CTA still reads as a member of the same button family. Only the finish
// differs: gold rather than orange, a brighter border, and (via .review-cta
// in globals.css) a shimmer sweep that repeats every few seconds.
const reviewCtaStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', borderRadius: 15,
  border: '1px solid rgba(255,199,84,0.4)',
  background: 'linear-gradient(135deg, rgba(255,199,84,0.26), rgba(255,94,58,0.14))',
  boxShadow: '0 0 26px rgba(255,178,64,0.3)',
  color: 'var(--text)', textDecoration: 'none', fontWeight: 700, fontSize: '1rem',
  fontFamily: 'inherit', cursor: 'pointer', width: '100%',
  position: 'relative', overflow: 'hidden',
}

const soonChip: CSSProperties = {
  flex: '0 0 auto', borderRadius: 999, padding: '3px 10px',
  fontSize: '0.72rem', fontWeight: 700, letterSpacing: 0.3,
  color: 'var(--neon-soft)', background: 'rgba(255,94,58,0.12)',
  border: '1px solid rgba(255,94,58,0.28)',
}

function btnStyle(hero: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', borderRadius: 15,
    border: hero ? '1px solid transparent' : '1px solid var(--line)',
    background: hero ? 'linear-gradient(135deg, rgba(255,94,58,0.18), rgba(255,138,92,0.1))' : 'var(--bg-elev)',
    boxShadow: hero ? '0 0 24px rgba(255,94,58,0.22)' : 'none',
    color: 'var(--text)', textDecoration: 'none', fontWeight: 600, fontSize: '1rem',
    fontFamily: 'inherit', cursor: 'pointer', width: '100%',
  }
}
const subOptStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderRadius: 13,
  border: '1px solid var(--line)', background: 'rgba(20,20,32,0.62)', color: 'var(--text)',
  textDecoration: 'none', fontWeight: 600, fontSize: '0.98rem',
}
