import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function OwnerEditorLoading() {
  return (
    <main id="main" style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeaderSkeleton />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="sk" style={{ width: 140, height: 20, borderRadius: 6 }} />
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="sk" style={{ height: 58, borderRadius: 14 }} />)}
      </div>
    </main>
  )
}
