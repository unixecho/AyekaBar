export default function Loading() {
  return <main dir="rtl" aria-busy="true" style={{ minHeight: '100dvh', maxWidth: 960, margin: 'auto', padding: 20, background: 'var(--bg)' }}>
    <span className="sr-only">טוען תצוגה מקדימה</span>
    <div className="sk" aria-hidden style={{ height: 56, borderRadius: 22, marginBottom: 24 }} />
    <div className="sk" aria-hidden style={{ height: 34, width: 200, borderRadius: 12, marginBottom: 18 }} />
    <div className="sk" aria-hidden style={{ height: 90, borderRadius: 18, marginBottom: 14 }} />
    <div className="sk" aria-hidden style={{ height: 190, borderRadius: 18, marginBottom: 14 }} />
    <div className="sk" aria-hidden style={{ height: 250, borderRadius: 18 }} />
  </main>
}
