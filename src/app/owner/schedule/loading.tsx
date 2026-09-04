// Skeleton in the shape of the week, so arriving from the dashboard doesn't
// flash an empty page and then reflow. Matches the other owner routes.

export default function Loading() {
  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '20px 16px', maxWidth: 1180, margin: '0 auto' }} aria-busy="true">
      <div className="sk" style={{ height: 44, borderRadius: 14, marginBottom: 16 }} />
      <div className="sk" style={{ height: 120, borderRadius: 18, marginBottom: 14 }} />
      <div className="sk" style={{ height: 40, borderRadius: 12, marginBottom: 14 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="sk" style={{ height: 180, borderRadius: 16 }} />
        ))}
      </div>
    </main>
  )
}
