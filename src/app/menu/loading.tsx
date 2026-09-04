// Shown instantly on navigation while the server fetches the published menu.
// Reuses the real menu-* classes so the skeleton's geometry exactly matches
// the live page — no layout shift when MenuView swaps in.
export default function MenuLoading() {
  return (
    <div className="menu-page">
      <div className="app-bg" aria-hidden />
      <div className="menu-scrim" aria-hidden />

      <div className="menu-sticky">
        <header className="menu-topbar">
          <div className="sk" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38, borderRadius: 12 }} />
          <div className="sk" style={{ width: 110, height: 20, borderRadius: 6 }} />
          <div className="sk" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38, borderRadius: 12 }} />
        </header>

        <div className="menu-chips-wrap">
          <nav className="menu-chips" aria-hidden>
            {[64, 84, 70, 96, 78, 60].map((w, i) => (
              <div key={i} className="sk" style={{ width: w, height: 34, borderRadius: 999, flex: '0 0 auto' }} />
            ))}
          </nav>
        </div>
      </div>

      <main id="main" tabIndex={-1} className="menu-main">
        {[0, 1, 2, 3, 4].map((i) => (
          <section className="cat" key={i}>
            <div className="cat-head" style={{ cursor: 'default' }}>
              <div className="sk" style={{ width: 40, height: 40, borderRadius: 12 }} />
              <div className="sk" style={{ width: '40%', height: 16, borderRadius: 6 }} />
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
