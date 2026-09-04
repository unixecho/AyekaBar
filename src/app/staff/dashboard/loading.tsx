export default function StaffDashboardLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center' }}>
        <div className="sk" style={{ width: 48, height: 48, borderRadius: 999 }} />
        <div className="sk" style={{ width: 120, height: 20, borderRadius: 6 }} />
        <div className="sk" style={{ width: 268, height: 268, borderRadius: 20 }} />
        <div className="sk" style={{ width: '100%', height: 90, borderRadius: 18 }} />
      </div>
    </main>
  )
}
