import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function OwnerRewardsLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeaderSkeleton />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="sk" style={{ width: 130, height: 20, borderRadius: 6 }} />
        <div className="sk" style={{ height: 130, borderRadius: 14 }} />
        {[0, 1, 2].map((i) => <div key={i} className="sk" style={{ height: 62, borderRadius: 12 }} />)}
      </div>
    </main>
  )
}
