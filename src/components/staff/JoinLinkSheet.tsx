'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import SheetShell from '@/components/cart/SheetShell'
import { haptic } from '@/lib/haptics'
import { expiryLabel, shareLinks, shareText } from '@/lib/staff/join'

// The owner's "here is the link" sheet (2026-10-14), shown the moment a join link is generated.
//
// The link is shown ONCE. Only its hash is stored (migration 059), so there is nothing to look up later — a lost
// message means generating a new link, which retires this one. The sheet says so plainly, because the alternative
// (the owner closing it and expecting to find the link on the roster) is the one way this flow can disappoint.
//
// Sharing is deliberately boring: copy, SMS, and the phone's own share sheet when it has one (that is how it reaches
// WhatsApp — a dedicated WhatsApp button was removed 2026-10-15, it did not work). The message text is built in lib/staff/join.ts so it is tested, not improvised here.

export interface JoinLinkShown {
  name: string
  firstName: string | null
  url: string
  expiresAt: string
}

export default function JoinLinkSheet({ link, onClose }: { link: JoinLinkShown | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [canShare, setCanShare] = useState(false)

  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function') }, [])
  useEffect(() => { setCopied(false) }, [link?.url])

  if (!link) return null
  const text = shareText(link.firstName, link.url)
  const links = shareLinks(text)

  async function copy() {
    haptic('select')
    try {
      await navigator.clipboard.writeText(link!.url)
      setCopied(true)
    } catch {
      // No clipboard permission (an embedded browser, an old WebView): select the text so a long-press copies it.
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  async function share() {
    haptic('select')
    // `text` already ends with the link. Passing `url` as well made WhatsApp (and others) print it twice.
    try { await navigator.share({ title: 'הצטרפות לצוות אייכה בר', text }) } catch { /* cancelled */ }
  }

  return (
    <SheetShell
      open onClose={onClose} dir="rtl" label={`קישור הצטרפות — ${link.name}`}
      footer={<button type="button" className="press" onClick={onClose} style={{ ...ghost, marginTop: 12 }}>סגירה</button>}
    >
      <div className="sheet-scroll" style={{ textAlign: 'start' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)' }}>קישור הצטרפות ל{link.name}</h2>
        <p style={{ margin: '2px 0 6px', fontSize: '0.84rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
          שלחו את הקישור ל{link.firstName ?? 'איש/אשת הצוות'}. בלחיצה על הקישור מתחברים עם חשבון Google, מאשרים את החשבון, ורואים את הסידור.
        </p>

        <label htmlFor="join-url" style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-faint)' }}>הקישור</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="join-url" ref={inputRef} readOnly dir="ltr" value={link.url}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              flex: 1, minWidth: 0, padding: '11px 12px', borderRadius: 11, border: '1px solid var(--line-strong)',
              background: 'var(--bg)', color: 'var(--text)', fontSize: '0.82rem', fontFamily: 'monospace', textAlign: 'start',
            }}
          />
          <button type="button" className="press" onClick={copy} style={{ ...primary, flex: '0 0 auto', padding: '0 16px' }}>
            {copied ? 'הועתק ✓' : 'העתקה'}
          </button>
        </div>
        <p role="status" aria-live="polite" style={{ margin: 0, minHeight: '1.1em', fontSize: '0.78rem', color: 'var(--neon-soft)' }}>
          {copied ? 'הקישור הועתק — אפשר להדביק בהודעה.' : ''}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          <a className="press" href={links.sms} style={{ ...ghost, ...anchor }}>✉️ הודעה</a>
          {canShare && <button type="button" className="press" onClick={share} style={ghost}>⤴︎ שיתוף</button>}
        </div>

        <ul style={{ margin: '6px 0 0', paddingInlineStart: 18, fontSize: '0.78rem', color: 'var(--text-faint)', lineHeight: 1.7 }}>
          <li>הקישור פעיל עד {expiryLabel(link.expiresAt)} ונשרף אחרי שימוש אחד.</li>
          <li>הקישור מוצג רק עכשיו. אם הוא אבד — צרו קישור חדש, והקודם יפסיק לעבוד.</li>
          <li>הקישור מחבר רק את הכרטיס הזה, וגם אז לא נותן הרשאות ניהול.</li>
        </ul>
      </div>
    </SheetShell>
  )
}

const ghost: CSSProperties = {
  minHeight: 46, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const anchor: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }
const primary: CSSProperties = {
  minHeight: 46, borderRadius: 11, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', color: 'var(--bg)',
  fontSize: '0.9rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
}
