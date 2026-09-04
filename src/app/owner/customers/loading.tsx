import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function OwnerCustomersLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeaderSkeleton />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="sk" style={{ width: 160, height: 22, borderRadius: 6 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 66, borderRadius: 14 }} />)}
        </div>
        <div className="sk" style={{ height: 42, borderRadius: 10 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 60, borderRadius: 12 }} />)}
        </div>
      </div>
    </main>
  )
}
