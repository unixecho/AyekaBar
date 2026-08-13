import { requireScheduleViewer } from '@/lib/shifts/guard'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import ScheduleWorkspace from '@/components/shifts/ScheduleWorkspace'

// The manager's schedule. Thin on purpose: the guard runs here, everything
// else is the client module.

export const metadata = {
  title: 'סידור עבודה · אייכה בר',
  robots: { index: false, follow: false },
}

export default async function OwnerSchedulePage() {
  const viewer = await requireScheduleViewer()

  return (
    <ShiftsProvider access={viewer.staff} actorName={viewer.name}>
      <ScheduleWorkspace />
    </ShiftsProvider>
  )
}
