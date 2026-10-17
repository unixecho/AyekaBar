'use client'

import Link from 'next/link'
import { useLanguage, type Lang } from '@/components/LanguageSwitch'

// The 404 screen. Same look as /no-access (the app's other "you cannot be here" page) but in the
// visitor's own language: not-found.tsx is a server file and cannot know it, so the words live here.
const T: Record<Lang, { code: string; title: string; body: string; home: string; menu: string }> = {
  he: { code: 'שגיאה 404', title: 'הדף לא נמצא', body: 'הקישור שגוי, או שהדף הזה כבר לא קיים.', home: 'חזרה לדף הבית', menu: 'לתפריט' },
  en: { code: 'Error 404', title: 'Page not found', body: 'The link is wrong, or this page no longer exists.', home: 'Back to the home page', menu: 'To the menu' },
  ar: { code: 'خطأ 404', title: 'الصفحة غير موجودة', body: 'الرابط غير صحيح، أو أن هذه الصفحة لم تعد موجودة.', home: 'العودة إلى الصفحة الرئيسية', menu: 'إلى القائمة' },
}

export default function NotFoundView() {
  const [lang] = useLanguage()
  const t = T[lang]
  return (
    <main id="main" tabIndex={-1} style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(env(safe-area-inset-top) + 24px) 20px calc(env(safe-area-inset-bottom) + 24px)',
      position: 'relative',
    }}>
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        <img src="/assets/logo.svg" alt="" width={72} height={72}
          style={{ display: 'block', margin: '0 auto 16px', animation: 'rise-in .6s var(--ease) .05s backwards' }} />
        <p style={{ color: 'var(--neon)', fontWeight: 700, letterSpacing: '0.08em', margin: 0, fontSize: '0.85rem', animation: 'rise-in .6s var(--ease) .1s backwards' }}>{t.code}</p>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '6px 0 0', color: 'var(--text)', animation: 'rise-in .6s var(--ease) .14s backwards' }}>{t.title}</h1>
        <p style={{ color: 'var(--text-dim)', margin: '10px 0 0', fontSize: '0.95rem', lineHeight: 1.65, animation: 'rise-in .6s var(--ease) .2s backwards' }}>{t.body}</p>

        <Link href="/" className="press" style={{
          display: 'block', width: '100%', marginTop: 24, padding: '15px 18px', borderRadius: 15,
          background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)',
          color: 'var(--bg)', fontSize: '1rem', fontWeight: 700, textDecoration: 'none',
          animation: 'rise-in .6s var(--ease) .28s backwards',
        }}>{t.home}</Link>
        <Link href="/menu" className="press" style={{
          display: 'block', width: '100%', marginTop: 10, padding: '14px 18px', borderRadius: 15,
          border: '1px solid var(--line-strong)', background: 'var(--bg-elev)', color: 'var(--text)',
          fontSize: '0.94rem', fontWeight: 600, textDecoration: 'none',
          animation: 'rise-in .6s var(--ease) .34s backwards',
        }}>{t.menu}</Link>
      </div>
    </main>
  )
}
