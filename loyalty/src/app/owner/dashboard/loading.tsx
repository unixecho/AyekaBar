import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function OwnerDashboardLoading() {
  return (
    <main style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeaderSkeleton />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 74, borderRadius: 14 }} />)}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="sk" style={{ width: 120, height: 20, borderRadius: 6 }} />
          <div className="sk" style={{ width: '80%', height: 14, borderRadius: 6 }} />
        </div>
        <div className="sk" style={{ height: 180, borderRadius: 16 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2].map((i) => <div key={i} className="sk" style={{ height: 78, borderRadius: 14 }} />)}
        </div>
      </div>
    </main>
  )
}
