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
    return (
      <p className="text-sm text-zinc-600 text-center py-4">
        אין פרסים פעילים כרגע
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-400 text-center">{error}</p>
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
              <p className={`font-semibold ${reward.unlocked ? 'text-zinc-100' : 'text-zinc-500'}`}>
                {reward.rewardNameHe ?? reward.rewardName}
              </p>
              <p className="text-xs text-zinc-500">
                {reward.requiredPoints} נקודות
              </p>
            </div>

            <div className="flex items-center gap-2">
              {isRedeemed ? (
                <span className="text-xs text-green-400 font-medium">✓ נפדה!</span>
              ) : reward.unlocked ? (
                <button
                  onClick={() => handleRedeem(reward)}
                  disabled={!!isRedeeming}
                  className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50 transition"
                >
                  {isRedeeming ? '...' : 'פדה'}
                </button>
              ) : (
                <div className="flex items-center gap-1 text-zinc-600">
                  <span className="text-sm">🔒</span>
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
