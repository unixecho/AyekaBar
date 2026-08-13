import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { ScheduleAccessRow } from './access'

// Server-side gate for the two schedule pages.
//
// Middleware is the first gate, not the only one — every /owner/* page in this
// app re-checks server-side, and these do too.
//
// ⚠️ PROTOTYPE SCOPE. This resolves the caller's staff row and stops there:
// "is this person a schedule manager?" additionally depends on
// `shift_settings.schedule_managers`, and that table does not exist until
// migration 027 is applied. So the server gate today is "must be on the
// roster", and the precise manage-vs-view split is computed in the client from
// the prototype's own settings.
//
// WHEN 027 LANDS this function reads shift_settings for the venue and calls
// canManageSchedule(row, settings) here, so the manager surface is refused at
// the server rather than rendered read-only. That is the one line standing
// between the prototype and a production gate, and it is deliberately marked
// rather than left as an exercise.

export interface ScheduleViewer {
  userId: string
  staff: ScheduleAccessRow
  name: string
}

export async function requireScheduleViewer(): Promise<ScheduleViewer> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS lets each user read exactly their own row, which is all this needs.
  const { data: me } = await supabase
    .from('staff')
    .select('id, role, badge, display_name, first_name, last_name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // Signed in with Google is not the same as being staff — the distinction the
  // owner guard documents, and the reason /no-access exists.
  if (!me) redirect('/no-access')

  const name = me.display_name?.trim()
    || [me.first_name, me.last_name].filter(Boolean).join(' ').trim()
    || me.email
    || user.email
    || '—'

  return {
    userId: user.id,
    staff: { id: me.id, role: me.role, badge: me.badge },
    name,
  }
}
