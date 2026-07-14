export default function CustomerDashboardLoading() {
  return (
    <main style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 440, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="sk" style={{ width: 32, height: 32, borderRadius: 999 }} />
          <div className="sk" style={{ width: 90, height: 20, borderRadius: 6 }} />
        </div>
        <div className="sk" style={{ width: 70, height: 14, borderRadius: 6 }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="sk" style={{ height: 160, borderRadius: 18 }} />
        <div className="sk" style={{ height: 130, borderRadius: 18 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="sk" style={{ width: 100, height: 16, borderRadius: 6 }} />
          {[0, 1, 2].map((i) => <div key={i} className="sk" style={{ height: 56, borderRadius: 12 }} />)}
        </div>
      </div>
    </main>
  )
}
