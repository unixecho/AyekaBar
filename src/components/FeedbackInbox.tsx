'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { haptic } from '@/lib/haptics'
import { normalizePagePath } from '@/lib/feedback/validate'
import type { FeedbackCategory, FeedbackRow, FeedbackStatus } from '@/lib/feedback/types'

// The owner's feedback queue (PLAN_CUSTOMER_FEEDBACK.md §5): "a simple list,
// filterable by category, each row markable read/resolved."
//
// Modelled on AuditLog.tsx — a read-mostly list on an OP-only page — with one
// difference that matters: every word of content here was typed by a stranger.
// So:
//   • The message is rendered as React TEXT (`white-space: pre-wrap`), never
//     as HTML. There is no dangerouslySetInnerHTML in this file and there
//     must never be one.
//   • The page link is re-normalised through the SAME function the API used
//     (normalizePagePath) immediately before it is turned into an <a>. It is
//     already guaranteed by the route's validator and again by migration
//     050's CHECK, and it is checked a third time here anyway, because this
//     is the one place where being wrong turns into the owner clicking an
//     attacker's destination from inside their own admin panel. Three cheap
//     copies of one rule beats one clever one.
//   • The contact address becomes a `mailto:` — safe because the validator's
//     own pattern excludes whitespace, quotes and the separators a mail
//     header injection would need.

const T = {
  title: 'משוב מלקוחות',
  subtitle: 'מה לקוחות כתבו לנו מהפורטל — על הבר ועל האתר.',
  boxOpen: 'תיבת המשוב פתוחה',
  boxClosed: 'תיבת המשוב סגורה',
  boxHint: 'כשהתיבה סגורה, הכפתור נעלם מהפורטל וגם שליחה ישירה נדחית.',
  all: 'הכל',
  new: 'חדשים',
  read: 'נקראו',
  resolved: 'טופלו',
  business: 'על הבר',
  technical: 'על האתר',
  empty: 'אין כאן משובים.',
  emptyFiltered: 'אין משובים בסינון הזה.',
  loadErr: 'טעינת המשובים נכשלה.',
  saveErr: 'העדכון נכשל.',
  pending: 'הרשימה תתחיל להתמלא אחרי הרצת מיגרציה 050.',
  more: 'טעינת עוד',
  loading: 'טוען…',
  markRead: 'סימון כנקרא',
  markResolved: 'סימון כטופל',
  reopen: 'החזרה לחדשים',
  onPage: 'נשלח מהעמוד',
  reply: 'מענה במייל',
  member: 'חבר/ת מועדון',
  resolvedAt: 'טופל',
}

const PAGE = 30

const CATEGORY_META: Record<FeedbackCategory, { label: string; emoji: string; color: string }> = {
  business:  { label: T.business,  emoji: '🍸', color: '#ff8a5c' },
  technical: { label: T.technical, emoji: '🛠️', color: '#38e1ff' },
}

const STATUS_META: Record<FeedbackStatus, { label: string; color: string }> = {
  new:      { label: T.new,      color: '#ffb240' },
  read:     { label: T.read,     color: '#a8a5b0' },
  resolved: { label: T.resolved, color: '#4ade80' },
}

