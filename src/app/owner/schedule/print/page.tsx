import { redirect } from 'next/navigation'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import PrintView from '@/components/shifts/PrintView'
import { resolveScheduleContext } from '@/lib/shifts/guard'
import { weekStartOf } from '@/lib/shifts/time'
import { todayIn } from '@/lib/shifts/legacy-clock'

export const dynamic = 'force-dynamic'

// The shareable / printable week. Its own route rather than a mode of the builder, so the print
// stylesheet has a page with nothing on it but the poster — no tabs, no week bar, no sheets waiting
// in the DOM to be hidden. Any staff member may open it: what they can SEE is still decided by the
// state route (an employee gets the published week, never the draft).

export const metadata = {
  title: 'סידור עבודה · הדפסה',
  robots: { index: false, follow: false },
}

export default async function SchedulePrintPage({ searchParams }: { searchParams: { week?: string } }) {
  const resolved = await resolveScheduleContext()
  if (!resolved.ok) redirect(resolved.reason === 'unauthenticated' ? '/login' : '/no-access')

  // Validated rather than trusted: this lands in date arithmetic, and a malformed value would render a week of NaN.
  const requested = searchParams.week
  const weekStart = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? weekStartOf(requested) : weekStartOf(todayIn(resolved.ctx.venue.timezone))

  return (
    <ShiftsProvider initialWeekStart={weekStart}>
      <PrintView venueName={resolved.ctx.venue.name} />
    </ShiftsProvider>
  )
}
