import { requireScheduleViewer } from '@/lib/shifts/guard'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import PrintView from '@/components/shifts/PrintView'
import { AYEKA_VENUE } from '@/lib/shifts/config'
import { todayIn, weekStartOf } from '@/lib/shifts/time'

// The printable sheet. Its own route rather than a mode of the builder, so the
// print stylesheet has a page with nothing on it but the schedule — no tabs,
// no week bar, no sheets waiting in the DOM to be hidden.

export const metadata = {
  title: 'סידור עבודה · הדפסה',
  robots: { index: false, follow: false },
}

export default async function SchedulePrintPage({
  searchParams,
}: {
  searchParams: { week?: string }
}) {
  const viewer = await requireScheduleViewer()

  // Validated rather than trusted: this lands in date arithmetic, and a
  // malformed value would render a week of NaN.
  const requested = searchParams.week
  const weekStart = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)
    ? weekStartOf(requested, AYEKA_VENUE.weekStartsOn)
    : weekStartOf(todayIn(AYEKA_VENUE.timezone), AYEKA_VENUE.weekStartsOn)

  return (
    <ShiftsProvider access={viewer.staff} actorName={viewer.name}>
      <PrintView weekStart={weekStart} />
    </ShiftsProvider>
  )
}
