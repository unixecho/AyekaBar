'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import LanguageSwitch, { useLanguage, type Lang } from '@/components/LanguageSwitch'
import { POLICY as T, PRIVACY_POLICY_UPDATED } from '@/lib/privacy/policy'
import { COOKIES_PATH } from '@/lib/privacy/notice'

// The privacy policy page. Same shell as /cookies (CookiesView) — language is the visitor's own
// choice kept in the browser, the server page only says which languages the owner offers.
export default function PrivacyView({ languages }: { languages?: Lang[] }) {
  const [lang, setLang] = useLanguage(languages)
  return (
    <main id="main" tabIndex={-1} lang={lang} style={{
      minHeight: '100dvh', position: 'relative',
      padding: 'calc(env(safe-area-inset-top) + 68px) 20px calc(env(safe-area-inset-bottom) + 60px)',
    }}>
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />
      <LanguageSwitch lang={lang} onChange={setLang} languages={languages} />

      <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative' }}>
        <Link href="/" style={backLink}>
          <svg className="dir-flip" viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {T.back[lang]}
        </Link>

        <h1 style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--text)', margin: '14px 0 6px', lineHeight: 1.25 }}>{T.title[lang]}</h1>
        <p style={{ margin: '0 0 6px', color: 'var(--text-dim)', fontSize: '0.98rem', lineHeight: 1.6 }}>{T.lead[lang]}</p>
        <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', margin: '0 0 28px' }}>
          {T.updated[lang]} <time dateTime={PRIVACY_POLICY_UPDATED}>{PRIVACY_POLICY_UPDATED}</time>
        </p>

        {T.sections.map((s, i) => (
          <section key={i} style={{ marginBottom: 30 }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 10px' }}>{s.title[lang]}</h2>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.93rem', lineHeight: 1.75 }}>
              {s.paras?.map((p, j) => <p key={j} style={{ margin: j ? '10px 0 0' : 0 }}>{p[lang]}</p>)}
              {s.bullets && (
                <ul style={{ margin: 0, paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {s.bullets.map((b, j) => <li key={j}>{b[lang]}</li>)}
                </ul>
              )}
            </div>
          </section>
        ))}

        <p style={{ margin: 0 }}>
          <Link href={COOKIES_PATH} className="tap44" style={{ color: 'var(--neon-soft)', textDecoration: 'underline', fontWeight: 600 }}>{T.cookiesLink[lang]}</Link>
        </p>
      </div>
    </main>
  )
}

const backLink: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44,
  color: 'var(--text-faint)', fontSize: '0.88rem', textDecoration: 'none',
}
