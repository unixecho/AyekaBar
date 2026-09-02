'use client'

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import SheetShell from '@/components/cart/SheetShell'
import { haptic } from '@/lib/haptics'
import type { Lang } from '@/lib/menu/types'
import { FEEDBACK_UI, feedbackErrorText } from '@/lib/feedback/i18n'
import {
  FEEDBACK_CATEGORIES, MAX_EMAIL_LEN, MAX_MESSAGE_LEN, MIN_MESSAGE_LEN,
  type FeedbackCategory,
} from '@/lib/feedback/types'

// The customer feedback box (PLAN_CUSTOMER_FEEDBACK.md §6).
//
// ── ON REUSING THE CART'S SheetShell ────────────────────────────────
// Deliberate, and worth stating because it points the wrong way in the
// dependency graph: `components/cart/` is documented as liftable as a
// directory, and this file now imports out of it. Lifting the cart still
// works (the cart depends on nothing here); what breaks if the cart is ever
// removed is this component, which is a cheap and visible failure. The
// alternative was a fourth bespoke bottom sheet in a codebase whose own
// conventions say to reach for the existing ones first — and this is the one
// that actually traps focus, which a form behind a scrim needs and
// ConfirmSheet/PromptSheet's lighter treatment does not provide.
//
// ── MOTION ──────────────────────────────────────────────────────────
// Every class below (`fb-*`) is defined in globals.css next to the `.sheet-*`
// rules it extends, with the reasoning for each. The short version: the sheet
// owns its own entrance, the form's blocks stagger in behind it, choosing a
// category springs the radio, a refused send shakes the action once, and
// success is a REPLACE — the form scales out, then the thank-you springs in.
// All transform/opacity, all `var(--ease)` except the two deliberate springs,
// and all of it off under `prefers-reduced-motion`.
//
// ── WHAT THIS COMPONENT DOES NOT DO ─────────────────────────────────
// It does not decide whether the feedback is acceptable. Everything typed
// here is re-checked server-side by lib/feedback/validate.ts; the checks
// below exist so the customer finds out before the round trip, not because
// the server trusts them. A client-side sanitizer runs on the sender's
// machine and proves nothing — the same note `lib/cart/submission.ts` makes
// about its own validator.

/** How long the form spends scaling out before the thank-you replaces it.
 *  Matches `.fb-view-out`'s duration in globals.css — one number, two files,
 *  so a change to either without the other shows up immediately as a stutter
 *  rather than hiding. */
const REPLACE_MS = 180

/** Only the PATH and the hash — never `location.search`.
 *
 *  This looks like an over-scruple and is not: /checkin carries a signed
 *  check-in token in its query string, and next.config.mjs already sets a
 *  Referrer-Policy specifically to keep that token out of other people's
 *  logs. Copying it into a feedback row would put it back, in a table the
 *  owner reads at leisure weeks later. The path plus the hash is what makes
 *  a bug report actionable ("/menu#cocktails"); the query never was.
 *  `normalizePagePath` on the server drops a query string regardless — this
 *  is the near half of the same rule. */
function currentPagePath(): string | null {
  if (typeof window === 'undefined') return null
  return `${window.location.pathname}${window.location.hash}` || null
}

type Phase = 'form' | 'leaving' | 'sent'

