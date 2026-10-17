// The fallback for any route that has no loading.tsx of its own (the menu and the dashboards each
// have a skeleton shaped like their real page; this covers the rest). It shows only while the
// server is still preparing a page after a client-side navigation — never on a first visit to `/`.
// The words are for screen readers only: the language is the visitor's own choice, kept in the
// browser, so a server file cannot pick one — it says both.
export default function Loading() {
  return (
    <main id="main" tabIndex={-1} aria-busy="true" style={{ minHeight: '100dvh', position: 'relative', padding: '72px 20px 40px' }}>
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />
      <div role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        טוען… Loading…
      </div>
      <div aria-hidden style={{ maxWidth: 560, margin: '0 auto', position: 'relative', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="sk" style={{ width: '48%', height: 28, borderRadius: 8 }} />
        <div className="sk" style={{ width: '82%', height: 14, borderRadius: 6 }} />
        <div className="sk" style={{ height: 160, borderRadius: 16, marginTop: 10 }} />
        <div className="sk" style={{ height: 160, borderRadius: 16 }} />
      </div>
    </main>
  )
}
