'use client'

import { useCallback, useMemo, useState } from 'react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { AUDIT_LABELS } from '@/lib/shifts/i18n'
import { auditRows, type AuditLookup } from '@/lib/shifts/audit-view'

// The change log. Same shape and same discipline as the existing menu audit
// (migration 014 + components/AuditLog.tsx): append-only, actor snapshotted at
// write time, and a payload diff you can open when the one-line summary is not
// enough.
//
// The diff is collapsed by default. A log where every entry is expanded is a
// wall nobody reads, and the summary answers the question 95% of the time —
// "who put Dana on Friday and when" rather than "what were the seventeen
// fields of that row".
//
// WHAT THE EXPANDED DIFF SHOWS CHANGED 2026-08-29. It used to be
// `JSON.stringify(diff, null, 2)` — never a decision, just the honest
// placeholder until a real renderer existed. It now reads as field rows with
// old and new values, ids resolved to the names the owner knows things by (see
// audit-view.ts). The raw JSON is still one tap away, because a log is a
// record and a record you cannot inspect literally is a summary.

export default function AuditTrail() {
  const { db, t, tri, lang } = useShifts()
  const [open, setOpen] = useState<string | null>(null)
  const [raw, setRaw] = useState<string | null>(null)

  // Built once per db, not once per entry: an eighty-line log resolving ids
  // through three `.find()` calls each is the kind of thing that only shows up
  // on the owner's phone.
  const lookup = useMemo<AuditLookup>(() => {
    const staff = new Map(db.staff.map((s) => [s.id, s.name]))
    const roles = new Map(db.settings.roles.map((r) => [r.id, tri(r.name)]))
    const stations = new Map(db.settings.stations.map((s) => [s.id, `${s.emoji} ${tri(s.name)}`]))
    const presets = new Map(db.settings.presets.map((p) => [p.id, tri(p.name)]))
    return {
      lang, tri,
      staffName: (id) => staff.get(id) ?? null,
      roleName: (id) => roles.get(id) ?? null,
      stationName: (id) => stations.get(id) ?? null,
      presetName: (id) => presets.get(id) ?? null,
    }
  }, [db.staff, db.settings, lang, tri])

  const toggle = useCallback((id: string) => {
    setOpen((prev) => (prev === id ? null : id))
    setRaw(null)
  }, [])

  if (!db.audit.length) {
    return (
      <div className="sh-panel" style={{ textAlign: 'center', padding: '28px 16px' }}>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-dim)' }}>{t('noAudit')}</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {db.audit.map((entry) => {
        const label = AUDIT_LABELS[entry.action]
        const expanded = open === entry.id
        const rows = expanded ? auditRows(entry, lookup) : []
        const hasDiff = Object.keys(entry.diff ?? {}).length > 0

        return (
          <div key={entry.id} className="sh-panel" style={{ padding: '11px 13px' }}>
            <button
              type="button"
              onClick={() => hasDiff && toggle(entry.id)}
              aria-expanded={hasDiff ? expanded : undefined}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
                background: 'none', border: 'none', padding: 0, font: 'inherit',
                textAlign: 'start', color: 'var(--text)',
                cursor: hasDiff ? 'pointer' : 'default',
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                  fontSize: '0.68rem', fontWeight: 700, marginBottom: 5,
                  background: 'rgba(255,94,58,0.12)', color: 'var(--neon-soft)',
                }}>
                  {label ? tri(label) : entry.action}
                </span>
                <span style={{ display: 'block', fontSize: '0.85rem', lineHeight: 1.5 }}>
                  {entry.summary}
                </span>
                <span style={{ display: 'block', marginTop: 4, fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                  {[entry.actorName, formatWhen(entry.at, lang)].filter(Boolean).join(' · ')}
                </span>
              </span>
              {hasDiff && (
                <span aria-hidden style={{ opacity: 0.5, fontSize: '0.75rem', paddingTop: 4 }}>
                  {expanded ? '▲' : '▼'}
                </span>
              )}
            </button>

            {expanded && (
              <div style={{ marginTop: 10 }}>
                {rows.length ? (
                  <dl className="sh-diff">
                    {rows.map((row, i) => (
                      <div key={`${row.label}-${i}`} className="sh-diff-row">
                        <dt>{row.label}</dt>
                        <dd>
                          {/* A change reads left-to-right regardless of the
                              page's direction — old, arrow, new — because the
                              arrow means "became", not "next". `dir-flip`
                              mirrors the glyph so it still points at the new
                              value in Hebrew and Arabic. */}
                          {row.before !== undefined && (
                            <>
                              <span className="sh-diff-old">{row.before}</span>
                              {row.after !== undefined && (
                                <span aria-hidden className="sh-diff-arrow dir-flip">→</span>
                              )}
                            </>
                          )}
                          {row.after !== undefined && <span className="sh-diff-new">{row.after}</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="sh-sub" style={{ margin: 0 }}>{t('auditNoDetail')}</p>
                )}

                <button
                  type="button"
                  onClick={() => setRaw(raw === entry.id ? null : entry.id)}
                  className="sh-diff-raw-toggle"
                >
                  {raw === entry.id ? '▲' : '▼'} {t('auditRaw')}
                </button>

                {raw === entry.id && (
                  <pre className="sh-diff-raw">{JSON.stringify(entry.diff, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Locale-formatted, but never crashing on a malformed stamp — a log entry
 *  that throws while rendering takes the whole tab down with it. */
function formatWhen(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : lang === 'ar' ? 'ar' : 'en-GB', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
