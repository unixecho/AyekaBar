import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { getCustomerFeedbackEnabled } from '@/lib/settings/server'
import { validateFeedbackInput } from '@/lib/feedback/validate'
import {
  FEEDBACK_RATE_MAX, FEEDBACK_RATE_WINDOW_SECONDS,
  FEEDBACK_GLOBAL_RATE_MAX, FEEDBACK_GLOBAL_RATE_WINDOW_SECONDS,
} from '@/lib/feedback/types'

// The customer feedback box's write path (PLAN_CUSTOMER_FEEDBACK.md §4).
//
// ── WHAT MAKES THIS ROUTE DIFFERENT FROM EVERY OTHER WRITE HERE ──────
// It is bare. No `requireOwner()`, no `requireStaff()`, not even a session —
// by design, because a suggestion box behind a Google login collects nothing,
// which is the whole argument in the plan's §2. It joins /api/loyalty/checkin
// as one of the very few public write paths in this app, and unlike that one
// it does not even need a signed token to get in.
//
// So the guard rails are not authentication. In order:
//
//   1. SAME-ORIGIN ONLY (Origin/Content-Type). Not because CSRF could steal
//      anything here — the worst a forged request achieves is a feedback row
//      — but because a signed-in visitor's row carries their customer_id, and
//      a submission attributed to someone who did not write it is a small lie
//      the database would then hold forever. Requiring application/json also
//      closes the simple-request hole: an HTML form can only ever send
//      text/plain, urlencoded or multipart, so a form on another site cannot
//      reach this handler at all, with or without an Origin header.
//   2. A BODY SIZE CEILING, checked before the body is read.
//   3. TWO RATE LIMITS — per IP and global. See lib/feedback/types.ts for
//      why the second one exists and what it deliberately costs.
//   4. A HONEYPOT, answered with a 200 so a script learns nothing.
//   5. THE OWNER'S SWITCH, re-read here rather than trusted from the page.
//   6. VALIDATION, in lib/feedback/validate.ts, returning the exact object
//      inserted — never the caller's own with a few fields checked.
//
// ── WHAT IS DELIBERATELY NOT STORED ──────────────────────────────────
// The IP. It is used for rate limiting and then forgotten (the `rate_limits`
// row it keys ages out within a day). A permanent record of who complained
// about what is the thing that stops people complaining, and this table has
// no security purpose that would justify one — unlike fraud_log, which does.
//
// ── ERRORS ARE CODES, NOT SENTENCES ──────────────────────────────────
// The portal is the trilingual surface. Returning Hebrew here would tell an
// Arabic-reading visitor why their message failed in a language they may not
// read; the client maps the code through lib/feedback/i18n.ts instead. This
// is also why `rateLimitResponse()` from lib/rate-limit.ts is NOT reused —
// that helper returns a fixed Hebrew sentence, which is right for every
// caller it already has and wrong for this one.

/** Comfortably above a full-length message in Hebrew (1000 characters at up
 *  to 4 bytes each) plus its envelope, and far below anything worth parsing
 *  as an attack. Checked from the header before the body is touched. */
const MAX_BODY_BYTES = 16_384

/** The hidden field. Named like something a form-filling bot wants to
 *  complete; a real visitor never sees it, cannot tab to it, and browsers are
 *  told not to autofill it (see FeedbackSheet.tsx). Anything non-empty here
 *  did not come from a person. */
const HONEYPOT_FIELD = 'company'

function refuse(code: string, status: number) {
  return NextResponse.json({ error: code }, { status })
}

export async function POST(request: NextRequest) {
  try {
    // ---- 1. Same-origin only -------------------------------------------
    // A missing Origin is allowed: browsers send it on every cross-origin
    // POST, so its ABSENCE means a same-origin or non-browser caller, and
    // refusing those would break nothing an attacker cares about while
    // breaking curl for whoever debugs this later. Its PRESENCE with the
    // wrong host is the case worth refusing.
    const origin = request.headers.get('origin')
    if (origin) {
      let originHost: string | null = null
      try { originHost = new URL(origin).host } catch { originHost = null }
      const host = request.headers.get('host')
      if (!originHost || !host || originHost !== host) return refuse('bad_request', 403)
    }

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('application/json')) {
      return refuse('bad_request', 415)
    }

    // ---- 2. Size ---------------------------------------------------------
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return refuse('message_too_long', 413)
    }

    // ---- 3. Rate limits --------------------------------------------------
    // Per-IP first: it is the one that stops the ordinary case, and failing
    // it costs one indexed upsert. Both fail OPEN if the limiter itself
    // errors (see lib/rate-limit.ts) — a rate limiter must not become a new
    // way for the feature to go down.
    const ip = clientIp(request)
    if (!(await checkRateLimit(`feedback:${ip}`, FEEDBACK_RATE_MAX, FEEDBACK_RATE_WINDOW_SECONDS))) {
      return refuse('rate_limited', 429)
    }
    if (!(await checkRateLimit('feedback:global', FEEDBACK_GLOBAL_RATE_MAX, FEEDBACK_GLOBAL_RATE_WINDOW_SECONDS))) {
      return refuse('rate_limited', 429)
    }

    const body = await request.json().catch(() => null)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return refuse('bad_request', 400)
    }

    // ---- 4. Honeypot -----------------------------------------------------
    // 200, not 400. A script that learns which of its fields gave it away
    // simply stops filling that one in; a script that thinks it succeeded
    // keeps posting into a void. Nothing is written.
    const honeypot = (body as Record<string, unknown>)[HONEYPOT_FIELD]
    if (typeof honeypot === 'string' && honeypot.trim() !== '') {
      return NextResponse.json({ ok: true })
    }

    // ---- 5. The owner's switch ------------------------------------------
    // Re-read server-side. The portal already hides the button when this is
    // off, but the button is not the security boundary — the endpoint is
    // public and its shape is in the page source, so "off" has to mean the
    // endpoint refuses, not that the UI is missing.
    if (!(await getCustomerFeedbackEnabled())) return refuse('disabled', 403)

    // ---- 6. Validation ---------------------------------------------------
    const parsed = validateFeedbackInput(body)
    if (!parsed.ok) return refuse(parsed.error, 400)

    // ---- 7. Who, if anyone --------------------------------------------
    // Resolved from the caller's OWN session, never from the body — the same
    // rule /api/customer/profile and /api/loyalty/checkin follow, and the
    // reason a forged submission can never be attributed to someone else.
    // Entirely optional: a failure here drops the link and keeps the
    // feedback, because the feedback is the point and the link is a bonus.
    let customerId: string | null = null
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: customer } = await createServiceClient()
          .from('customers')
          .select('id')
          .eq('auth_user_id', user.id)
          .maybeSingle()
        customerId = customer?.id ?? null
      }
    } catch {
      customerId = null
    }

    const { error } = await createServiceClient()
      .from('customer_feedback')
      .insert({
        category: parsed.value.category,
        message: parsed.value.message,
        contact_email: parsed.value.contactEmail,
        page_url: parsed.value.pageUrl,
        customer_id: customerId,
      })

    if (error) {
      // Logged with no message body: the row's own content is the customer's,
      // and there is no reason for it to land in a platform log as well.
      console.error('feedback insert failed:', error.code, error.message)
      return refuse('server', 500)
    }

    // Nothing is echoed back — not the row id, not the stored values. There
    // is no client-side use for either, and an id is one more thing that
    // could grow a reader later.
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('feedback route error:', err)
    return refuse('server', 500)
  }
}
