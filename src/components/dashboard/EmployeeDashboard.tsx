import { createServiceClient } from '@/lib/supabase/server'
import { getLoyaltyEnabled } from '@/lib/settings/server'
import { readMyShifts } from '@/lib/staff/my-shifts'
import { zonedNow } from '@/lib/shifts/presence'
import { Z_REPORT_TILE, STAFF_CATEGORIES, STAFF_EXCLUDE, sectionsFor } from '@/lib/dashboard/tiles'
import { zAccessFor } from '@/lib/zreport/server'
import { payslipsReady } from '@/lib/payslips/server'
import DashboardSections, { type LockedTiles } from '@/components/dashboard/DashboardSections'
import ShiftQuickView from '@/components/dashboard/ShiftQuickView'
import StaffPushCard from '@/components/staff/StaffPushCard'
import PendingRemoteOrders from '@/components/staff/PendingRemoteOrders'
import type { AccessRow } from '@/lib/staff/access'

// The employee's dashboard BODY — everything under the greeting. It lives here (2026-10-15) because two pages show
// it: /staff/dashboard for everyone, and the developer's single dashboard (/owner/dev) as its "employee" lens. One
// component means the developer sees exactly what staff see, by construction, not by two pages kept in step.
//
// Server component: it reads the viewer's own shifts, the shift switch, the Z-report window and the two "locked"
// conditions itself. See the long notes that used to head the staff page, kept below.
//
//   1. the shift quick view (the owner asked for it by name),
//   2. customer orders waiting (renders nothing unless something is),
//   3. the work tiles: my shifts · the POS · the loyalty club · payslips — plus whatever else the role opens,
//   4. the Z report, a tile only while the 23:00 window is open for someone who may file,
//   5. alerts on this phone.
//
// Two tiles are shown but closed until what they need exists: the loyalty club until the owner switches it on, and
// the payslip library until migration 060 is applied.

async function posShiftOpen(): Promise<boolean | null> {
  try {
    const { data, error } = await createServiceClient()
      .from('waiter_shift_sessions').select('id').eq('status', 'active').limit(1)
    return error ? null : (data?.length ?? 0) > 0
  } catch {
    return null
  }
}

export default async function EmployeeDashboard({ me }: { me: AccessRow & { id: string; role: string; badge: string | null } }) {
  const service = createServiceClient()
  const [loyaltyLive, myShifts, posOpen, zAccess, payslipsLive] = await Promise.all([
    getLoyaltyEnabled(),
    readMyShifts(me.id),
    posShiftOpen(),
    zAccessFor(service, { staffId: me.id, role: me.role, badge: me.badge }),
    payslipsReady(service),
  ])

  const sections = sectionsFor(me, STAFF_CATEGORIES, STAFF_EXCLUDE)
  if (zAccess.canFile) {
    const work = sections.find((s) => s.category.id === 'mywork')
    if (work) work.tiles = [...work.tiles, Z_REPORT_TILE]
  }
  const locked: LockedTiles = {
    ...(loyaltyLive ? {} : { loyalty: 'בקרוב' }),
    ...(payslipsLive ? {} : { payslips: 'בקרוב' }),
  }

  return (
    <>
      <ShiftQuickView
        shifts={myShifts.shifts}
        roleLabels={myShifts.roleLabels}
        staffId={me.id}
        timezone={myShifts.timezone}
        known={myShifts.known}
        posOpen={posOpen}
        initialNow={zonedNow(myShifts.timezone)}
      />

      {/* Customer orders waiting for a waiter (remote ordering, 2026-10-13). Renders nothing unless something is
          actually waiting — and for anyone who is not told about orders. */}
      <PendingRemoteOrders />

      <DashboardSections sections={sections} locked={locked} baseDelay={150} />

      {/* Alerts on the phone: shift changes, a reminder before a shift, colleagues giving shifts away. */}
      <div className="rise" style={{ animationDelay: '205ms', textAlign: 'start' }}>
        <StaffPushCard variant="home" />
      </div>
    </>
  )
}
