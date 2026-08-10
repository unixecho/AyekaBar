'use client'

import { useEffect, useRef } from 'react'

// The iOS clock wheel: a column that scrolls under a fixed highlight band, and
// settles onto whole values.
//
// Snapping is CSS (`scroll-snap-type: y mandatory`), not JavaScript, so touch
// momentum and rubber-banding are the platform's own — a hand-rolled version
// always feels a half-beat off on a real phone. All this component does is read
// back where the scroll settled.
//
// Geometry: with WHEEL_ITEM_H-tall options, a viewport of VISIBLE options, and
// half a viewport of padding at each end, option `i` is centred exactly when
// scrollTop === i * WHEEL_ITEM_H. That identity is what makes reading the
// selection a division instead of a measurement.

export const WHEEL_ITEM_H = 40
const VISIBLE = 5
/** Past this many pixels a press is a drag, not a click on an option. */
const DRAG_SLOP = 4

export default function WheelPicker({
  values, value, onChange, ariaLabel, format = String, disabled = false,
}: {
  values: number[]
  value: number
  onChange: (v: number) => void
  ariaLabel: string
  format?: (v: number) => string
  disabled?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drag = useRef<{ startY: number; startTop: number; moved: boolean } | null>(null)
  // Outlives the drag itself: `click` fires after `pointerup`, by which point
  // drag.current is already cleared, so the "that was a drag" fact has to be
  // parked somewhere the click handler can still see it.
  const dragged = useRef(false)

  const index = Math.max(0, values.indexOf(value))

  // Park on the selected value — on mount, and whenever it changes from the
  // outside (the duration shortcuts move both wheels at once).
  //
  // Deliberately WITHOUT a "this scroll was mine, ignore it" flag. The obvious
  // way to write that is to set a ref and clear it in requestAnimationFrame —
  // but rAF doesn't run while the tab is backgrounded, so the flag latches on
  // and the first real scroll after the owner comes back gets swallowed. No
  // flag is needed anyway: parking on the current value settles at the index
  // that value already maps to, and the handler below only reports a CHANGE.
  useEffect(() => {
    const el = ref.current
    if (!el || drag.current) return
    const top = index * WHEEL_ITEM_H
    if (Math.abs(el.scrollTop - top) < 2) return
    el.scrollTo({ top, behavior: 'auto' })
  }, [index])

  /** Nearest whole option to wherever the column currently sits. */
  function indexAt(el: HTMLDivElement) {
    return Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_H)))
  }

  function handleScroll() {
    if (disabled || drag.current) return
    if (settleTimer.current) clearTimeout(settleTimer.current)

    // Fires on the pause after the fling, not during it — reporting every
    // intermediate row would spray changes the owner never chose.
    settleTimer.current = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const i = indexAt(el)
      if (values[i] !== value) onChange(values[i])
    }, 120)
  }

  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current) }, [])

  // ---- press and drag ------------------------------------------------------
  // Touch is left entirely alone: a finger already drags a scroll container,
  // with real momentum. This exists for the mouse, where a scroll container
  // offers only the wheel — grabbing the dial and pulling it is the gesture
  // the control looks like it should have.

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || e.pointerType === 'touch' || e.button !== 0) return
    const el = ref.current
    if (!el) return
    drag.current = { startY: e.clientY, startTop: el.scrollTop, moved: false }
    dragged.current = false
    // Mandatory snapping re-centres the column on every scrollTop we assign,
    // which would drag the wheel back out from under the cursor. Suspended for
    // the duration of the drag and restored on release.
    el.style.scrollSnapType = 'none'
    el.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = ref.current
    if (!d || !el) return
    const dy = e.clientY - d.startY
    if (Math.abs(dy) > DRAG_SLOP) d.moved = true
    el.scrollTop = d.startTop - dy
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = ref.current
    if (!d || !el) return
    drag.current = null
    dragged.current = d.moved
    el.style.scrollSnapType = ''
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)

    const i = indexAt(el)
    el.scrollTo({ top: i * WHEEL_ITEM_H, behavior: 'smooth' })
    if (values[i] !== value) onChange(values[i])
  }

  function handleKey(e: React.KeyboardEvent) {
    if (disabled) return
    const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const i = Math.min(values.length - 1, Math.max(0, index + delta))
    if (values[i] !== value) onChange(values[i])
  }

  return (
    <div
      className="wheel" data-disabled={disabled ? 'true' : undefined}
      style={{ height: VISIBLE * WHEEL_ITEM_H }}
    >
      <div aria-hidden className="wheel-band" style={{ height: WHEEL_ITEM_H }} />
      <div
        ref={ref} onScroll={handleScroll} onKeyDown={handleKey}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={endDrag} onPointerCancel={endDrag}
        role="listbox" aria-label={ariaLabel} tabIndex={disabled ? -1 : 0}
        className="wheel-scroll" dir="ltr"
        style={{ paddingBlock: (VISIBLE - 1) / 2 * WHEEL_ITEM_H }}
      >
        {values.map((v) => (
          <div
            key={v} role="option" aria-selected={v === value}
            // A drag that happens to finish over an option must not also count
            // as picking it — the release already chose whatever it landed on.
            onClick={() => { if (!disabled && !dragged.current) onChange(v) }}
            className="wheel-opt" data-on={v === value ? 'true' : undefined}
            style={{ height: WHEEL_ITEM_H }}
          >
            {format(v)}
          </div>
        ))}
      </div>
    </div>
  )
}