function when(iso: string): string {
  const d = new Date(iso)
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} דק׳`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `לפני ${hours} שע׳`
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
}

type StatusFilter = FeedbackStatus | 'all'
type CategoryFilter = FeedbackCategory | 'all'

export default function FeedbackInbox() {
  const [items, setItems] = useState<FeedbackRow[]>([])
  const [counts, setCounts] = useState<Record<FeedbackStatus, number>>({ new: 0, read: 0, resolved: 0 })
  const [total, setTotal] = useState(0)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [status, setStatus] = useState<StatusFilter>('new')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async (offset = 0) => {
    setLoading(true)
    setErr(null)
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
      if (status !== 'all') params.set('status', status)
      if (category !== 'all') params.set('category', category)
      const res = await fetch(`/api/owner/feedback?${params}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? T.loadErr)
      // Appending vs. replacing is decided by the offset, not by a separate
      // "loading more" flag — one source of truth for which request this is.
      setItems((prev) => (offset === 0 ? json.items : [...prev, ...json.items]))
      setCounts(json.counts)
      setTotal(json.total)
      setEnabled(json.enabled === true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : T.loadErr)
    } finally {
      setLoading(false)
    }
  }, [status, category])

  useEffect(() => { void load(0) }, [load])

  async function setRowStatus(row: FeedbackRow, next: FeedbackStatus) {
    haptic()
    setBusyId(row.id)
    setErr(null)
    try {
      const res = await fetch('/api/owner/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, status: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? T.saveErr)
      // Re-read rather than patching in place: the row may no longer belong in
      // the current filter (marking the last "new" one read empties the tab),
      // and the three counts above have all moved.
      await load(0)
    } catch (e) {
      setErr(e instanceof Error ? e.message : T.saveErr)
    } finally {
      setBusyId(null)
    }
  }

  async function toggleBox() {
    if (enabled === null) return
    const next = !enabled
    haptic()
    setEnabled(next) // optimistic — a switch must feel instant
    try {
      const res = await fetch('/api/owner/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? T.saveErr)
      setEnabled(json.enabled === true)
    } catch (e) {
      setEnabled(!next) // roll back
      setErr(e instanceof Error ? e.message : T.saveErr)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)' }}>{T.title}</h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.83rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
          {T.subtitle}
        </p>
      </div>

      {/* The box's own on/off. Sits at the top of the page it governs rather
          than in a settings screen: the moment somebody wants this switch is
          the moment they are staring at the thing it turns off. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--bg-elev)', border: '1px solid var(--line)',
        borderRadius: 14, padding: '12px 14px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' }}>
            {enabled === false ? T.boxClosed : T.boxOpen}
          </div>
          <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
            {T.boxHint}
          </p>
        </div>
        <button
          type="button" role="switch"
          aria-checked={enabled === true}
          aria-label={T.boxOpen}
          onClick={toggleBox}
          disabled={enabled === null}
          className="press"
          style={{
            flex: '0 0 auto', width: 52, height: 30, borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${enabled ? 'transparent' : 'var(--line-strong)'}`,
            background: enabled
              ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))'
              : 'var(--bg-elev-2)',
            // ltr so the knob starts at the physical left in Hebrew too —
            // translateX is not direction-aware.
            direction: 'ltr', padding: 3, display: 'flex', alignItems: 'center',
            opacity: enabled === null ? 0.6 : 1,
            transition: 'background .3s var(--ease), opacity .2s var(--ease)',
          }}
        >
          <span aria-hidden style={{
            width: 22, height: 22, borderRadius: 999, background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
            transform: `translateX(${enabled ? 22 : 0}px)`,
            transition: 'transform .28s var(--ease)',
          }} />
        </button>
      </div>

      {/* Filters. Status first — it is the one that decides what work is left
          — with its live count on the chip, so the tab labels and the list
          can never disagree. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['new', 'read', 'resolved', 'all'] as StatusFilter[]).map((s) => (
          <button
            key={s} type="button" className="press"
            onClick={() => { setStatus(s); setItems([]) }}
            style={chip(status === s, s === 'all' ? undefined : STATUS_META[s].color)}
          >
            {s === 'all' ? T.all : STATUS_META[s].label}
            {s !== 'all' && (
              <span style={{ marginInlineStart: 6, fontVariantNumeric: 'tabular-nums', opacity: 0.75 }}>
                {counts[s]}
              </span>
            )}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: -6 }}>
        {(['all', 'business', 'technical'] as CategoryFilter[]).map((c) => (
          <button
            key={c} type="button" className="press"
            onClick={() => { setCategory(c); setItems([]) }}
            style={chip(category === c, c === 'all' ? undefined : CATEGORY_META[c].color)}
          >
            {c === 'all' ? T.all : `${CATEGORY_META[c].emoji} ${CATEGORY_META[c].label}`}
          </button>
        ))}
      </div>

      {err && (
        <p role="alert" style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: 0, lineHeight: 1.5 }}>
          {err}
          <br />
          <span style={{ color: 'var(--text-faint)' }}>{T.pending}</span>
        </p>
      )}

      {items.length === 0 && !loading && !err && (
        <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', margin: '6px 0' }}>
          {status === 'all' && category === 'all' ? T.empty : T.emptyFiltered}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((row, i) => (
          <FeedbackCard
            key={row.id}
            row={row}
            busy={busyId === row.id}
            // Same staggered reveal the customer's sheet uses, capped at six
            // steps: a full page of 30 rows would otherwise take two seconds
            // to finish arriving, which stops reading as motion and starts
            // reading as a slow page.
            delay={Math.min(i, 6) * 45}
            onSetStatus={(next) => setRowStatus(row, next)}
          />
        ))}
      </div>

      {loading && (
        <p style={{ color: 'var(--text-faint)', fontSize: '0.82rem', margin: 0 }}>{T.loading}</p>
      )}

      {items.length > 0 && items.length < total && !loading && (
        <button type="button" className="press" onClick={() => load(items.length)} style={moreBtn}>
          {T.more}
        </button>
      )}
    </div>
  )
}

function FeedbackCard({ row, busy, delay, onSetStatus }: {
  row: FeedbackRow
  busy: boolean
  delay: number
  onSetStatus: (next: FeedbackStatus) => void
}) {
  const cat = CATEGORY_META[row.category] ?? CATEGORY_META.business
  const st = STATUS_META[row.status] ?? STATUS_META.new
  // Third and final check — see this file's header for why it is here and not
  // merely on the server.
  const path = normalizePagePath(row.page_url)

  return (
    <article className="fb-step" style={{
      background: 'var(--bg-elev)',
      border: '1px solid var(--line)',
      borderInlineStartWidth: 3,
      borderInlineStartStyle: 'solid',
      borderInlineStartColor: row.status === 'new' ? st.color : 'var(--line-strong)',
      borderRadius: 14, padding: '12px 13px',
      opacity: busy ? 0.55 : 1,
      // The status stripe fades between colours rather than cutting, so
      // marking a row read reads as the row changing rather than the list
      // repainting under the owner's thumb.
      transition: 'opacity .2s var(--ease), border-inline-start-color .3s var(--ease)',
      animationDelay: `${delay}ms`,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{
          ...pill, color: cat.color, borderColor: `${cat.color}55`, background: `${cat.color}18`,
        }}>
          <span aria-hidden>{cat.emoji}</span> {cat.label}
        </span>
        <span style={{ ...pill, color: st.color, borderColor: `${st.color}44` }}>{st.label}</span>
        {row.customer_id && <span style={pill}>{T.member}</span>}
        <span style={{ marginInlineStart: 'auto', fontSize: '0.74rem', color: 'var(--text-faint)' }}>
          {when(row.created_at)}
        </span>
      </header>

      {/* pre-wrap keeps the customer's own line breaks. React escapes the
          text — this is deliberately not HTML and must never become it. */}
      <p style={{
        margin: 0, fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.6,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {row.message}
      </p>

      {(path || row.contact_email) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 9, fontSize: '0.76rem' }}>
          {path && (
            <span style={{ color: 'var(--text-faint)' }}>
              {T.onPage}{' '}
              {/* A plain <a>, not next/link: this is a diagnostic jump out of
                  the admin panel, and a full navigation is the honest thing
                  for "show me what they saw". */}
              <a href={path} style={{ color: 'var(--neon-soft)', textDecoration: 'underline' }}>{path}</a>
            </span>
          )}
          {row.contact_email && (
            <a href={`mailto:${row.contact_email}`} style={{ color: 'var(--neon-2)', textDecoration: 'underline' }}>
              {T.reply}: {row.contact_email}
            </a>
          )}
        </div>
      )}

      <footer style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
        {row.status !== 'read' && row.status !== 'resolved' && (
          <button type="button" className="press" disabled={busy} onClick={() => onSetStatus('read')} style={actionBtn}>
            {T.markRead}
          </button>
        )}
        {row.status !== 'resolved' && (
          <button type="button" className="press" disabled={busy} onClick={() => onSetStatus('resolved')} style={{ ...actionBtn, color: '#4ade80', borderColor: 'rgba(74,222,128,0.35)' }}>
            {T.markResolved}
          </button>
        )}
        {row.status !== 'new' && (
          <button type="button" className="press" disabled={busy} onClick={() => onSetStatus('new')} style={{ ...actionBtn, color: 'var(--text-faint)' }}>
            {T.reopen}
          </button>
        )}
        {row.status === 'resolved' && row.resolved_at && (
          <span style={{ marginInlineStart: 'auto', alignSelf: 'center', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
            {T.resolvedAt} {when(row.resolved_at)}
          </span>
        )}
      </footer>
    </article>
  )
}

function chip(active: boolean, color?: string): CSSProperties {
  const tint = color ?? 'var(--neon-soft)'
  return {
    borderRadius: 999, padding: '6px 12px', fontSize: '0.78rem', fontWeight: 700,
    fontFamily: 'inherit', cursor: 'pointer',
    color: active ? tint : 'var(--text-dim)',
    background: active ? `${color ?? 'rgba(255,138,92,1)'}1a` : 'var(--bg-elev)',
    border: `1px solid ${active ? `${color ?? 'rgba(255,138,92,1)'}55` : 'var(--line)'}`,
    transition: 'color .2s var(--ease), background .2s var(--ease), border-color .2s var(--ease)',
  }
}

const pill: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-dim)',
  background: 'var(--bg-elev-2)', border: '1px solid var(--line)',
  borderRadius: 999, padding: '2px 9px',
}

const actionBtn: CSSProperties = {
  fontSize: '0.76rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
  color: 'var(--neon-soft)', background: 'transparent',
  border: '1px solid rgba(255,138,92,0.3)', borderRadius: 9, padding: '6px 10px',
}

const moreBtn: CSSProperties = {
  width: '100%', padding: '12px 0', borderRadius: 13,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
  color: 'var(--text)', fontSize: '0.9rem', fontWeight: 700,
  fontFamily: 'inherit', cursor: 'pointer',
}
