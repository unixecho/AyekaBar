import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import StaffWorkspace from '@/components/shifts/StaffWorkspace'
import { resolveScheduleContext } from '@/lib/shifts/guard'

export const dynamic = 'force-dynamic'

// The employee's schedule. Everything on it comes from /api/shifts/state, which narrows what a
// non-manager may see to the published snapshot, their own requests and swaps, and their own
// notifications — enforced by the server, not by this page.

export const metadata = {
  title: 'המשמרות שלי · אייכה בר',
  robots: { index: false, follow: false },
}

export default async function StaffSchedulePage() {
  const resolved = await resolveScheduleContext()
  if (!resolved.ok) redirect(resolved.reason === 'unauthenticated' ? '/login' : '/no-access')

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 1560, margin: '0 auto', padding: '20px 16px 40px' }}>
      <OwnerHeader backHref="/staff/dashboard" right={<SignOutButton />} />
      <ShiftsProvider>
        <StaffWorkspace venueName={resolved.ctx.venue.name} />
      </ShiftsProvider>
    </main>
  )
}
