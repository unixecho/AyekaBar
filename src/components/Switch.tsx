'use client'

// The iOS toggle, shared by every owner surface that has an on/off.
//
// Lives on its own rather than inside VariantWizard, where it started: once
// TempMenuSheet needed it too, importing it from the wizard made the wizard and
// the sheet import each other. That cycle happens to work — Switch is only
// called at render time, by which point both modules have finished loading —
// but it's the kind of thing that breaks the day someone moves a call to the
// top level, and it costs nothing to not have.
//
// Purely presentational and aria-hidden: the caller owns the button, the
// role="switch" and the aria-checked.

export default function Switch({ on, partial = false, small = false }: {
  on: boolean
  /** Some-but-not-all, for a category whose items are mixed. */
  partial?: boolean
  small?: boolean
}) {
  const w = small ? 40 : 46
  const h = small ? 24 : 28
  const knob = h - 6
  const travel = w - knob - 8
  return (
    <span aria-hidden style={{
      flex: '0 0 auto', width: w, height: h, borderRadius: 999, direction: 'ltr',
      display: 'inline-flex', alignItems: 'center', padding: 3, boxSizing: 'border-box',
      // WCAG 1.4.11: was var(--line-strong) for the OFF-state track border.
      border: `1px solid ${on || partial ? 'transparent' : 'var(--line-interactive)'}`,
      background: on
        ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))'
        : partial ? 'rgba(255,94,58,0.40)' : 'var(--bg-elev-2)',
      transition: 'background .25s var(--ease)',
    }}>
      <span style={{
        width: knob, height: knob, borderRadius: 999, background: '#fff',
        // WCAG 1.4.11: the white knob on the ON-state neon gradient track
        // computed to 2.32:1-3.04:1, under the 3:1 minimum for a UI
        // component's boundary — the soft blur shadow alone doesn't give a
        // reliable enough edge. A solid dark ring does (≈8.5:1 against the
        // gradient) and costs nothing in the off/partial states, where the
        // white fill already contrasts fine against the darker track on
        // its own.
        border: '2px solid var(--bg)', boxSizing: 'border-box',
        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
        transform: `translateX(${on ? travel : partial ? travel / 2 : 0}px)`,
        transition: 'transform .26s var(--ease)',
      }} />
    </span>
  )
}
