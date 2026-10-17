'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import LanguageSwitch, { useLanguage, type Lang } from '@/components/LanguageSwitch'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { COOKIES_COPY as T } from '@/lib/privacy/copy'
import {
  PRIVACY_PAGE_UPDATED, itemsByCategory, staffItems, type StorageItem,
} from '@/lib/privacy/registry'
import { clearDeviceStorage, cleanupLegacy } from '@/lib/privacy/housekeeping'
import { acknowledgeNotice, browserEnv } from '@/lib/privacy/browser'

// The /cookies page: what this site keeps on a visitor's device, why, for how
// long, how it is stored — and the button that deletes it.
//
// Everything on it is GENERATED from lib/privacy/registry.ts (the inventory) and
// lib/privacy/copy.ts (the words), never retyped here, because a notice that is
// maintained separately from the code it describes is a notice that goes stale.
// scripts/check-privacy.mjs holds the code to what these two files say.
//
// A client component because the language is the visitor's own choice, kept in
// the browser (the portal and the menu work the same way); the server page only
// passes down which languages the owner offers. Hebrew is the authoritative text.
//
// Scope, deliberately narrow: this is the page about ON-DEVICE storage and cookies
// — not the privacy policy for personal data held on the server (the loyalty
// club, the feedback box). That is a separate document and needs facts only the
// owner has (HANDOFF owner inputs); nothing here pretends to be it.

export default function CookiesView({ languages }: { languages?: Lang[] }) {
  const [lang, setLang] = useLanguage(languages)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [done, setDone] = useState(false)

  // Opening this page IS having seen the notice, so the one-time card is not
  // shown again on the way back. It is recorded here, not by an onClick on the
  // notice's "Details" link: PageTransitions swallows link clicks before React
  // sees them (see StorageNotice's header). Covers the footer link too.
  useEffect(() => { acknowledgeNotice() }, [])

  const askDelete = () => setConfirm({
    title: T.deleteConfirmTitle[lang],
    body: T.deleteConfirmBody[lang],
    confirmLabel: T.deleteConfirmLabel[lang],
    cancelLabel: T.deleteCancel[lang],
    onConfirm: () => {
      const env = browserEnv()
      clearDeviceStorage(env)
      cleanupLegacy(env)      // the old overlay's cookie, which storage.clear() cannot reach
      setDone(true)
      // Reload so the accessibility widget, the language and the cart all start
      // from what is now (not) stored, instead of from what is still in memory.
      window.setTimeout(() => window.location.reload(), 1200)
    },
  })

  const groups: { key: 'necessary' | 'functional' | 'staff'; items: StorageItem[] }[] = [
    { key: 'necessary', items: itemsByCategory('necessary') },
    { key: 'functional', items: itemsByCategory('functional') },
    { key: 'staff', items: staffItems() },
  ]

  return (
    <main
      id="main" tabIndex={-1} lang={lang}
      style={{
        minHeight: '100dvh', position: 'relative',
        padding: 'calc(env(safe-area-inset-top) + 68px) 20px calc(env(safe-area-inset-bottom) + 60px)',
      }}
    >
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />
      <LanguageSwitch lang={lang} onChange={setLang} languages={languages} />

      <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative' }}>
        <Link href="/" style={backLink}>
          <svg className="dir-flip" viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {T.back[lang]}
        </Link>

        <h1 style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--text)', margin: '14px 0 6px', lineHeight: 1.25 }}>
          {T.title[lang]}
        </h1>
        <p style={{ margin: '0 0 6px', color: 'var(--text-dim)', fontSize: '0.98rem', lineHeight: 1.6 }}>{T.lead[lang]}</p>
        <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', margin: '0 0 28px' }}>
          {T.updated[lang]} <time dateTime={PRIVACY_PAGE_UPDATED}>{PRIVACY_PAGE_UPDATED}</time>
        </p>

        <Section title={T.shortTitle[lang]}>
          <ul style={listStyle}>
            {T.short.map((s, i) => <li key={i}>{s[lang]}</li>)}
          </ul>
        </Section>

        <Section title={T.storedTitle[lang]}>
          <p style={{ margin: '0 0 16px' }}>{T.storedIntro[lang]}</p>

          {groups.map(({ key, items }) => items.length > 0 && (
            <div key={key} style={{ marginBottom: 22 }}>
              <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 2px' }}>
                {T.groups[key].title[lang]}
              </h3>
              <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--text-faint)' }}>
                {T.groups[key].note[lang]}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((item) => <ItemCard key={item.id} item={item} lang={lang} />)}
              </div>
            </div>
          ))}

          <p style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text)' }}>{T.noneLine[lang]}</p>
          <p style={small}>{T.cacheNote[lang]}</p>
          <p style={small}>{T.legacyNote[lang]}</p>
        </Section>

        <Section title={T.countingTitle[lang]}>
          <p style={{ margin: '0 0 8px' }}>{T.countingIntro[lang]}</p>
          <ul style={listStyle}>
            {T.counting.map((s, i) => <li key={i}>{s[lang]}</li>)}
          </ul>
        </Section>

        <Section title={T.othersTitle[lang]}>
          <p style={{ margin: '0 0 8px' }}>{T.othersIntro[lang]}</p>
          <ul style={listStyle}>
            {T.others.map((o) => (
              <li key={o.name}><b style={{ color: 'var(--text)' }}>{o.name}</b> — {o.text[lang]}</li>
            ))}
          </ul>
          {T.othersNotes.map((n, i) => <p key={i} style={{ margin: '10px 0 0' }}>{n[lang]}</p>)}
        </Section>

        <Section title={T.deleteTitle[lang]}>
          <p style={{ margin: '0 0 14px' }}>{T.deleteBody[lang]}</p>
          <button type="button" className="press" onClick={askDelete} style={deleteBtn}>
            {T.deleteButton[lang]}
          </button>
          {/* A live region that exists first and is then filled in — announced
              reliably by screen readers, unlike one inserted with its text. */}
          <p role="status" style={{ margin: '12px 0 0', minHeight: '1.4em', color: 'var(--neon-soft)', fontWeight: 700 }}>
            {done ? T.deleteDone[lang] : ''}
          </p>
          <p style={{ margin: '10px 0 0' }}>{T.cookiesNote[lang]}</p>
          <p style={{ margin: '6px 0 0' }}>{T.browserNote[lang]}</p>
        </Section>
      </div>

      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </main>
  )
}

