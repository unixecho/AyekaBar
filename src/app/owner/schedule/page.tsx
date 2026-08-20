import { requireScheduleManager } from '@/lib/shifts/guard'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import ScheduleWorkspace from '@/components/shifts/ScheduleWorkspace'

// The manager's schedule. Thin on purpose: the guard runs here, everything
// else is the client module.
//
// requireScheduleManager(), not requireScheduleViewer() — since migration 027
// went live the draft is genuinely invisible to a non-manager at the RLS
// level (Part I decision D6), so a non-manager left on this page would see a
// broken, empty builder rather than a helpful read-only one. They are sent to
// /staff/schedule instead, which is the surface that actually works for them.

export const metadata = {
  title: 'סידור עבודה · אייכה בר',
  robots: { index: false, follow: false },
}

export default async function OwnerSchedulePage() {
  const viewer = await requireScheduleManager()

  return (
    <ShiftsProvider access={viewer.staff} actorName={viewer.name}>
      <ScheduleWorkspace />
    </ShiftsProvider>
  )
}
