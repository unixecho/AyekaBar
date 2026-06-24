import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import QRDisplay from '@/components/QRDisplay'

export default async function StaffDashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/staff')

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-amber-400">אייכה בר</h1>
          <p className="text-zinc-400">קוד QR לצוות</p>
        </div>

        {/* QR component handles fetch + refresh */}
        <QRDisplay />

        {/* Instructions for staff */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-right">
          <p className="text-sm font-semibold text-zinc-300 mb-2">הוראות לצוות:</p>
          <ol className="text-sm text-zinc-500 space-y-1 list-decimal list-inside">
            <li>הצג את הקוד ללקוח לפני שעוזב</li>
            <li>הלקוח סורק עם המצלמה שלו</li>
            <li>הנקודה נצברת אוטומטית</li>
          </ol>
          <p className="text-xs text-zinc-600 mt-3">
            הקוד מתחדש כל 15 דקות ותקף לשימוש חד-פעמי
          </p>
        </div>
      </div>
    </main>
  )
}
