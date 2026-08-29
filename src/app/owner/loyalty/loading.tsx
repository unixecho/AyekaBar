import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function OwnerLoyaltyLoading() {
  return (
    <main style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeaderSkeleton />
      <div className="sk" style={{ height: 150, borderRadius: 16, marginBottom: 16 }} />
      <div className="sk" style={{ height: 110, borderRadius: 16, marginBottom: 16 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {[0, 1].map((i) => <div key={i} className="sk" style={{ height: 74, borderRadius: 14 }} />)}
      </div>
    </main>
  )
}
