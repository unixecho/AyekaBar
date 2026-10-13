import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

// Mirrors the rebuilt staff dashboard (2026-10-13): greeting, the shift quick
// view, then the work tiles — so the page swaps in with no layout shift.
export default function StaffDashboardLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeaderSkeleton />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="sk" style={{ width: 180, height: 24, borderRadius: 8 }} />
        <div className="sk" style={{ height: 120, borderRadius: 18 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {[0, 1, 2].map((i) => <div key={i} className="sk" style={{ height: 92, borderRadius: 14 }} />)}
        </div>
      </div>
    </main>
  )
}