function ItemCard({ item, lang }: { item: StorageItem; lang: Lang }) {
  return (
    <article style={card}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, minWidth: 0 }}>
          <code dir="ltr" style={codeStyle}>{item.name}</code>
        </h4>
        <span style={chip}>{T.kindName[item.kind][lang]}</span>
      </header>
      <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Row label={T.labels.what[lang]}>{item.what[lang]}</Row>
        <Row label={T.labels.why[lang]}>{item.why[lang]}</Row>
        <Row label={T.labels.when[lang]}>{item.when[lang]}</Row>
        <Row label={T.labels.keeps[lang]}>{item.keeps[lang]}</Row>
        <Row label={T.labels.how[lang]}>
          {T.kindHow[item.kind][lang]}
          {item.attributes && (
            <code dir="ltr" style={{ ...codeStyle, display: 'block', marginTop: 4, fontSize: '0.76rem', color: 'var(--text-faint)' }}>
              {item.attributes}
            </code>
          )}
        </Row>
        <Row label={T.labels.who[lang]}>{T.audience[item.audience][lang]}</Row>
      </dl>
    </article>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-faint)', marginBottom: 1 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 10px' }}>{title}</h2>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.93rem', lineHeight: 1.75 }}>{children}</div>
    </section>
  )
}

const listStyle: CSSProperties = { margin: 0, paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 6 }
const small: CSSProperties = { margin: '8px 0 0', fontSize: '0.84rem', color: 'var(--text-faint)', lineHeight: 1.65 }

const backLink: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44,
  color: 'var(--text-faint)', fontSize: '0.88rem', textDecoration: 'none',
}

const card: CSSProperties = {
  background: 'var(--bg-elev)', border: '1px solid var(--line-strong)', borderRadius: 14, padding: '14px 14px 12px',
}

// A long cookie name must wrap inside a 280px-wide screen, not push the page sideways.
const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.82rem',
  color: 'var(--neon-2)', overflowWrap: 'anywhere', unicodeBidi: 'isolate',
}

const chip: CSSProperties = {
  fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-dim)', padding: '2px 9px',
  border: '1px solid var(--line-interactive)', borderRadius: 999, whiteSpace: 'nowrap',
}

// Solid background, so the label's contrast does not depend on the photo behind the page.
const deleteBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44,
  background: 'var(--bg-elev-2)', color: '#ff6b6b', border: '1px solid rgba(255,107,107,0.5)',
  borderRadius: 12, padding: '0 18px', font: 'inherit', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
}
