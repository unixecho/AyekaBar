import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canManageFloor } from '@/lib/waiter/access'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import FloorBuilder from '@/components/waiter/FloorBuilder'

export const metadata = { title: 'מפת השולחנות · אייכה בר' }

/**
 * The floor builder.
 *
 * Middleware gates this prefix already, but the check is repeated here on
 * purpose — middleware is the first gate, never the only one. That rule is in
 * this project's CLAUDE.md and it is what keeps a routing mistake from
 * becoming an authorization one.
 *
 * The builder itself writes on the visitor's own session, so `is_floor_manager()`
 * (migration 022) is the real enforcement. `canManage` only decides which
 * controls are worth rendering.
 */
export default async function OwnerFloorPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!canManageFloor(me)) redirect('/no-access')

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 1100, margin: '0 auto' }}>
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />

      <div className="rise" style={{ animationDelay: '80ms', marginBottom: 16 }}>
        {/* h2, not h1 — OwnerHeader already renders the page's h1 ("אייכה בר"),
            and two h1s leaves a screen reader with no single document title. */}
        <h2 style={{ margin: '0 0 4px', fontSize: '1.35rem', letterSpacing: '.01em' }}>מפת השולחנות</h2>
        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
          סדרו את החלל פעם אחת — שולחנות, גדלים, צורות ונקודות ציון — ואז עדכנו מתי שהחדר משתנה.
          המלצרים רואים את המפה הזו באפליקציה.
        </p>
      </div>

      <div className="rise" style={{ animationDelay: '140ms' }}>
        <FloorBuilder canManage={canManageFloor(me)} />
      </div>
    </main>
  )
}
