'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { haptic } from '@/lib/haptics'

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
//
// THE COLUMN NEVER MOVES UNDER A FINGER THAT IS STILL DOWN.
// `holding` is the whole reason this component has touch handlers at all. The
// original bug: pause mid-drag for longer than the settle delay, the settle
// timer fires, onChange reports the value you happen to be over, the parent
// re-renders with a new `value`, and the park effect below scrolls the column
// to it — while you are still holding it. The dial fought back, which is
// exactly the "it doesn't just go up and down" complaint. Pointer events alone
// cannot see this: `touch-action: pan-y` hands the gesture to the browser's
// scroller, which fires `pointercancel` the instant the pan starts, so the
// pointer handlers below are the MOUSE path and the touch handlers are the
// finger path. Both feed one flag.

export const WHEEL_ITEM_H = 40
const VISIBLE = 5
/** Past this many pixels a press is a drag, not a click on an option. */
const DRAG_SLOP = 4
/** Quiet time after the last scroll event before the value is committed. */
const SETTLE_MS = 110

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
  /** Finger or mouse button currently down on this column. See the header. */
  const holding = useRef(false)
  /** Last row the column was seen over, so the haptic fires once per value
   *  crossed rather than once per scroll event. */
  const ticked = useRef(-1)

  const index = Math.max(0, values.indexOf(value))

  // Park on the selected value — on mount, and whenever it changes from the
  // outside (the duration shortcuts move both wheels at once).
  //
  // useLayoutEffect, not useEffect: a plain effect runs AFTER paint, so a
  // sheet containing a wheel painted one frame at 00 and then jumped to 18:00.
  // On a phone that reads as the sheet loading rather than opening.
  //
  // Deliberately WITHOUT a "this scroll was mine, ignore it" flag. The obvious
  // way to write that is to set a ref and clear it in requestAnimationFrame —
  // but rAF doesn't run while the tab is backgrounded, so the flag latches on
  // and the first real scroll after the owner comes back gets swallowed. No
  // flag is needed anyway: parking on the current value settles at the index
  // that value already maps to, and the handler below only reports a CHANGE.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || holding.current) return
    const top = index * WHEEL_ITEM_H
    ticked.current = index
    if (Math.abs(el.scrollTop - top) < 2) return
    el.scrollTo({ top, behavior: 'auto' })
  }, [index])

  /** Nearest whole option to wherever the column currently sits. */
  function indexAt(el: HTMLDivElement) {
    return Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_H)))
  }

  /** Commit whatever the column is sitting on, once it has stopped moving. */
  function scheduleSettle() {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => {
      const el = ref.current
      // Still held — the gesture isn't over, so neither is the decision.
      if (!el || holding.current) return
      const i = indexAt(el)
      if (values[i] !== value) onChange(values[i])
    }, SETTLE_MS)
  }

  function handleScroll() {
    if (disabled || drag.current) return

    // One tap per value passed over, live, while the column is still moving —
    // this is the part that makes it feel like the phone's own picker rather
    // than a list that happens to snap.
    const el = ref.current
    if (el) {
      const i = indexAt(el)
      if (i !== ticked.current) {
        ticked.current = i
        haptic('tick')
      }
    }

    // Fires on the pause after the fling, not during it — reporting every
    // intermediate row would spray changes the owner never chose.
    scheduleSettle()
  }

  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current) }, [])

  // ---- touch ---------------------------------------------------------------
  // Scrolling itself is left entirely to the platform: a finger already drags a
  // scroll container, with real momentum. These handlers only track whether the
  // finger is down, for the reason in the header.

  function onTouchStart() {
    if (disabled) return
    holding.current = true
    const el = ref.current
    if (el) ticked.current = indexAt(el)
  }

  function onTouchEnd() {
    holding.current = false
    // Momentum usually keeps firing `scroll`, which reschedules this; a
    // stationary tap-and-release produces no scroll event at all, so the
    // settle has to be armed here too or that gesture never commits.
    scheduleSettle()
  }

  // ---- mouse press and drag ------------------------------------------------
  // Exists for the mouse, where a scroll container offers only the wheel —
  // grabbing the dial and pulling it is the gesture the control looks like it
  // should have.

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || e.pointerType === 'touch' || e.button !== 0) return
    const el = ref.current
    if (!el) return
    drag.current = { startY: e.clientY, startTop: el.scrollTop, moved: false }
    dragged.current = false
    holding.current = true
    ticked.current = indexAt(el)
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

    const i = indexAt(el)
    if (i !== ticked.current) {
      ticked.current = i
      haptic('tick')
    }
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = ref.current
    if (!d || !el) return
    drag.current = null
    holding.current = false
    dragged.current = d.moved
    el.style.scrollSnapType = ''
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)

    const i = indexAt(el)
    ticked.current = i
    el.scrollTo({ top: i * WHEEL_ITEM_H, behavior: 'smooth' })
    if (values[i] !== value) onChange(values[i])
  }

  function handleKey(e: React.KeyboardEvent) {
    if (disabled) return
    const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const i = Math.min(values.length - 1, Math.max(0, index + delta))
    if (values[i] !== value) {
      haptic('tick')
      onChange(values[i])
    }
  }

  return (
    <div
      className="wheel" data-disabled={disabled ? 'true' : undefined}
      style={{ height: VISIBLE * WHEEL_ITEM_H }}
    >
      {/* No selection band here on purpose — TimeWheel draws ONE across both
          columns, which is how a real picker looks. */}
      <div
        ref={ref} onScroll={handleScroll} onKeyDown={handleKey}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
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
            onClick={() => {
              if (disabled || dragged.current) return
              if (v !== value) haptic('tick')
              onChange(v)
            }}
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
