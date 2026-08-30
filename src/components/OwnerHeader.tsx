import type { ReactNode } from 'react'
import Link from 'next/link'

// The shared header for every /owner/* page.
//
// 2026-08-30: "make sure that each page has also a back button and not just
// a ניהול button." Every subpage already linked back to /owner/dashboard —
// the actual gap was that the link read as "ניהול" (a noun, "management":
// where does this go?) rather than as a back action, and it lived
// duplicated inline in eight separate page files rather than here, so
// fixing the wording once meant fixing it eight times. Centralised: pass
// `backHref` and this renders the actual back control; every page that
// used to build its own "← ניהול" link now just passes the href.
//
// `backHref` also fixes a real hierarchy bug along the way:
// /owner/schedule/print was going straight to /owner/dashboard, skipping
// its actual parent (/owner/schedule) — a back button that skips a level
// isn't back, it's a shortcut wearing a back button's icon.
export default function OwnerHeader({ right, backHref }: { right: ReactNode; backHref?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, gap: 12 }}>
      <div className="rise" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {backHref && (
          <Link
            href={backHref} aria-label="חזרה" className="press"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flex: '0 0 auto', width: 34, height: 34, borderRadius: 999,
              border: '1px solid var(--line)', background: 'var(--bg-elev)',
              color: 'var(--text-dim)', textDecoration: 'none', fontSize: '1.05rem',
              marginInlineEnd: 2,
            }}
          >
            {/* A real chevron, not a text label — "back" needs to read as an
                action at a glance, the way ניהול (a noun) didn't. Left-
                pointing regardless of language direction, matching the "←"
                every page already used before this — not re-litigating
                which way a back arrow should point in RTL, just centralising
                the convention that was already there. */}
            <span aria-hidden>←</span>
          </Link>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo.svg" alt="" width={32} height={32} style={{ display: 'block', flex: '0 0 auto' }} />
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', textShadow: '0 0 16px rgba(255,94,58,0.45)', margin: 0, whiteSpace: 'nowrap' }}>
          אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר
        </h1>
      </div>
      <div className="rise" style={{ animationDelay: '90ms', display: 'flex', alignItems: 'center', gap: 8 }}>
        {typeof right === 'string' ? (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-faint)' }}>{right}</span>
        ) : (
          right
        )}
      </div>
    </div>
  )
}
