'use client'

// The iOS segmented control. The app already replaced the native <select>
// (RolePicker) and the native confirm (ConfirmSheet) for the same reason this
// exists: a row of plain buttons reads as a toolbar, while a segmented control
// reads as "these are the states this thing can be in, and you are in one".
//
// Two accessibility shapes, because the same visual serves two different jobs:
//   tabs  — switching between views (week / warnings / settings)
//   radio — choosing a value that will be saved (available / unavailable)
// Announcing a value picker as a tablist tells a screen-reader user the page
// changed when it did not, so the caller states which one it is.

export interface SegmentOption<T extends string> {
  value: T
  label: string
  /** Small count or dot rendered after the label — used for warning counts. */
  badge?: string | number
  disabled?: boolean
}

export default function SegmentedControl<T extends string>({
  options, value, onChange, ariaLabel, mode = 'tabs',
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  mode?: 'tabs' | 'radio'
}) {
  const isTabs = mode === 'tabs'

  return (
    <div className="sh-seg" role={isTabs ? 'tablist' : 'radiogroup'} aria-label={ariaLabel}>
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            className="sh-seg-opt"
            role={isTabs ? 'tab' : 'radio'}
            aria-selected={isTabs ? selected : undefined}
            aria-checked={isTabs ? undefined : selected}
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange(opt.value)}
          >
            {opt.label}
            {opt.badge != null && opt.badge !== 0 && (
              <span
                aria-hidden
                style={{
                  marginInlineStart: 6, padding: '1px 6px', borderRadius: 999,
                  fontSize: '0.68rem', fontWeight: 800,
                  background: selected ? 'var(--neon)' : 'var(--line-strong)',
                  color: selected ? '#fff' : 'var(--text-dim)',
                }}
              >
                {opt.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
