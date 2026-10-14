// The server half of the join links: minting a token, hashing it, and calling migration 059's functions.
// Server-only (node:crypto, and every call is the service role). The rules and the words are in ./join.ts.
//
// Every function here turns "migration 059 is not applied yet" into a typed outcome rather than an exception —
// the owner approves each migration separately, so this code ships first and must be calm until then.

import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingObject } from '@/lib/server/db-errors'
import {
  JOIN_TOKEN_BYTES, JOIN_TTL_HOURS_DEFAULT, isJoinToken, parseClaim, parsePeek,
  type JoinClaim, type JoinLinkRow, type JoinPeek,
} from './join'

/** sha256 hex — what migration 059 stores (`token_hash ~ '^[0-9a-f]{64}$'`). */
export const hashJoinToken = (token: string): string => createHash('sha256').update(token).digest('hex')

/** A new secret. 32 random bytes → 43 base64url characters; only the hash is ever stored. */
export function mintJoinToken(): { token: string; hash: string } {
  const token = randomBytes(JOIN_TOKEN_BYTES).toString('base64url')
  return { token, hash: hashJoinToken(token) }
}

export type IssueReason = 'no_staff' | 'inactive' | 'already_linked' | 'owner_role' | 'bad_hash' | 'not_set_up' | 'server'
const ISSUE_REASONS: readonly IssueReason[] = ['no_staff', 'inactive', 'already_linked', 'owner_role', 'bad_hash']

export type IssueOutcome =
  | { ok: true; expiresAt: string }
  | { ok: false; reason: IssueReason }

export async function issueJoin(
  service: SupabaseClient, staffId: string, actorStaffId: string | null, hash: string,
  ttlHours: number = JOIN_TTL_HOURS_DEFAULT,
): Promise<IssueOutcome> {
  const { data, error } = await service.rpc('staff_join_issue', {
    p_staff: staffId, p_hash: hash, p_actor: actorStaffId, p_ttl_hours: ttlHours,
  })
  if (error) {
    if (isMissingObject(error)) return { ok: false, reason: 'not_set_up' }
    console.error('staff_join_issue failed:', error.code, error.message)
    return { ok: false, reason: 'server' }
  }
  const d = (data ?? {}) as { ok?: boolean; reason?: string; expires_at?: string }
  if (d.ok && typeof d.expires_at === 'string') return { ok: true, expiresAt: d.expires_at }
  const reason = ISSUE_REASONS.find((r) => r === d.reason)
  return { ok: false, reason: reason ?? 'server' }
}

export async function revokeJoin(service: SupabaseClient, staffId: string): Promise<{ ok: boolean; notSetUp: boolean }> {
  const { error } = await service.rpc('staff_join_revoke', { p_staff: staffId })
  if (error) {
    if (isMissingObject(error)) return { ok: false, notSetUp: true }
    console.error('staff_join_revoke failed:', error.code, error.message)
    return { ok: false, notSetUp: false }
  }
  return { ok: true, notSetUp: false }
}

/** What the wizard's first screen needs. A malformed token never reaches the database. */
export async function peekJoin(service: SupabaseClient, token: string): Promise<{ peek: JoinPeek; notSetUp: boolean }> {
  if (!isJoinToken(token)) return { peek: parsePeek(null), notSetUp: false }
  const { data, error } = await service.rpc('staff_join_peek', { p_hash: hashJoinToken(token) })
  if (error) {
    if (isMissingObject(error)) return { peek: parsePeek(null), notSetUp: true }
    console.error('staff_join_peek failed:', error.code, error.message)
    return { peek: parsePeek(null), notSetUp: false }
  }
  return { peek: parsePeek(data), notSetUp: false }
}

export async function claimJoin(
  service: SupabaseClient, token: string, userId: string,
): Promise<JoinClaim & { notSetUp: boolean; failed: boolean }> {
  if (!isJoinToken(token)) return { ...parseClaim(null), notSetUp: false, failed: false }
  const { data, error } = await service.rpc('staff_join_claim', { p_hash: hashJoinToken(token), p_user: userId })
  if (error) {
    if (isMissingObject(error)) return { ...parseClaim(null), notSetUp: true, failed: false }
    console.error('staff_join_claim failed:', error.code, error.message)
    return { ...parseClaim(null), notSetUp: false, failed: true }
  }
  return { ...parseClaim(data), notSetUp: false, failed: false }
}

/** The newest link per person, for the roster's "link sent / expired / used" chip. Missing table → empty. */
export async function latestJoinLinks(service: SupabaseClient, staffIds: string[]): Promise<Map<string, JoinLinkRow>> {
  const out = new Map<string, JoinLinkRow>()
  if (!staffIds.length) return out
  const { data, error } = await service
    .from('staff_join_links')
    .select('staff_id, expires_at, used_at, revoked_at, created_at')
    .in('staff_id', staffIds)
    .order('created_at', { ascending: false })
  if (error || !data) return out
  for (const r of data as (JoinLinkRow & { staff_id: string })[]) {
    if (!out.has(r.staff_id)) out.set(r.staff_id, { expires_at: r.expires_at, used_at: r.used_at, revoked_at: r.revoked_at })
  }
  return out
}
