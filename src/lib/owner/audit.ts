import type { SupabaseClient } from '@supabase/supabase-js'

// Append-only audit writer (migration 014). Called from owner-gated API routes
// after the change itself succeeded.

export type AuditAction =
  | 'menu.save'
  | 'menu.publish'
  | 'variant.create'
  | 'variant.update'
  | 'variant.delete'
  | 'variant.activate'
  | 'variant.default'
  | 'happy_hour.update'
  /** The menu's customer-facing cart switched on/off (PLAN_MENU_CART.md).
   *  ⚠️ Like 'variant.default' above, this value is NOT yet in
   *  `menu_audit.action`'s CHECK constraint — migration 014 lists seven
   *  actions and the union here has nine. Postgres rejects the insert and
   *  `logAudit` swallows it, so writing it is harmless and it starts
   *  recording the moment migration 048 widens the constraint. Flagged in
   *  HANDOFF.md; 'variant.default' has been silently dropping rows since it
   *  was added, which is how this was noticed. */
  | 'menu_cart.update'

/** Resolve who is acting, from the staff roster, falling back to the auth
 *  record. Stored as a snapshot so removing someone later doesn't erase what
 *  they did. */
async function actorIdentity(service: SupabaseClient, userId: string) {
  const { data } = await service
    .from('staff')
    .select('display_name, first_name, last_name, email')
    .eq('auth_user_id', userId)
    .maybeSingle()

  const name = data?.display_name?.trim()
    || [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim()
    || null

  return { name, email: data?.email ?? null }
}

/**
 * Record an action. Deliberately never throws: a failed audit write must not
 * roll back or mask the change the owner actually made — a missing log line is
 * better than a publish that appears to have failed.
 */
export async function logAudit(
  service: SupabaseClient,
  userId: string,
  action: AuditAction,
  summary: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const who = await actorIdentity(service, userId)
    await service.from('menu_audit').insert({
      actor_id: userId,
      actor_name: who.name,
      actor_email: who.email,
      action,
      summary,
      detail,
    })
  } catch {
    // swallowed on purpose — see above
  }
}
