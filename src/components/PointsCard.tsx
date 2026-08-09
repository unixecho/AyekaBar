interface PointsCardProps {
  points: number
  totalVisits: number
  nextRewardName: string | null
  nextRewardPoints: number | null
  progress: number // 0–100
}

export default function PointsCard({
  points,
  totalVisits,
  nextRewardName,
  nextRewardPoints,
  progress,
}: PointsCardProps) {
  return (
    <div className="rounded-2xl border border-amber-900/40 bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 space-y-4">
      {/* Points balance */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-zinc-500 mb-1">הנקודות שלך</p>
          <p className="text-5xl font-bold tabular-nums text-amber-400">{points}</p>
        </div>
        <div className="text-left">
          <p className="text-xs text-zinc-600">סה"כ ביקורים</p>
          <p className="text-2xl font-semibold text-zinc-300 text-right">{totalVisits}</p>
        </div>
      </div>

      {/* Progress to next reward */}
      {nextRewardName && nextRewardPoints && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-zinc-500">
            <span>הפרס הבא: {nextRewardName}</span>
            <span>{points}/{nextRewardPoints}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <p className="text-xs text-zinc-600">
            עוד {nextRewardPoints - points} ביקורים לפרס הבא
          </p>
        </div>
      )}

      {!nextRewardName && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-center">
          <p className="text-sm font-medium text-amber-400">
            🎉 כל הפרסים פתוחים לך! בא לפדות
          </p>
        </div>
      )}
    </div>
  )
}
