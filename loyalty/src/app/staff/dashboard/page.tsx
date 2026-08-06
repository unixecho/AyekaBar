import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import QRDisplay from '@/components/QRDisplay'
import SignOutButton from '@/components/SignOutButton'

export default async function StaffDashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/staff')

  // Being signed in with Google is not being staff. Middleware gates this too
  // (and claims a pending invite on the way in), but check here as well —
  // same defense-in-depth pattern as the /owner/* pages.
  const { data: me } = await supabase
    .from('staff')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me) redirect('/staff?denied=1')

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 24, textAlign: 'center' }}>
        {/* Header */}
        <div className="rise" style={{ animationDelay: '20ms', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.svg" alt="" width={48} height={48} style={{ display: 'block' }} />
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', textShadow: '0 0 18px rgba(255,94,58,0.5)', margin: 0 }}>
            אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר
          </h1>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.9rem' }}>קוד QR לצוות</p>
        </div>

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

        {/* Shared-device bars hand this screen between shifts, so staff need a
            way off it without clearing browser data. */}
        <div className="rise" style={{ animationDelay: '260ms', display: 'flex', justifyContent: 'center' }}>
          <SignOutButton />
        </div>
      </div>
    </main>
  )
}
