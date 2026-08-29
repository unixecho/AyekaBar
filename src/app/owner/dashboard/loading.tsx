import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

// Mirrors the rebuilt dashboard's order: strip, then the space the signal
// stack MAY occupy, then the Overall view card, then the tile grid.
//
// The signal-stack placeholder is deliberately short and single-block rather
// than a stack of alert-shaped rows. Skeletons promise what is coming, and on
// a quiet night nothing is coming — a tall stack of fake alert rows that
// resolves to empty is a lie the page tells twice a day.

export default function OwnerDashboardLoading() {
  return (
    <main style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeaderSkeleton />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7, marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 60, borderRadius: 13 }} />)}
      </div>

      <div className="sk" style={{ height: 72, borderRadius: 16, marginBottom: 16 }} />

      <div className="sk" style={{ height: 132, borderRadius: 16, marginBottom: 16 }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="sk" style={{ height: 74, borderRadius: 14 }} />)}
      </div>
    </main>
  )
}
