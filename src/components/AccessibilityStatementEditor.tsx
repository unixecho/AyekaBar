'use client'

import { useId, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { AccessibilityStatement } from '@/lib/settings/keys'

const T = {
  title: 'הצהרת נגישות',
  hint: 'שדות ריקים פשוט לא מוצגים בעמוד הציבורי — אין "[להשלמה]" גלוי ללקוח. כל עוד שדה חובה ריק, הוא יופיע כתזכורת בלוח המחוונים הראשי.',
  entranceAccess: 'נגישות הכניסה', entranceAccessPh: 'למשל: הכניסה מהרחוב נגישה לכיסא גלגלים, ללא מדרגות.',
  restroomAccess: 'נגישות השירותים', restroomAccessPh: 'למשל: הדלת רחבה, אין מעקה תמיכה.',
  generalNote: 'הערה כללית על בית העסק', generalNotePh: 'כל התאמה נוספת שלא מכוסה למעלה.',
  browsersTested: 'דפדפנים שנבדקו באתר', browsersTestedPh: 'למשל: Chrome, Safari — גרסאות עדכניות.',
  contactHeading: 'איש/אשת קשר לדיווח על בעיית נגישות',
  contactName: 'שם', contactPhone: 'טלפון', contactEmail: 'אימייל',
  exemptionNote: 'פטור (אם רלוונטי)', exemptionNotePh: 'להשאיר ריק אם לא חל פטור.',
  save: 'שמירה', saving: 'שומר…', saved: 'נשמר ✓',
  failed: 'השמירה נכשלה. נסה/י שוב.',
  viewPublic: 'צפייה בעמוד הציבורי ←',
}

const FIELDS: { key: keyof AccessibilityStatement; label: string; placeholder: string; area?: boolean }[] = [
  { key: 'entranceAccess', label: T.entranceAccess, placeholder: T.entranceAccessPh, area: true },
  { key: 'restroomAccess', label: T.restroomAccess, placeholder: T.restroomAccessPh, area: true },
  { key: 'generalNote', label: T.generalNote, placeholder: T.generalNotePh, area: true },
  { key: 'browsersTested', label: T.browsersTested, placeholder: T.browsersTestedPh },
]

export default function AccessibilityStatementEditor({ initial }: { initial: AccessibilityStatement }) {
  const [values, setValues] = useState<AccessibilityStatement>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  // A11y (WCAG 3.3.2 / 4.1.2): every <label> on this page was an
  // unassociated sibling of its <input>/<textarea> — no htmlFor/id
  // anywhere in the file. contactName/contactPhone/contactEmail had NO
  // fallback at all (not even a placeholder), so those three had ZERO
  // accessible name — on the exact page whose job is producing the
  // legally-required accessibility statement. Found 2026-09-04.
  const idBase = useId()

  function set(key: keyof AccessibilityStatement, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }))
    setSaved(false)
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessibilityStatement: values }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? T.failed)
      setValues(json.accessibilityStatement)
      setSaved(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : T.failed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 40 }}>
      <div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>{T.title}</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.6 }}>{T.hint}</p>
      </div>

      {FIELDS.map((f) => {
        const id = `${idBase}-${f.key}`
        return (
          <div key={f.key}>
            <label htmlFor={id} style={label}>{f.label}</label>
            {f.area ? (
              <textarea
                id={id}
                value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder} rows={2} maxLength={600} style={textarea}
              />
            ) : (
              <input
                id={id}
                value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder} maxLength={600} style={input}
              />
            )}
          </div>
        )
      })}

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' }}>{T.contactHeading}</span>
        <div>
          <label htmlFor={`${idBase}-contactName`} style={label}>{T.contactName}</label>
          <input id={`${idBase}-contactName`} value={values.contactName ?? ''} onChange={(e) => set('contactName', e.target.value)} style={input} />
        </div>
        <div>
          <label htmlFor={`${idBase}-contactPhone`} style={label}>{T.contactPhone}</label>
          <input id={`${idBase}-contactPhone`} value={values.contactPhone ?? ''} onChange={(e) => set('contactPhone', e.target.value)} dir="ltr" style={input} />
        </div>
        <div>
          <label htmlFor={`${idBase}-contactEmail`} style={label}>{T.contactEmail}</label>
          <input id={`${idBase}-contactEmail`} value={values.contactEmail ?? ''} onChange={(e) => set('contactEmail', e.target.value)} dir="ltr" style={input} />
        </div>
      </div>

      <div>
        <label htmlFor={`${idBase}-exemptionNote`} style={label}>{T.exemptionNote}</label>
        <input id={`${idBase}-exemptionNote`} value={values.exemptionNote ?? ''} onChange={(e) => set('exemptionNote', e.target.value)} placeholder={T.exemptionNotePh} style={input} />
      </div>

      {error && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={save} disabled={saving} className="press" style={{ ...primary, opacity: saving ? 0.6 : 1 }}>
          {saving ? T.saving : saved ? T.saved : T.save}
        </button>
        <a href="/accessibility" target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.82rem', color: 'var(--text-faint)' }}>
          {T.viewPublic}
        </a>
      </div>
    </div>
  )
}

const label: CSSProperties = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 5 }
const input: CSSProperties = {
  width: '100%', padding: '11px 13px', borderRadius: 11,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
  color: 'var(--text)', fontSize: '0.92rem', fontFamily: 'inherit',
}
const textarea: CSSProperties = { ...input, resize: 'vertical', lineHeight: 1.5 }
const primary: CSSProperties = {
  padding: '12px 22px', borderRadius: 12, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
  color: 'var(--bg)', fontWeight: 700, fontSize: '0.92rem', fontFamily: 'inherit', cursor: 'pointer',
}
