import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function OwnerLinksLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeaderSkeleton />
      <div className="sk" style={{ height: 420, borderRadius: 16 }} />
    </main>
  )
}
