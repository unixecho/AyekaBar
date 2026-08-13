'use client'

import { useState } from 'react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { AUDIT_LABELS } from '@/lib/shifts/i18n'

// The change log. Same shape and same discipline as the existing menu audit
// (migration 014 + components/AuditLog.tsx): append-only, actor snapshotted at
// write time, and a payload diff you can open when the one-line summary is not
// enough.
//
// The diff is collapsed by default. A log where every entry is expanded is a
// wall nobody reads, and the summary answers the question 95% of the time —
// "who put Dana on Friday and when" rather than "what were the seventeen
// fields of that row".

export default function AuditTrail() {
  const { db, t, tri, lang } = useShifts()
  const [open, setOpen] = useState<string | null>(null)

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
        const hasDiff = Object.keys(entry.diff ?? {}).length > 0

        return (
          <div key={entry.id} className="sh-panel" style={{ padding: '11px 13px' }}>
            <button
              type="button"
              onClick={() => hasDiff && setOpen(expanded ? null : entry.id)}
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
              <pre style={{
                margin: '10px 0 0', padding: 10, borderRadius: 10, direction: 'ltr',
                background: 'var(--bg)', border: '1px solid var(--line)',
                fontSize: '0.68rem', lineHeight: 1.5, color: 'var(--text-dim)',
                overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {JSON.stringify(entry.diff, null, 2)}
              </pre>
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
