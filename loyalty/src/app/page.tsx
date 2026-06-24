import Link from 'next/link'

export default function HomePage() {
  return (
    <main style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* Brand */}
        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            fontSize: '2.4rem',
            fontWeight: 800,
            color: 'var(--text)',
            textShadow: '0 0 22px rgba(255,94,58,0.6), 0 0 4px rgba(255,138,92,0.8)',
            margin: 0,
            letterSpacing: 1,
          }}>
            אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר
          </h1>
          <p style={{ color: 'var(--text-dim)', marginTop: 8, fontSize: '1.05rem', fontWeight: 400 }}>
            מועדון נאמנות
          </p>
        </div>

        {/* Loyalty teaser */}
        <div style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 18,
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          {[
            { pts: 10, label: 'כוס בירה חינם', icon: '🍺' },
            { pts: 20, label: 'מנה ראשונה חינם', icon: '🥗' },
            { pts: 30, label: 'קוקטייל הבית',   icon: '🍹' },
            { pts: 50, label: 'פרס VIP',          icon: '⭐' },
          ].map((r) => (
            <div key={r.pts} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'var(--text-dim)',
              fontSize: '0.9rem',
            }}>
              <span style={{ fontSize: '1.1rem' }}>{r.icon}</span>
              <span style={{ flex: 1 }}>{r.label}</span>
              <span style={{
                background: 'rgba(255,94,58,0.12)',
                border: '1px solid rgba(255,94,58,0.25)',
                borderRadius: 999,
                padding: '2px 10px',
                fontSize: '0.78rem',
                fontWeight: 700,
                color: 'var(--neon-soft)',
              }}>{r.pts} ✦</span>
            </div>
          ))}
        </div>

        {/* CTAs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Link href="/customer" style={{
            display: 'block',
            width: '100%',
            borderRadius: 14,
            background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
            boxShadow: 'var(--glow)',
            padding: '14px 0',
            textAlign: 'center',
            fontSize: '1.05rem',
            fontWeight: 700,
            color: '#fff',
            textDecoration: 'none',
          }}>
            אני לקוח/ה
          </Link>

          <Link href="/staff" style={{
            display: 'block',
            width: '100%',
            borderRadius: 14,
            border: '1px solid var(--line-strong)',
            background: 'rgba(255,255,255,0.03)',
            padding: '14px 0',
            textAlign: 'center',
            fontSize: '1.05rem',
            fontWeight: 600,
            color: 'var(--text-dim)',
            textDecoration: 'none',
          }}>
            צוות בר
          </Link>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-faint)', margin: 0 }}>
          כל ביקור = נקודה אחת. ללא כרטיס, ללא אפליקציה.
        </p>
      </div>
    </main>
  )
}
