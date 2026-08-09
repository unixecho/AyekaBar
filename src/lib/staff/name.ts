import type { User } from '@supabase/supabase-js'

/** Pull a first/last name out of a Google-authenticated Supabase user. */
export function splitName(user: User): { first: string | null; last: string | null } {
  const m = (user.user_metadata ?? {}) as Record<string, unknown>
  const given = typeof m.given_name === 'string' ? m.given_name : null
  const family = typeof m.family_name === 'string' ? m.family_name : null
  if (given || family) return { first: given, last: family }
  const full = (typeof m.full_name === 'string' && m.full_name)
    || (typeof m.name === 'string' && m.name) || ''
  if (!full) return { first: null, last: null }
  const parts = full.trim().split(/\s+/)
  return { first: parts[0] ?? null, last: parts.slice(1).join(' ') || null }
}
