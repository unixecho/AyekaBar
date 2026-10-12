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

## Not verifiable in CI

Real delivery to a phone, iOS install behaviour, Supabase pg_cron/pg_net/Vault in production — verify by hand after
setup: open the card on a phone, press the test button, then publish a draft week and watch the alert arrive.
