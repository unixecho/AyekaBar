'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { PORTAL_LINKS_DEFAULT, type PortalLinkKey } from '@/lib/settings/keys'
import LanguageSwitch, { useLanguage, type Lang } from '@/components/LanguageSwitch'

const LINKS = {
  menu: '/menu',
  loyalty: '/loyalty',
  team: '/team',
}
const NAV_LABELS = { gmaps: 'Google Maps', waze: 'Waze', amaps: 'Apple Maps' }

const I18N: Record<Lang, {
  brand: ReactNode; tagline: string; navigate: string; menu: string; instagram: string
  review: string; loyalty: string; soon: string; team: string; footer: string
}> = {
  he: { brand: <>אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר</>, tagline: 'חריש · ישראל', navigate: 'ניווט אלינו', menu: 'תפריט דיגיטלי', instagram: 'אינסטגרם', review: 'השארת ביקורת', loyalty: 'מועדון נאמנות', soon: 'בקרוב', team: 'הצוות שלנו', footer: '© אייכה בר' },
  en: { brand: 'Ayeka Bar', tagline: 'Harish · Israel', navigate: 'Navigate to us', menu: 'Digital menu', instagram: 'Instagram', review: 'Leave a review', loyalty: 'Loyalty Club', soon: 'Coming soon', team: 'Our team', footer: '© Ayeka Bar' },
  ar: { brand: <>אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר</>, tagline: 'حريش · إسرائيل', navigate: 'الوصول إلينا', menu: 'القائمة الرقمية', instagram: 'إنستغرام', review: 'اترك تقييماً', loyalty: 'نادي الولاء', soon: 'قريباً', team: 'طاقمنا', footer: '© אייכה בר' },
}

const ICONS = {
  navigate: <path d="M3 11l19-9-9 19-2-8-8-2z" />,
  team: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><circle cx="17" cy="9.5" r="2.4" /><path d="M15.5 14.2c2.6-.5 5 1.3 5 4.3" /></>,
  menu: <><path d="M4 5h16" /><path d="M4 10h16" /><path d="M4 15h10" /><path d="M4 20h7" /></>,
  loyalty: <><rect x="2" y="6" width="20" height="14" rx="3" /><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><circle cx="12" cy="13" r="2" /><path d="M9 17c0-1.7 1.3-3 3-3s3 1.3 3 3" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></>,
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
}: {
  loyaltyEnabled?: boolean
  /** Off = no loyalty entry on the portal at all, teaser included. */
  loyaltyVisible?: boolean
  links?: Record<PortalLinkKey, string>
}) {
  const [lang, setLang] = useLanguage()
  const [navOpen, setNavOpen] = useState(false)
  const t = I18N[lang]

  let d = 0
  const delay = () => `${260 + (d++) * 85}ms`

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'calc(env(safe-area-inset-top) + 20px) 20px calc(env(safe-area-inset-bottom) + 24px)', position: 'relative' }}>
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <LanguageSwitch lang={lang} onChange={setLang} />

      <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 26 }}>
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

          {/* Team */}
          <Link href={LINKS.team} className="press" style={{ ...btnStyle(false), animation: `rise-in .55s var(--ease) ${delay()} backwards` }}>
            <span style={icWrap}><Ic>{ICONS.team}</Ic></span>
            <span style={{ flex: 1, textAlign: 'start' }}>{t.team}</span>
            <Arrow />
          </Link>

          {/* Instagram */}
          <a href={links.instagram} target="_blank" rel="noopener noreferrer" className="press" style={{ ...btnStyle(false), animation: `rise-in .55s var(--ease) ${delay()} backwards` }}>
            <span style={icWrap}><Ic>{ICONS.instagram}</Ic></span>
            <span style={{ flex: 1, textAlign: 'start' }}>{t.instagram}</span>
            <Arrow />
          </a>

          {/* Review */}
          <a href={links.review} target="_blank" rel="noopener noreferrer" className="press" style={{ ...btnStyle(false), animation: `rise-in .55s var(--ease) ${delay()} backwards` }}>
            <span style={icWrap}><Ic>{ICONS.review}</Ic></span>
            <span style={{ flex: 1, textAlign: 'start' }}>{t.review}</span>
            <Arrow />
          </a>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-faint)', margin: 0, animation: `rise-in .55s var(--ease) ${delay()} backwards` }}>{t.footer}</p>
      </div>
    </main>
  )
}

function Arrow() {
  return <svg className="dir-flip" viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-faint)' }}><path d="M9 6l6 6-6 6" /></svg>
}

const icWrap: CSSProperties = { width: 26, display: 'grid', placeItems: 'center', color: 'var(--neon-soft)', flex: '0 0 auto' }

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
