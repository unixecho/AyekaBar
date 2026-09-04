import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getLoyaltyEnabled } from '@/lib/settings/server'
import { badgeMeta } from '@/lib/staff/badges'
import { canEditMenu } from '@/lib/staff/access'
import QRDisplay from '@/components/QRDisplay'
import SignOutButton from '@/components/SignOutButton'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'אזור הצוות · אייכה בר' }

export default async function StaffDashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Being signed in with Google is not being staff. Middleware gates this too
  // (and claims a pending invite on the way in), but check here as well —
  // same defense-in-depth pattern as the /owner/* pages.
  const { data: me } = await supabase
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me) redirect('/no-access')

  // The check-in QR only means anything while the club is running. Staff can
  // still sign in when it's off — they just see why the code isn't here,
  // rather than being bounced to a public coming-soon page that reads like a
  // failed login.
  const loyaltyLive = await getLoyaltyEnabled()
  const meta = badgeMeta(me.badge, me.role)

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 24, textAlign: 'center' }}>
        {/* Header */}
        <div className="rise" style={{ animationDelay: '20ms', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.svg" alt="" width={48} height={48} style={{ display: 'block' }} />
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', textShadow: '0 0 18px rgba(255,94,58,0.5)', margin: 0 }}>
            אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר
          </h1>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: `${meta.color}18`, border: `1px solid ${meta.color}44`, color: meta.color,
            borderRadius: 999, padding: '4px 12px', fontSize: '0.78rem', fontWeight: 700,
          }}>
            <span aria-hidden>{meta.emoji}</span>{meta.he}
          </span>
        </div>

        {loyaltyLive ? (
          <>
            <div className="rise" style={{ animationDelay: '110ms' }}>
              <QRDisplay />
            </div>

            {/* Instructions for staff */}
            <div className="rise" style={{
              background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 18,
              padding: 16, textAlign: 'start', animationDelay: '200ms',
            }}>
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 8px' }}>הוראות לצוות:</p>
              <ol style={{ margin: 0, padding: '0 20px 0 0', color: 'var(--text-dim)', fontSize: '0.85rem', lineHeight: 1.7 }}>
                <li>הצג את הקוד ללקוח לפני שעוזב</li>
                <li>הלקוח סורק עם המצלמה שלו</li>
                <li>הנקודה נצברת אוטומטית</li>
              </ol>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-faint)', margin: '10px 0 0' }}>
                הקוד מתחדש כל 15 דקות ותקף לשימוש חד-פעמי
              </p>
            </div>
          </>
        ) : (
          <div className="rise" style={{
            background: 'var(--bg-elev)', border: '1px dashed var(--line-strong)', borderRadius: 18,
            padding: '22px 18px', animationDelay: '110ms',
          }}>
            <div aria-hidden style={{ fontSize: '1.8rem', marginBottom: 8 }}>⏳</div>
            <p style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
              מועדון הנאמנות עדיין לא פעיל
            </p>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-dim)', margin: '6px 0 0', lineHeight: 1.6 }}>
              קוד ה-QR יופיע כאן ברגע שהבעלים יפעיל/תפעיל את המועדון. אין צורך לעשות כלום — הכניסה שלך פעילה.
            </p>
          </div>
        )}

        {/* Every staff member reaches their own published shifts from here.
            Unlike the editor link below it, this one is not gated: the whole
            point of the schedule is that the person working the shift can see
            it. What they see is limited by the data, not by this button. */}
        <Link href="/staff/schedule" className="press rise" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '13px 16px', borderRadius: 14, textDecoration: 'none',
          border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
          color: 'var(--text)', fontWeight: 600, fontSize: '0.92rem',
          animationDelay: '215ms',
        }}>
          🗓️ המשמרות שלי
        </Link>

        {/* The GM reaches the menu from here — they have no owner dashboard. */}
        {canEditMenu(me) && (
          <Link href="/owner/editor" className="press rise" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px 16px', borderRadius: 14, textDecoration: 'none',
            border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
            color: 'var(--text)', fontWeight: 600, fontSize: '0.92rem',
            animationDelay: '230ms',
          }}>
            📝 עריכת התפריט
          </Link>
        )}

        {/* Shared-device bars hand this screen between shifts, so staff need a
            way off it without clearing browser data. */}
        <div className="rise" style={{ animationDelay: '260ms', display: 'flex', justifyContent: 'center' }}>
          <SignOutButton />
        </div>
      </div>
    </main>
  )
}