export default function FeedbackSheet({
  open, onClose, lang, dir,
}: {
  open: boolean
  onClose: () => void
  lang: Lang
  dir: 'rtl' | 'ltr'
}) {
  const t = (k: keyof typeof FEEDBACK_UI) => FEEDBACK_UI[k][lang]
  const ids = useId()

  const [category, setCategory] = useState<FeedbackCategory>('business')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  // The honeypot's own state. Kept in React rather than left uncontrolled so
  // it always posts a defined value — see the field itself, below.
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('form')
  // Incremented on every refusal so the shake re-fires on a SECOND failure.
  // Without it React keeps the same element, the animation never restarts,
  // and the customer gets a silent no the second time around.
  const [shake, setShake] = useState(0)
  const replaceTimer = useRef<number | null>(null)
  const footerRef = useRef<HTMLDivElement>(null)

  // A fresh sheet every time it opens. Without this, closing after an error
  // and reopening shows the old error over a form that is now blank, and
  // reopening after a successful send shows the thank-you screen forever.
  useEffect(() => {
    if (!open) return
    setCategory('business')
    setMessage('')
    setEmail('')
    setCompany('')
    setBusy(false)
    setError(null)
    setPhase('form')
    setShake(0)
  }, [open])

  // The replace timer outlives the send that started it if the customer
  // closes the sheet in between — clear it, or it fires into an unmounted
  // tree (and, on a reopened sheet, would skip straight to the thank-you).
  useEffect(() => () => {
    if (replaceTimer.current !== null) window.clearTimeout(replaceTimer.current)
  }, [])

  // Restart the shake without remounting. A CSS animation only runs when it
  // is applied, so re-adding the same class on an element that already has
  // it does nothing — the forced reflow between remove and add is what makes
  // the second refusal shake as well as the first.
  useEffect(() => {
    if (shake === 0) return
    const el = footerRef.current
    if (!el) return
    el.classList.remove('fb-shake')
    void el.offsetWidth
    el.classList.add('fb-shake')
  }, [shake])

  const trimmed = message.trim()
  /** Is there something worth sending? Deliberately NOT "and not busy" — see
   *  the send button for why those two are different states. */
  const messageOk = trimmed.length >= MIN_MESSAGE_LEN && trimmed.length <= MAX_MESSAGE_LEN

  function fail(text: string) {
    setError(text)
    setShake((n) => n + 1)
    haptic('impact')
  }

  async function submit() {
    // The in-flight guard lives HERE rather than on the button's `disabled`,
    // so that a second Enter while the first send is running is ignored
    // without the button ever having to become disabled mid-press.
    if (busy) return
    if (!messageOk) {
      fail(t('errEmpty'))
      return
    }
    haptic('select')
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message: trimmed,
          contactEmail: email.trim() || null,
          pageUrl: currentPagePath(),
          company,
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      // ⚠️ EVERY PATH BELOW RELEASES `busy` EXPLICITLY, and there is no
      // `finally` doing it. An earlier version returned straight out of the
      // refusal branch and left `busy` true — the button then sat on "שולח…",
      // permanently disabled, and the customer could neither retry nor find
      // out why. Caught in the browser, not by any of the endpoint tests,
      // because it only exists on the client. If a branch is ever added here,
      // it releases `busy` too.
      if (!res.ok || !json?.ok) {
        setBusy(false)
        fail(feedbackErrorText(json?.error, lang))
        return
      }
      // Play the form out, then swap.
      setBusy(false)
      setPhase('leaving')
      replaceTimer.current = window.setTimeout(() => setPhase('sent'), REPLACE_MS)
    } catch {
      // A thrown fetch is the network, not the server — say so, because "try
      // again in a moment" is wrong advice for a phone with no signal.
      setBusy(false)
      fail(navigator.onLine === false ? t('errOffline') : t('errGeneric'))
    }
  }

  const remaining = MAX_MESSAGE_LEN - message.length
  let step = 0
  const stepDelay = () => ({ animationDelay: `${60 + step++ * 55}ms` })

  return (
    <SheetShell open={open} onClose={onClose} label={t('title')} dir={dir}>
      {phase === 'sent' ? (
        // Also a proper flex child of the panel, for the same reason as the
        // form's wrapper below. `sentWrap`'s explicit `min-height: 34dvh` is
        // what keeps this from collapsing to three short lines AND what lets
        // it scroll if the copy ever grows: an explicit min-height (unlike
        // the flex default of `auto`) can be shrunk against, so the overflow
        // has somewhere to go instead of pushing the panel open.
        <div className="fb-view" style={{ ...sentWrap, flex: '1 1 auto', overflowY: 'auto' }}>
          {/* The one moment that should feel physical. `.pop` is the same
              overshoot spring the login interstitial uses for its glyph. */}
          <div className="pop" style={{ fontSize: '2.6rem', lineHeight: 1, animationDelay: '40ms' }} aria-hidden>💬</div>
          <h2 className="fb-step" style={{ ...sentTitle, animationDelay: '140ms' }}>
            {t('thanksTitle')}
          </h2>
          <p className="fb-step" style={{ ...sentBody, animationDelay: '200ms' }}>
            {t('thanksBody')}
          </p>
          {/* THE BUG THIS REPLACED: this button used `primaryBtn`, whose
              `flex: 1` does nothing here because this view is not a flex
              container — so it collapsed to the width of the word "סגירה"
              and rendered as a small orange blob. Width is explicit now, and
              `primaryBtn` no longer carries a `flex` of its own (the footer
              sets it on the two buttons that actually sit in a flex row). */}
          <button
            type="button" className="press fb-step"
            onClick={onClose}
            style={{ ...primaryBtn, width: '100%', maxWidth: 260, animationDelay: '260ms' }}
          >
            {t('done')}
          </button>
        </div>
      ) : (
        <div className={phase === 'leaving' ? 'fb-view-out' : undefined} style={leavingWrap(phase)}>
          <div className="fb-step" style={{ paddingBottom: 4, ...stepDelay() }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)' }}>
              {t('title')}
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
              {t('intro')}
            </p>
          </div>

          <div className="sheet-scroll" style={{ gap: 14, paddingTop: 14 }}>
            {/* ── Category ──────────────────────────────────────────────
                Two large targets in a real radiogroup, not a <select> —
                iOS-native controls are the house rule, and this is the one
                choice the owner actually triages on. */}
            <fieldset className="fb-step" style={{ ...fieldset, ...stepDelay() }}>
              <legend style={legend}>{t('categoryLabel')}</legend>
              <div role="radiogroup" aria-label={t('categoryLabel')} style={{ display: 'grid', gap: 8 }}>
                {FEEDBACK_CATEGORIES.map((c) => {
                  const active = category === c
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className="fb-choice"
                      onClick={() => { haptic('select'); setCategory(c) }}
                      style={{
                        ...choice,
                        borderColor: active ? 'var(--neon)' : 'var(--line-strong)',
                        background: active ? 'rgba(255,94,58,0.12)' : 'var(--bg-elev)',
                        boxShadow: active ? '0 0 18px rgba(255,94,58,0.16)' : 'none',
                      }}
                    >
                      <span aria-hidden style={{ fontSize: '1.15rem', flex: '0 0 auto' }}>
                        {c === 'business' ? '🍸' : '🛠️'}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
                        <b style={{ display: 'block', fontSize: '0.94rem', fontWeight: 700, color: 'var(--text)' }}>
                          {t(c)}
                        </b>
                        <small style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 2, lineHeight: 1.4 }}>
                          {t(c === 'business' ? 'businessHint' : 'technicalHint')}
                        </small>
                      </span>
                      {/* The ring is CSS, not inline, so its fill can spring
                          in on selection — see `.fb-radio` in globals.css. */}
                      <span className="fb-radio" data-on={active} aria-hidden><span /></span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {/* ── The message ───────────────────────────────────────── */}
            <div className="fb-step" style={stepDelay()}>
              <label htmlFor={`${ids}-msg`} style={label}>{t('messageLabel')}</label>
              <textarea
                id={`${ids}-msg`}
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LEN))}
                placeholder={t('messagePlaceholder')}
                rows={5}
                maxLength={MAX_MESSAGE_LEN}
                required
                aria-describedby={`${ids}-count`}
                style={textarea}
              />
              <div
                id={`${ids}-count`}
                style={{
                  fontSize: '0.72rem', marginTop: 4, textAlign: 'end',
                  color: remaining < 60 ? 'var(--neon-soft)' : 'var(--text-faint)',
                  fontVariantNumeric: 'tabular-nums',
                  transition: 'color .25s var(--ease)',
                }}
              >
                {/* dir="ltr" on the counter itself, not the row. "0 / 1000" is
                    an LTR expression; inside an RTL block the bidi algorithm
                    reorders it to "1000 / 0", which is a different and wrong
                    claim about how much room is left. The row keeps
                    textAlign:end so the counter still sits at the inline end
                    of the field in both directions. */}
                <span dir="ltr">{message.length} / {MAX_MESSAGE_LEN}</span>
              </div>
            </div>

            {/* ── Optional contact ──────────────────────────────────── */}
            <div className="fb-step" style={stepDelay()}>
              <label htmlFor={`${ids}-email`} style={label}>{t('emailLabel')}</label>
              <input
                id={`${ids}-email`}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.slice(0, MAX_EMAIL_LEN))}
                placeholder={t('emailPlaceholder')}
                maxLength={MAX_EMAIL_LEN}
                // Always LTR: an address is Latin text, and in an RTL sheet an
                // unpinned input puts the caret and the @ on the wrong side.
                dir="ltr"
                style={{ ...input, textAlign: dir === 'rtl' ? 'right' : 'left' }}
              />
              <p style={hint}>{t('emailHint')}</p>
            </div>

            {/* ── The honeypot ──────────────────────────────────────────
                Not display:none — some bots skip hidden fields, and some
                screen readers announce them anyway. This is the standard
                belt-and-braces version: pulled out of the viewport, out of
                the tab order, hidden from the accessibility tree, and told
                not to autofill. A human never sees or reaches it; anything
                non-empty arriving in it did not come from one, and the
                server answers those with a cheerful 200 (see the route).

                ⚠️ ONE INVARIANT TO NOT BREAK. `tabIndex={-1}` keeps it out of
                the browser's own Tab order, but SheetShell's focus trap finds
                its FIRST and LAST focusable with a selector that includes
                `input:not([disabled])` — so if this field were ever the first
                or last focusable in the panel, wrapping at that end would
                focus it, and a keyboard user could type their feedback into
                the field that makes the server discard it silently. It cannot
                be either today, structurally: a category radio always comes
                before it, and the footer's סגירה button — always rendered,
                never disabled — always comes after. Keep it that way; if this
                block ever has to move to the very top or bottom of the panel,
                the trap needs fixing first. */}
            <div aria-hidden style={honeypotWrap}>
              <label htmlFor={`${ids}-company`}>Company</label>
              <input
                id={`${ids}-company`}
                name="company"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>

            <p className="fb-step" style={{ ...hint, marginTop: 0, ...stepDelay() }}>{t('privacy')}</p>

            {/* Announced, not just painted — a customer using a screen reader
                needs to hear that the send failed. */}
            {error && (
              <p key={shake} role="alert" className="fb-step" style={errorText}>
                {error}
              </p>
            )}
          </div>

          {/* Re-triggered by an effect rather than by a changing `key`.
              Remounting would restart the animation just as well, but it
              would also destroy and rebuild the two buttons — and the
              customer who just pressed Send with a keyboard would lose focus
              at the exact moment they are being told something went wrong. */}
          <div ref={footerRef} style={{ paddingTop: 12, display: 'flex', gap: 8 }}>
            <button type="button" className="press" onClick={onClose} style={{ ...secondaryBtn, flex: 1 }}>
              {t('close')}
            </button>
            {/* `disabled` reflects ONLY "there is nothing to send" — a state
                the customer reaches with focus in the textarea, not on this
                button. Being in flight is `aria-disabled` plus the guard at
                the top of submit(), deliberately NOT `disabled`: disabling a
                button that currently has focus blurs it in every browser, so
                a keyboard user who pressed Send would be dropped to <body>
                at the exact moment the result — success or refusal — needs
                announcing. Verified in the browser; it is why the shake
                could not find its focus target on the first attempt. */}
            <button
              type="button"
              className="press"
              onClick={submit}
              disabled={!messageOk}
              aria-disabled={busy}
              aria-busy={busy}
              style={{
                ...primaryBtn, flex: 2,
                opacity: messageOk ? (busy ? 0.75 : 1) : 0.45,
                cursor: busy ? 'progress' : 'pointer',
                transition: 'opacity .2s var(--ease)',
              }}
            >
              {busy ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="fb-spin" aria-hidden />
                  {t('sending')}
                </span>
              ) : t('submit')}
            </button>
          </div>
        </div>
      )}
    </SheetShell>
  )
}

