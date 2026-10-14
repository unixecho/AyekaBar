# Staff push notifications (VAPID)

Staff get phone alerts for scheduling events (shift published, swap asked/answered, request decided, shift about to
start). The in-app inbox `schedule_notifications` doubles as the outbox: a row with `push_sent_at is null` is
pending; the sender claims rows (sets `push_sent_at`) *before* sending, so overlapping runs never double-send.

## One-time setup

1. **VAPID keys** — generate once: `npx web-push generate-vapid-keys`. Set in the deploy environment:
   * `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   * `VAPID_PRIVATE_KEY` (server only)
   * `VAPID_SUBJECT` (`mailto:` or `https:` contact)
   Without them, in-app notifications still work; push is simply skipped.
2. **Apply migrations** `054` and `055`.
3. **Tell the database where the app lives** (once, in the Supabase SQL editor):
   ```sql
   select vault.create_secret('https://<your-domain>', 'staff_push_url');
   ```
   Use the host of the **Next app** (Vercel project `ayeka-bar`, `https://www.ayeka.bar`). `staff.ayeka.bar` is the separate Vite order-management app and does not serve `/api/cron/staff-push`.
   Migration `055` creates the random bearer secret (`staff_push_cron`) in Vault itself; it never leaves the
   database and is verified by `staff_push_verify_cron()`. `CRON_SECRET` also works if you prefer an env secret.
   Until `staff_push_url` exists the tick does nothing, harmlessly.
4. Enable `pg_cron`, `pg_net` and Vault in Supabase if they are not already (055 skips scheduling where absent).

## How it runs

* Request-driven: after a dispatch writes notifications the route calls `flushStaffPush()` after the response.
* Timed: pg_cron job `staff-push` every 2 minutes → `staff_push_tick()` → `GET /api/cron/staff-push` →
  creates "shift soon" reminders (deduped by `dedupe_key`) and flushes anything pending. No Vercel cron needed.
* A subscription that answers 404/410 is deleted.

## Clients

* `public/sw.js` shows notifications (tag replaces instead of stacking; tap opens the linked `/staff/...` path only —
  absolute or protocol-relative stored links are ignored).
* `StaffPushCard` (staff dashboard, owner dashboard) asks permission and registers the phone via `/api/staff/push`
  (the person always comes from the session, never the body; https endpoints only).
* `DevPushPanel` (owner dashboard, developer badge only) sends test alerts through the real inbox + flush path.
* `public/staff-manifest.json` + icons make the staff pages installable (iOS needs the home-screen install to
  receive Web Push).

## Order alerts (remote ordering, migration 058) — a second kind of alert, and a second kind of device

Schedule alerts above go through the in-app inbox (`schedule_notifications` is also the outbox). **Customer-order
alerts do not** — they are sent directly, once, when a customer's request is created
(`POST /api/table/order` → `afterResponse(notifyStaffOfSubmission)`), and are best-effort by design: the pending request
is in the database whether or not a phone buzzed, and the POS polls it.

* **Who:** `waiter_call_recipient_staff_ids()` — the same rule as customer waiter calls (an open POS shift, a front-of-house
  title, and — once a schedule is published — assigned to a shift that covers now ±30 minutes).
* **Which device:** a person can be subscribed in two places — the portal (`app = 'portal'`, the "main saved site") and the
  POS (`app = 'oms'`, `staff.ayeka.bar`). **One is chosen per person** (`lib/push/orders-rules.ts` `chooseTargets`, TypeScript
  only): a *fresh* POS subscription (`last_seen_at` within 24 h) wins and only it is sent to; else the portal; if every
  delivery to the chosen device fails, the portal's are tried. The POS re-registers on every open and unregisters on sign-out
  (`waiter_register_push` / `waiter_unregister_push`), so "fresh" means "signed in on the POS".
* **Delivery** is `lib/push/deliver.ts` — shared with the schedule alerts: a 404/410 deletes the dead subscription; an order
  alert's TTL is **15 minutes** (a request nobody sees for an hour is worse than none).
* **Payload:** `{kind:'table-order', title, body, url, tag, vibrate, urgent}`. `vibrate` (Android; iOS ignores it) and `urgent`
  (stay on screen; `renotify` only with a tag) are optional and validated as data in both service workers. A tap opens a
  same-origin path only. The **sound** of a background notification belongs to the operating system; an open POS / staff page
  plays its own ding (`ding.ts`).
* **VAPID:** the same pair serves both origins. The POS commits the *public* half (`ayeka-staff/src/push.ts`,
  `VITE_VAPID_PUBLIC_KEY` overrides) — if you rotate the pair, update it there too.
* **iOS** delivers web push only to an app added to the Home Screen; the POS shows that instead of an impossible prompt.

## Not verifiable in CI

Real delivery to a phone, iOS install behaviour, Supabase pg_cron/pg_net/Vault in production — verify by hand after
setup: open the card on a phone, press the test button, then publish a draft week and watch the alert arrive.
