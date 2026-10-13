import Link from 'next/link'
import type { Section, Tile } from '@/lib/dashboard/tiles'

// The category-grouped tile grid shared by the staff, owner and developer
// dashboards (registry: lib/dashboard/tiles.ts). Presentational and
// server-renderable — no state, no effects.
//
// Each category is a real <section> with its own <h2>, so a screen-reader user
// can jump between "my work", "operations", "content"… instead of tabbing
// through twenty identical-looking links. (The dashboards are outside the
// customer-facing accessibility widget now — see components/A11yGate.tsx — so
// the page itself has to carry the structure.)

/** Why a tile is switched off right now, keyed by tile id. A locked tile is
 *  shown — so people know it exists and what it will become — but cannot be
 *  opened. */
export type LockedTiles = Record<string, string>

// flex: 1 — the tile fills its grid cell, so a row stays level whether or not
// one of its tiles carries a hint line.
const tileBase: React.CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 5, padding: '14px 8px', minHeight: 92, borderRadius: 14,
  border: '1px solid var(--line)', background: 'var(--bg-elev)',
  color: 'var(--text)', textDecoration: 'none', textAlign: 'center',
}

function TileBody({ tile, chip }: { tile: Tile; chip?: string }) {
  return (
    <>
      <span aria-hidden style={{ fontSize: '1.35rem', lineHeight: 1 }}>{tile.icon}</span>
      <span style={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.25 }}>{tile.he}</span>
      {tile.hint && !chip && (
        <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)', lineHeight: 1.3 }}>{tile.hint}</span>
      )}
      {chip && (
        <span style={{
          fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-dim)',
          border: '1px dashed var(--line-strong)', borderRadius: 999, padding: '1px 8px',
        }}>{chip}</span>
      )}
    </>
  )
}

function TileView({ tile, lockedReason }: { tile: Tile; lockedReason?: string }) {
  if (lockedReason) {
    // Not a link: there is nowhere to go. aria-disabled keeps it in the reading
    // order so the reason is announced, rather than hiding the tile from AT.
    return (
      <div aria-disabled="true" style={{ ...tileBase, borderStyle: 'dashed', borderColor: 'var(--line-strong)', opacity: 0.8 }}>
        <TileBody tile={tile} chip={lockedReason} />
      </div>
    )
  }
  if (tile.external) {
    return (
      <a
        href={tile.href} className="press" style={tileBase}
        {...(tile.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : { rel: 'noopener' })}
      >
        <TileBody tile={tile} />
      </a>
    )
  }
  return (
    <Link href={tile.href} className="press" style={tileBase}>
      <TileBody tile={tile} />
    </Link>
  )
}

export default function DashboardSections({
  sections, locked = {}, baseDelay = 120,
}: {
  sections: Section[]
  locked?: LockedTiles
  /** Animation delay of the first section, ms. */
  baseDelay?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {sections.map(({ category, tiles }, i) => (
        <section
          key={category.id}
          aria-labelledby={`cat-${category.id}`}
          className="rise"
          style={{ animationDelay: `${baseDelay + Math.min(i, 6) * 45}ms` }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 2px 9px', flexWrap: 'wrap' }}>
            <span aria-hidden style={{ fontSize: '1rem' }}>{category.icon}</span>
            <h2 id={`cat-${category.id}`} style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
              {category.he}
            </h2>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{category.hint}</span>
          </div>
          <ul style={{
            listStyle: 'none', margin: 0, padding: 0,
            display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10,
          }}>
            {tiles.map((t) => (
              <li key={t.id} style={{ display: 'flex' }}>
                <TileView tile={t} lockedReason={locked[t.id]} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