/** The success view is centred and given room rather than collapsing to the
 *  height of three short lines — the sheet shrinks once, gently, instead of
 *  snapping to a small box under the customer's thumb. */
const sentWrap: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 10, minHeight: '34dvh', padding: '18px 4px 10px', textAlign: 'center',
}
const sentTitle: CSSProperties = {
  margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)',
}
const sentBody: CSSProperties = {
  margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--text-dim)', lineHeight: 1.6, maxWidth: 320,
}

/**
 * ⚠️ THIS WRAPPER MUST STAY A FLEX COLUMN THAT FILLS THE PANEL.
 *
 * `.sheet-panel` is `display:flex; flex-direction:column; max-height:88dvh`,
 * and `.sheet-scroll` only scrolls because it is a flex child with
 * `min-height:0` inside that bounded column. The motion pass introduced this
 * wrapper so `fb-view-out` had a box to animate — and, as a plain block div,
 * it broke the chain: the scroll area's parent became unbounded, so it grew
 * to content height instead of scrolling, the panel overflowed, and THE SEND
 * BUTTON WENT OFF THE BOTTOM OF THE SCREEN. On a phone that is not a cosmetic
 * bug, it is "I cannot submit at all" — which is exactly how it was reported.
 *
 * `display: contents` would fix the chain by removing the box entirely, but
 * then there is nothing left to animate, which defeats the wrapper's whole
 * reason for existing. So it stays a real box and joins the column properly.
 *
 * While the form is leaving it also stops taking taps — the send has already
 * succeeded and a second one would be a second row.
 */
