import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import ScheduleWorkspace from '@/components/shifts/ScheduleWorkspace'
import { resolveScheduleContext } from '@/lib/shifts/guard'

export const dynamic = 'force-dynamic'

// The manager's schedule. Thin on purpose: the guard runs here, everything else is the client module.
//
// Manage-gated, but not by the coarse owner checks: a delegated schedule manager can be any staff
// member (their badge might just be "bartender"), so middleware only requires a staff row here and
// this page makes the real decision — OP, the general manager, or someone listed in
// shift_settings.schedule_managers. Anyone else is sent to /staff/schedule, the surface that
// actually works for them (the draft is invisible to them in any case).

export const metadata = {
  title: 'סידור עבודה · אייכה בר',
  robots: { index: false, follow: false },
}

export default async function OwnerSchedulePage() {
  const resolved = await resolveScheduleContext()
  if (!resolved.ok) redirect(resolved.reason === 'unauthenticated' ? '/login' : '/no-access')
  if (!resolved.ctx.isManager) redirect('/staff/schedule')

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 1560, margin: '0 auto', padding: '20px 16px 40px' }}>
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />
      <ShiftsProvider>
        <ScheduleWorkspace venueName={resolved.ctx.venue.name} />
      </ShiftsProvider>
    </main>
  )
}
