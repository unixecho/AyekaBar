'use client'

import { useState } from 'react'

interface Reward {
  id: string
  rewardName: string
  rewardNameHe: string | null
  requiredPoints: number
  unlocked: boolean
}

interface RewardsListProps {
  rewards: Reward[]
  customerPoints: number
}

export default function RewardsList({ rewards, customerPoints }: RewardsListProps) {
  const [redeeming, setRedeeming] = useState<string | null>(null)
  const [redeemed, setRedeemed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleRedeem(reward: Reward) {
    // A11y (WCAG 2.4.3): re-entry was already guarded here, so switching the
    // button below from `disabled` to `aria-disabled` (same fix
    // FeedbackSheet.tsx's send button already documents — disabling a
    // focused button blurs it) needed no new guard, just the style change.
    // Found 2026-09-04.
    if (!reward.unlocked || redeeming) return
    setRedeeming(reward.id)
    setError(null)

    try {
      const res = await fetch('/api/rewards/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId: reward.id }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'שגיאה בפדיון הפרס')
        return
      }

      setRedeemed(reward.id)
    } catch {
      setError('שגיאה בחיבור. נסה שוב.')
    } finally {
      setRedeeming(null)
    }
  }

  if (rewards.length === 0) {
    // A11y (WCAG 1.4.3): text-zinc-600 directly on the page background
    // computed to ~2.3-2.6:1, well under 4.5:1 -- this component uses raw
    // Tailwind colors instead of the app's own audited --text-* tokens, so
    // it never got the 2026-09-01 contrast pass those tokens document.
    // Found 2026-09-04.
    return (
      <p className="text-sm text-center py-4" style={{ color: 'var(--text-faint)' }}>
        אין פרסים פעילים כרגע
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/* A11y (WCAG 4.1.3): plain text, never announced. */}
      {error && (
        <p role="alert" className="text-sm text-red-400 text-center">{error}</p>
      )}

      {rewards.map((reward) => {
        const isRedeemed = redeemed === reward.id
        const isRedeeming = redeeming === reward.id

        return (
          <div
            key={reward.id}
            className={`rounded-2xl border px-4 py-4 flex items-center justify-between transition-all
              ${reward.unlocked
                ? 'border-amber-700/50 bg-amber-950/30'
                : 'border-zinc-800 bg-zinc-900 opacity-60'
              }
              ${isRedeemed ? 'border-green-700/50 bg-green-950/30' : ''}
            `}
          >
            <div className="space-y-0.5">
              {/* A11y (WCAG 1.4.3): text-zinc-500 computed to ~3.7-4.1:1,
                  under 4.5:1 -- same root cause as the empty-state fix
                  above (raw Tailwind colors, never covered by the app's
                  own contrast pass). */}
              <p className="font-semibold" style={{ color: reward.unlocked ? 'var(--text)' : 'var(--text-faint)' }}>
                {reward.rewardNameHe ?? reward.rewardName}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {reward.requiredPoints} נקודות
              </p>
            </div>

            <div className="flex items-center gap-2">
              {isRedeemed ? (
                <span className="text-xs text-green-400 font-medium">✓ נפדה!</span>
              ) : reward.unlocked ? (
                <button
                  onClick={() => handleRedeem(reward)}
                  aria-disabled={isRedeeming} aria-busy={isRedeeming}
                  className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 transition"
                  style={{ opacity: isRedeeming ? 0.5 : 1, cursor: isRedeeming ? 'progress' : 'pointer' }}
                >
                  {isRedeeming ? '...' : 'פדה'}
                </button>
              ) : (
                <div className="flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                  <span className="text-sm" aria-hidden>🔒</span>
                  <span className="text-xs">{reward.requiredPoints - customerPoints} נוספות</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
