import type { ReactNode } from 'react'

export default function OwnerHeader({ right }: { right: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, gap: 12 }}>
      <div className="rise" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo.svg" alt="" width={32} height={32} style={{ display: 'block' }} />
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', textShadow: '0 0 16px rgba(255,94,58,0.45)', margin: 0 }}>
          אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר
        </h1>
      </div>
      <span className="rise" style={{ animationDelay: '90ms', fontSize: '0.82rem', color: 'var(--text-faint)' }}>{right}</span>
    </div>
  )
}
