import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getLoyaltyEnabled } from '@/lib/settings/server'
import OwnerHeader from '@/components/OwnerHeader'
import QRDisplay from '@/components/QRDisplay'
import SignOutButton from '@/components/SignOutButton'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'מועדון נאמנות · אזור הצוות', robots: { index: false, follow: false } }

// The staff member's loyalty-club screen (2026-10-13) — the check-in QR that
// used to sit directly on /staff/dashboard, moved behind its own tile so the
// dashboard can be a dashboard. While the club is OFF (today) the tile on the
// dashboard is locked and this page, reached by a bookmark, says the same
// thing instead of showing a QR that would award nothing.

export default async function StaffLoyaltyPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('staff').select('role').eq('auth_user_id', user.id).maybeSingle()
  if (!me) redirect('/no-access')

  const live = await getLoyaltyEnabled()

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 420, margin: '0 auto' }}>
      <OwnerHeader backHref="/staff/dashboard" right={<SignOutButton />} />

      {live ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'center' }}>
          <div className="rise" style={{ animationDelay: '60ms' }}><QRDisplay /></div>
          <div className="rise" style={{
            background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 18,
            padding: 16, textAlign: 'start', animationDelay: '140ms',
          }}>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 8px' }}>הוראות לצוות:</h2>
            <ol style={{ margin: 0, padding: '0 20px 0 0', color: 'var(--text-dim)', fontSize: '0.85rem', lineHeight: 1.7 }}>
              <li>הצג את הקוד ללקוח לפני שעוזב</li>
              <li>הלקוח סורק עם המצלמה שלו</li>
              <li>הנקודה נצברת אוטומטית</li>
            </ol>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-faint)', margin: '10px 0 0' }}>
              הקוד מתחדש כל 15 דקות ותקף לשימוש חד-פעמי
            </p>
          </div>
        </div>
      ) : (
        <div className="rise" style={{
          background: 'var(--bg-elev)', border: '1px dashed var(--line-strong)', borderRadius: 18,
          padding: '26px 18px', textAlign: 'center',
        }}>
          <div aria-hidden style={{ fontSize: '1.9rem', marginBottom: 8 }}>⏳</div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>מועדון הנאמנות עדיין לא פעיל</h2>
          <p style={{ fontSize: '0.86rem', color: 'var(--text-dim)', margin: '8px 0 0', lineHeight: 1.6 }}>
            קוד ה-QR יופיע כאן ברגע שהבעלים יפעיל/תפעיל את המועדון. אין צורך לעשות כלום — הכניסה שלך פעילה.
          </p>
        </div>
      )}
    </main>
  )
}
