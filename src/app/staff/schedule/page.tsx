import { requireScheduleViewer } from '@/lib/shifts/guard'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import StaffWorkspace from '@/components/shifts/StaffWorkspace'

// The employee's schedule. Same guard, same provider, a different surface —
// and it reads only published snapshots, which is enforced by the data source
// rather than by this page.

export const metadata = {
  title: 'המשמרות שלי · אייכה בר',
  robots: { index: false, follow: false },
}

export default async function StaffSchedulePage() {
  const viewer = await requireScheduleViewer()

  return (
    <ShiftsProvider access={viewer.staff} actorName={viewer.name}>
      <StaffWorkspace />
    </ShiftsProvider>
  )
}