function leavingWrap(phase: Phase): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    flex: '1 1 auto',
    ...(phase === 'leaving' ? { pointerEvents: 'none' } : {}),
  }
}

const fieldset: CSSProperties = { border: 0, margin: 0, padding: 0, minWidth: 0 }
const legend: CSSProperties = {
  padding: 0, marginBottom: 8, fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-dim)',
}
const label: CSSProperties = {
  display: 'block', marginBottom: 6, fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-dim)',
}
const hint: CSSProperties = {
  margin: '6px 2px 0', fontSize: '0.73rem', color: 'var(--text-faint)', lineHeight: 1.5,
}
const errorText: CSSProperties = {
  margin: 0, color: '#ff6b6b', fontSize: '0.82rem', lineHeight: 1.5,
}
const choice: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 11, width: '100%',
  padding: '12px 13px', borderRadius: 14, border: '1px solid var(--line-strong)',
  color: 'var(--text)', font: 'inherit', cursor: 'pointer',
}
const input: CSSProperties = {
  width: '100%', padding: '12px 13px', borderRadius: 12,
  border: '1px solid var(--line-strong)', background: 'var(--bg)',
  color: 'var(--text)', fontSize: '0.95rem', fontFamily: 'inherit',
}
const textarea: CSSProperties = {
  ...input, resize: 'vertical', minHeight: 110, lineHeight: 1.55,
}
/** No `flex` here on purpose — the footer sets it on the two buttons that
 *  actually sit in a flex row, and the success view sets its own width.
 *  Carrying `flex: 1` in the shared style is what produced the collapsed
 *  orange blob on the thank-you screen. */
const primaryBtn: CSSProperties = {
  padding: '14px 0', borderRadius: 14, border: '1px solid transparent',
  background: 'linear-gradient(135deg, rgba(255,94,58,0.9), rgba(255,138,92,0.75))',
  color: '#fff', fontSize: '0.98rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const secondaryBtn: CSSProperties = {
  padding: '14px 0', borderRadius: 14,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
  color: 'var(--text)', fontSize: '0.98rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
/** Off-canvas rather than display:none — see the field's own comment. */
const honeypotWrap: CSSProperties = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden',
  clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0, padding: 0, margin: -1,
}
