// Mirrors OwnerHeader's exact geometry (same gaps/margins) so swapping in the
// real header once auth resolves causes zero layout shift.
export default function OwnerHeaderSkeleton() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="sk" style={{ width: 32, height: 32, borderRadius: 999 }} />
        <div className="sk" style={{ width: 96, height: 20, borderRadius: 6 }} />
      </div>
      <div className="sk" style={{ width: 56, height: 14, borderRadius: 6 }} />
    </div>
  )
}
