import type { CSSProperties } from 'react'
import type {
  StuckItemDetail, OpenTabDetail, ScheduledPersonDetail, MenuChangeDetail,
} from '@/lib/owner/signal-details'

// The row content behind every expandable panel on the dashboard — shared by
// StatStrip (חשבונות פתוחים / על הרצפה / פריטים תקועים / משובצים היום) and
// SignalStack (the "פריטים תקועים" and "שינויים בתפריט" alert rows expand
// into the SAME lists, not a second copy of the formatting). One file so a
// wording or styling change never has to be made twice and drift.
//
// Every list renders its own explicit empty state rather than nothing at
// all: unlike the top-level signal stack (silent when there's nothing to
// say), these only render once the owner has already tapped to open them —
// at that point "אין כרגע" is the answer to a question they just asked, not
// furniture nobody asked to see.

const T = {
  quickPurchase: 'רכישה מהירה',
  unknownWaiter: '—',
  noTabs: 'אין חשבונות פתוחים כרגע',
  noStuck: 'אין פריטים תקועים כרגע',
  noScheduled: 'אין מי שמשובץ היום',
  noMenuChanges: 'אין שינויים לא מפורסמים',
  notPickedUp: 'טרם נלקח',
  bar: 'בר',
  kitchen: 'מטבח',
  waiter: 'מלצר/ית',
  waitedMin: 'דק׳',
  added: 'נוסף',
  removed: 'הוסר',
  changed: 'עודכן',
}

function shekels(agorot: number): string {
  return `₪${Math.round(agorot / 100).toLocaleString('he-IL')}`
}

function Empty({ text }: { text: string }) {
  return <p style={emptyStyle}>{text}</p>
}

export function OpenTabsList({ rows }: { rows: OpenTabDetail[] }) {
  if (rows.length === 0) return <Empty text={T.noTabs} />
  return (
    <ul style={listStyle}>
      {rows.map((r) => (
        <li key={r.id} style={rowStyle}>
          <span style={{ ...pill, flex: '0 0 auto' }}>{r.table ?? T.quickPurchase}</span>
          <span style={{ flex: 1, minWidth: 0, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.waiterName ?? T.unknownWaiter}
          </span>
          <b style={{ flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' }}>{shekels(r.agorot)}</b>
        </li>
      ))}
    </ul>
  )
}

export function StuckItemsList({ rows }: { rows: StuckItemDetail[] }) {
  if (rows.length === 0) return <Empty text={T.noStuck} />
  return (
    <ul style={listStyle}>
      {rows.map((r) => (
        <li key={r.id} style={{ ...rowStyle, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <span style={{ ...pill, flex: '0 0 auto' }}>{r.table ?? T.quickPurchase}</span>
          <span style={{ flex: 1, minWidth: 120 }}>
            <b style={{ display: 'block', fontWeight: 700, color: 'var(--text)' }}>
              {r.qty > 1 ? `${r.qty}× ` : ''}{r.name}
            </b>
            <small style={{ display: 'block', color: 'var(--text-faint)', marginTop: 1 }}>
              {r.station === 'bar' ? T.bar : r.station === 'kitchen' ? T.kitchen : ''}
              {r.station ? ' · ' : ''}
              {r.stationStaffName ?? T.notPickedUp}
              {r.waiterName ? ` · ${T.waiter} ${r.waiterName}` : ''}
            </small>
          </span>
          <b style={{ flex: '0 0 auto', color: '#ffb240', fontVariantNumeric: 'tabular-nums' }}>
            {r.waitedMinutes} {T.waitedMin}
          </b>
        </li>
      ))}
    </ul>
  )
}

export function ScheduledTodayList({ rows }: { rows: ScheduledPersonDetail[] }) {
  if (rows.length === 0) return <Empty text={T.noScheduled} />
  return (
    <ul style={listStyle}>
      {rows.map((r, i) => (
        <li key={r.staffId ?? i} style={{ ...rowStyle, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.staffName}
          </span>
          {/* One chip per shift TODAY — a split shift or a double-role shift
              is one person, shown once, with every one of their shifts
              listed rather than turning into extra rows (see
              readScheduledTodayDetail's own comment for why). */}
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', flex: '0 0 auto' }}>
            {r.shifts.map((s, si) => (
              <span key={si} style={{ ...pill, display: 'inline-flex', gap: 4 }}>
                {s.roleName}
                <span style={{ color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{s.start}–{s.end}</span>
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}

const KIND_STYLE: Record<MenuChangeDetail['kind'], { label: string; color: string }> = {
  added: { label: T.added, color: '#4ade80' },
  removed: { label: T.removed, color: '#ff6b6b' },
  changed: { label: T.changed, color: '#ffb240' },
}

export function MenuChangesList({ rows }: { rows: MenuChangeDetail[] }) {
  if (rows.length === 0) return <Empty text={T.noMenuChanges} />
  return (
    <ul style={listStyle}>
      {rows.map((r, i) => {
        const kind = KIND_STYLE[r.kind]
        return (
          <li key={i} style={{ ...rowStyle, alignItems: 'flex-start' }}>
            <span style={{ ...pill, flex: '0 0 auto', color: kind.color, borderColor: `${kind.color}55`, background: `${kind.color}18` }}>
              {kind.label}
            </span>
            <span style={{ flex: 1, minWidth: 120 }}>
              <b style={{ display: 'block', fontWeight: 700, color: 'var(--text)' }}>{r.name}</b>
              <small style={{ display: 'block', color: 'var(--text-faint)', marginTop: 1 }}>
                {r.category}{r.note ? ` · ${r.note}` : ''}
              </small>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const listStyle: CSSProperties = {
  listStyle: 'none', margin: 0, padding: 0,
  display: 'flex', flexDirection: 'column', gap: 6,
}

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 10px', borderRadius: 10,
  background: 'var(--bg-elev-2)', border: '1px solid var(--line)',
  fontSize: '0.82rem', color: 'var(--text)',
}

const pill: CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  borderRadius: 999, padding: '2px 9px', fontSize: '0.72rem', fontWeight: 700,
  color: 'var(--text-dim)', border: '1px solid var(--line-strong)', background: 'var(--bg)',
}

const emptyStyle: CSSProperties = {
  color: 'var(--text-faint)', fontSize: '0.82rem', textAlign: 'center',
  padding: '14px 0', margin: 0,
}
