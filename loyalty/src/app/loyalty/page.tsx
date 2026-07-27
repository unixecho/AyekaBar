import Link from 'next/link'
import { getLoyaltyEnabled } from '@/lib/settings/server'

const REWARDS = [
  { pts: 10, label: 'כוס בירה חינם', icon: '🍺' },
  { pts: 20, label: 'מנה ראשונה חינם', icon: '🥗' },
  { pts: 30, label: 'קוקטייל הבית', icon: '🍹' },
  { pts: 50, label: 'פרס VIP', icon: '⭐' },
]

export default async function LoyaltyLandingPage() {
  const enabled = await getLoyaltyEnabled()

  return (
    <main style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'calc(env(safe-area-inset-top) + 20px) 20px calc(env(safe-area-inset-bottom) + 24px)',
      position: 'relative',
    }}>
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Brand */}
        <div className="rise" style={{ textAlign: 'center', animationDelay: '60ms' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.svg" alt="אייכה בר" width={72} height={72}
            style={{ display: 'block', margin: '0 auto 10px', filter: 'drop-shadow(0 0 18px rgba(255,94,58,0.45))' }} />
          <h1 style={{
            fontSize: '2.2rem',
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
          {!enabled && (
            <div className="rise" style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12,
              borderRadius: 999, padding: '5px 14px',
              background: 'rgba(255,94,58,0.12)', border: '1px solid rgba(255,94,58,0.3)',
              color: 'var(--neon-soft)', fontSize: '0.82rem', fontWeight: 700,
              animationDelay: '110ms',
            }}>
              ✦ בקרוב
            </div>
          )}
        </div>

        {/* Rewards teaser — the whole point of showing this page while the club
            is still dark: people see what's coming. */}
        <div className="rise" style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 18,
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          animationDelay: '150ms',
        }}>
          {REWARDS.map((r, i) => (
            <div key={r.pts} className="rise" style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'var(--text-dim)',
              fontSize: '0.9rem',
              animationDelay: `${220 + i * 70}ms`,
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

        {enabled ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Link href="/customer" className="rise press" style={{
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
              animationDelay: '540ms',
            }}>
              אני לקוח/ה
            </Link>

            <Link href="/staff" className="rise press" style={{
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
              animationDelay: '610ms',
            }}>
              צוות בר
            </Link>
          </div>
        ) : (
          <div className="rise" style={{
            borderRadius: 14, border: '1px dashed var(--line-strong)',
            background: 'rgba(255,255,255,0.02)', padding: '16px 18px',
            textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.9rem',
            lineHeight: 1.6, animationDelay: '540ms',
          }}>
            המועדון ייפתח בקרוב.<br />
            בינתיים — סרקו את הברקוד בבר, עיינו בתפריט, ועקבו אחרינו לעדכון.
          </div>
        )}

        <p className="rise" style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-faint)', margin: 0, animationDelay: '670ms' }}>
          כל ביקור = נקודה אחת. ללא כרטיס, ללא אפליקציה.
        </p>

        <Link href="/" className="rise" style={{ color: 'var(--text-faint)', fontSize: '0.82rem', textAlign: 'center', textDecoration: 'none', animationDelay: '720ms' }}>
          ← חזרה לדף הבית
        </Link>
      </div>
    </main>
  )
}
