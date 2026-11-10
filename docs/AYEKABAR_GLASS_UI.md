# Ayeka Bar glass dashboard working guide

Status: **approved dashboard-home rollout**, 2026-11-10. The owner, staff, and
developer home routes now use the shared glass frame; the original private
preview remains available for comparison. Stock, checklists, full browser QA,
and inner-page visual work remain separate unfinished phases.

Release follow-up (2026-11-10): the fixed dock, personalized tool finder,
shortcuts, and real notification bell moved from the preview into the live
dashboard homes. The logo has a transparent backing. The notification setup
card is first on each home, cannot be snoozed, and disappears only after this
browser has granted permission and its push subscription is registered to the
signed-in staff member. Denied, unsupported, and iPhone browser states keep
instructions visible. The build uses Next's supported Webpack option because
the local Turbopack build crashed on Windows.

Follow-up (2026-11-10): the private preview's fixed dock expands upward into a
nearly opaque tool panel. The panel and a new "בשבילך" strip use the existing
permission-filtered tile registry; the owner's full ordered tool groups remain
below it. The finder matches Hebrew forms, English aliases and small typos,
suggests results as the person types, and accepts the leading completion with
Tab. Tool openings update per-staff use counts and last-open times in device
storage; each account has a separate key and an in-panel reset. This preview
history does not sync between devices. A future live rollout can use the
Sarcafe account-sync model after a separate schema and privacy review.

Visual revision (2026-11-07): after the first preview was rejected, the private
shell was rebuilt from Sarcafe's shipped `docs/SARCAFE_GLASS_UI.md` and
`docs/SARCAFE_GLASS_UI_STYLE.md`. It now uses Ayeka's existing bar imagery,
Sarcafe's 560px app composition, compact grouped tool rows, Glisse glass chrome,
and nearly opaque menu surfaces. The owner approved this direction on 2026-11-10.

Follow-up (2026-11-07): the preview dock and tool sheet are portalled to the
document body, so the dock stays fixed under the app's page transitions. The
language picker was removed from this Hebrew-first staff dashboard. A Glisse
bell in the top bar now reads the signed-in person's actual scheduling inbox
via `/api/staff/notifications`, with an accurate unread badge and the existing
mark-read action. It does not create sample notifications or add a new table.

## Scope and sequencing

The supplied dashboard brief requires: map the existing application, build QA,
prepare a private, usable glass preview on the same real data, obtain the
owner's approval, and only then replace dashboard screens. The owner approved
the preview on 2026-11-10 and explicitly requested production deployment.

The user's additional requirements intentionally change the previous access
policy: stock management, OMS entry points, and loyalty are developer-only
while under development. Preserve every other existing tool and its relative
order. The public portal/menu design is outside the redesign, but the public
menu and every management/OMS feature belong in regression QA.

New work includes digital stock receiving and an auditable stock ledger, a
future paid-sales-to-stock/BI connection, and Sarcafe checklists with a stronger
form builder for Kitchen, Floor, and Bar. App Store/Google Play applications
for customers, OMS, and staff/management are the **following phase**, not a
claim that the present website is store-approved.

**Owner decision, 2026-11-07:** hide OMS from staff dashboards by default and
give the developer a switch to show it when staff should use it. The switch
controls dashboard links only; the separate `staff.ayeka.bar` application's
existing direct sign-in is unchanged. Its future tablet app remains a separate
product, reachable from the later staff app. The developer switch is
`oms_staff_dashboard_enabled` in `app_settings`, default false.

## Current state — verified against source

### Repository and application boundary

- The current Next.js app is at the **repository root**, not `loyalty/`.
  `package.json` specifies Next 16.4.5 and React 19.2.0. The first auth gate is
  `src/proxy.ts`; `src/middleware.ts` is historical. `CLAUDE.md` records the
  move and upgrade; the older `AGENTS.md` path/stack descriptions are stale.
- Portal, menu, owner management, employee dashboard, and scheduler deploy as
  `ayeka.bar`. OMS is a separate Vite/React repository,
  `../ayeka-staff`, deployed at `staff.ayeka.bar`.
- Both applications use one Supabase identity/database. Shared database
  migrations belong to this repository under `supabase/migrations/`.
  `STAFF_APP.md` is the shared contract and must be updated for boundary changes.
- Existing local edits in package files, brand assets, and the security script
  are pre-existing work, not part of this preview by default.

### Roles and enforcement

| Capability | Current predicate/source | Current surface |
| --- | --- | --- |
| Active staff | Session-linked active `public.staff` row | Employee home, own schedule/payslips, eligible shift tasks |
| OP | `isOp`: `role='owner'` or `badge='owner'` | Management dashboard and owner administration |
| Menu editor | OP or `badge='general_manager'` | Editor, versions, Happy Hour |
| Floor manager | OP, general manager, or shift manager | Floor/table builder |
| Schedule manager | OP/GM or delegated staff id in venue settings | Draft/publish the schedule; delegation remains OP/GM |
| Developer | `isDev`: OP and trimmed, case-insensitive `badge='Dev'` | `/owner/dev`, feature flags, permanent staff deletion |

Sources: `src/lib/staff/access.ts`, `src/lib/waiter/access.ts`,
`src/lib/shifts/access.ts`, and their documented SQL twins. The developer
predicate currently has **no SQL twin** because it was originally a view over
OP rights, not a separate security tier.

Proxy protection is followed by page checks and route-specific API guards.
`requireOwner`, `requireMenuEditor`, and `requireDev` share
`src/lib/owner/guard.ts`; staff APIs use `src/lib/staff/guard.ts`. Google
authentication alone does not confer staff authorization. Pending invites
are claimed through the existing sign-in flow; deactivation clears the linked
auth user and must continue revoking access in both applications.

**Developer isolation gap found during mapping:**
`src/app/api/owner/staff/route.ts` currently accepts custom badge values in
POST/PATCH, including `Dev`, and lets OP users change admin roles. Hiding Dev
from `BADGE_OPTIONS` is not an authorization boundary. Before developer-only
stock, loyalty, or QA data depends on this predicate, prevent a nondeveloper
from assigning developer access, promoting an existing Dev-badged row, or
changing/reissuing an existing developer identity. Test the server route,
not merely the picker. A separately protected developer identity is also a
valid design, but it must be explicit and consistent across both apps/SQL.

### Dashboard routes and ordered content

`src/lib/dashboard/tiles.ts` is the one registry; `sectionsFor()` filters
without reordering. `DashboardSections.tsx` renders it. No second manual tool
list should be introduced for the preview or the eventual dock/tool finder.

| Route | Current content, in order |
| --- | --- |
| `/owner/dashboard` | Shared `OwnerDashboard`: four-number pulse; signals and their drill-downs; shift status; Overall view; phone alerts; Z-report status; owner categories; push test panel |
| `/staff/dashboard` | Greeting/role; shared `EmployeeDashboard`: own shift quick view; pending customer orders when present; allowed work/management tools; conditional Z-report filing tile; phone alerts |
| `/owner/dev` | Greeting; manager / employee / developer lens tabs. The first two render the **same server components** as the other homes; developer lens holds flags, schema health, and reference tools |

A developer visiting either ordinary dashboard is redirected to
`/owner/dev?view=manager` or `?view=employee`. Preserve this one-dashboard model.
`LensTabs.tsx` stores the selected lens in `?view=` with `replaceState`, not
device storage, and mounts only the active client panel.

The registry order before the requested access changes is:

| Category | Tools in exact order |
| --- | --- |
| My work | My shifts → OMS → loyalty QR → own payslips; eligible Z-report filing is appended while its window is open |
| Operations | Schedule management → floor/table map → receipts and shift sessions → daily Z archive |
| Menu and content | Menu editor → portal links → site languages → intro screen |
| Team and customers | Staff administration → loyalty administration → customer feedback → payslip administration |
| System and accessibility | Accessibility statement → audit log |
| Developer | OMS Overall/demo → Supabase reference → Vercel reference → website repository → OMS repository |

Owner home uses Operations, Menu/content, Team/customers, System/accessibility.
Employee home uses My work, Operations, Menu/content with OP/dev tools excluded.
The requested developer restrictions may hide OMS/loyalty entries, but must not
reorder remaining tools. The developer must retain a usable entry to restricted
tools even when viewing the employee lens, whose current `STAFF_EXCLUDE` removes
dev-audience tiles.

### Inner routes to preserve and cover in QA

| Area | Existing routes/features |
| --- | --- |
| Menu | `/owner/editor`: draft load/edit/save/publish; categories/items/options/prices; out-of-stock/86; versions/default/temporary menus; Happy Hour; cart switch. `/menu`: published menu, polling, language/category navigation, variants, cart/diners/rounds, remote ordering/call when enabled |
| Staff | `/owner/staff`: linked/pending/offline accounts, roles/badges, invite/reactivation/deactivation, join links, identity details, developer-only permanent deletion |
| Scheduling | `/owner/schedule`, `/owner/schedule/print`, `/staff/schedule`: draft/publish, assignments, swaps/requests, days off, settings/delegation, notifications, staff's own published schedule |
| Floor | `/owner/floor`: floor/table/prop layout, move/resize/rotate, rename/remove/restore, combined tables and layout history |
| Operational reports | `/owner/reports`: shift opening/closing and report/export; `/staff/z-report`: time/role/schedule-gated filing; `/owner/z-reports`: archive/file access |
| Loyalty | `/owner/loyalty`, `/owner/customers`, `/owner/rewards`, `/staff/loyalty`, `/customer/dashboard`, `/checkin`, `/loyalty` plus their APIs |
| Content/settings | `/owner/links`, `/owner/languages`, `/owner/intro`, `/owner/accessibility` |
| Feedback/audit | `/owner/feedback`, `/owner/audit` |
| Payroll/onboarding | `/owner/payslips`, `/staff/payslips`, `/join/[token]`: uploads, private viewer, ZIP, ownership, append-only access log, account linking/profile/tour |
| Developer | `/owner/dev`: three lenses, feature flags, schema checks, permanent staff deletion API |
| OMS (separate app) | Waiter/floor/table workflow, guest splitting and rounds, bar/kitchen station screens, ready/delivered/voided items, quick purchase/bar tabs, snooker queue, remote submissions/calls, shift state, Overall/demo view, realtime/push |

There is **no quantitative stock module or checklist/form builder** in the
current application. Menu `available=false` and 86 state are menu availability,
not receiving records, inventory balances, recipe consumption, or stock BI.
Do not describe those existing switches as a finished stock system.

### Real data and refresh behavior

- `OwnerDashboard.tsx` reads `readDashboardSignals()`,
  `readDashboardDetails()`, `readShiftStatus()`, and `readZOverview()`.
  `DashboardLive.tsx` polls `/api/owner/dashboard` every 30 seconds and on
  visibility return. Unknown counts remain unknown; empty signals render
  nothing. Never invent an "all clear" or zero after a read failure.
- `EmployeeDashboard.tsx` reads `readMyShifts(me.id)`, loyalty status,
  open-shift status, `zAccessFor()`, and `payslipsReady()`. Staff reads are
  scoped to the session's identity.
- `PendingRemoteOrders.tsx` polls `/api/staff/orders` every 10 seconds and
  catches up on foreground/push. It has an independent OMS link that must
  follow the new visibility rule too.
- `OverallViewCard.tsx` carries another OMS link and an OP-controlled demo
  toggle through `/api/owner/settings`. The signal stack also links into OMS.
  Changing only the `pos` tile would leave alternate dashboard entry points.
- Preview should use these readers and existing API write routes. Refactor
  display wrappers narrowly to allow streaming data behind Suspense; avoid
  cloning business logic or copying live values into a fixture.

### Layout, themes, chrome, and loading

- There is no shared owner layout yet. Each owner page renders its own
  `main` and `OwnerHeader`. `src/app/staff/layout.tsx` only supplies PWA/iOS
  metadata and returns children. Most homes are a centered 560px column.
- `OwnerHeader.tsx` is logo/title, optional back control, and a caller-provided
  slot (usually sign-out and a view link). Ayeka currently has **no shared
  account popover, dashboard notification bell, or branch picker**. Do not
  present Sarcafe-only controls as existing Ayeka behavior or fill them with
  fictional branches/notifications.
- The scheduler does have `NotificationsButton`/`NotificationsSheet`, fed by
  `ShiftsProvider` real notifications, with mark-read dispatch and follow-link
  behavior. Phone push preferences exist in `StaffPushCard`; this is distinct
  from an application-wide inbox and the proposed daily QA notification.
- One current dark theme is defined in `src/app/globals.css`: ember accent,
  dark surfaces, Rubik. There is no current theme switcher or light-theme
  preference. The requested dark/light preview is new, scoped to the private
  preview; map Sarcafe glass tokens to Ayeka tokens, and test real pixel
  contrast. Do not invent a pre-existing owner-selected look.
- There is no dashboard dock. The developer lens switch is a sticky custom
  tablist. A new dock must be owned by a persistent layout/host, outside the
  remounting page transition content, with its own view-transition name.
- `src/app/template.tsx` remounts for navigation; `PageTransitions` captures
  same-origin clicks. Existing `<Link>` handlers must not be relied on for
  mutation-refresh or selection behavior. New fixed chrome must use the
  `ModalPortal` pattern to avoid transformed-ancestor positioning bugs.
- `MenuEditor` already portals its fixed save/publish bar. Scheduler
  `SettingsSaveBar` is fixed in CSS and rendered inline. Both need safe-area,
  short landscape, scroll-return, and above-dock tests during their rollout.
- Existing route skeletons: root, menu, customer home, staff home, owner
  home/staff/editor/customers/rewards/loyalty/links/schedule. Other owner/staff
  routes do not currently have their own `loading.tsx`.
- `next.config.mjs` has security headers but no `experimental.staleTimes`
  configuration. Add honest post-write/foreground refresh behavior together
  with any new client router retention; do not cache private responses publicly.

## Preview implementation plan

1. Build the QA foundation and feature/route inventory before changing live
   dashboard screens. Use a local stand-in database with synthetic people,
   real migration/rule execution where applicable, and distinct reports for
   management/public menu and the separate OMS. Production is never a test
   target. See `docs/QA_BLUEPRINT.md` as it is created.
2. Port the actual Sarcafe glass primitives and their documented fixes, pinned
   to `glisse@0.5.0`. Reference checkout: `C:\Users\Johnathan\Desktop\sarcafe`;
   guides: `docs/SARCAFE_GLASS_UI.md` and `docs/SARCAFE_GLASS_UI_STYLE.md`.
   Preserve cheap static surfaces, nearly opaque menus, RTL wrappers, reduced
   motion, safe areas, and meaningful known-number badges.
3. Add unlinked, noindex, private owner/staff preview routes with the same
   active-session/role rules as their real pages. Use the existing readers,
   registry, mutation APIs, and real notification sources. Show the preview
   label and a return-to-current-dashboard action. Missing capabilities are
   explicitly disabled with the brief's preview wording, never fake successes.
4. During the preview phase, keep the public interface and live dashboard default unchanged. Scope
   light/dark variables and CSS so no public page inherits them. The
   new requested authorization restrictions are a separate, reviewable
   behavior change, not an accidental consequence of the restyle.
5. Check role matrices, every link/tool, desktop/phone, dark/light, Hebrew/Arabic
   RTL and English LTR, 30+ notification rows, keyboard/focus, realistic iPhone
   insets, dock identity, skeleton timing, failed/slow/recovered data, and pixel
   contrast. Include 280px Fold and short landscape in addition to the brief's
   360/768/1280 widths. Reports must distinguish pass/fail/flaky/skipped.
6. Provide preview links and phone/desktop screenshots, with explicit actual
   data/authentication status, then wait for the owner to approve the preview
   as the supplied brief requires. Approval arrived 2026-11-10; the three home
   routes followed. Inner pages remain a later visual phase.

### Real-data preview authentication constraint

The preview must be an actual signed-in session. A service key must never be
used to impersonate an owner in a browser, and a synthetic QA account does not
turn a test database into "real data." Local `npm run dev` prefers the existing
development-local Supabase configuration; without that local database,
settings may silently fall back to defaults. Verify the effective target
without printing credentials before calling any screenshot a real-data preview.

Google OAuth callbacks must be allowed for the preview origin, and a production
browser session is not automatically a localhost/preview session. If no
authenticated preview session exists, finish the guarded preview and synthetic
QA, identify that verification limit, and have the developer sign in normally.
Never weaken a guard, forge a cookie, copy a production token, or label fixture
screenshots as real-data approval evidence.

## Developer-only rollout checklist

- Define one authoritative developer predicate and prevent ordinary owner
  roster changes from granting it. Deny forged role/badge/request-body input.
- Gate stock pages/APIs before implementing stock writes. Stock movements,
  receipt posting, deduplication and future sale consumption must be atomic
  database operations with an audit history, not client read-then-write math.
- Loyalty requires coverage at navigation, protected pages, owner APIs,
  customer profile/check-in/redemption/QR APIs, and any directly readable
  database surface. An OP-controlled `loyalty_enabled=true` must not bypass the
  temporary developer restriction. Preserve privacy deletion requirements
  when deciding which old customer self-service actions remain available.
- Hide all nondeveloper OMS dashboard doors, including Overall view, pending
  orders, signal links, onboarding tour links, and ordinary tiles. Resolve the
  standalone OMS decision before changing its sign-in/RLS behavior.
- If standalone access is narrowed, update its auth gate and specific OMS
  tables/RPCs together. Do not redefine shared `is_staff_client()` indiscriminately:
  floor editing, schedule access and other valid staff features also depend on
  shared identity/helpers.
- Distinguish real 401/403 from identity/database failure (503) and keep private
  responses `no-store`. Existing guards currently collapse query failures
  into unauthorized/forbidden; the survival suite must catch this.
- No migration is applied to production merely by being drafted or passing QA.
  Follow the repository's per-migration review/apply rule after the concrete SQL
  and test evidence are ready.

## Implementation record

2026-11-07: source inventory, private glass preview routes, off-by-default OMS
dashboard switch, and QA baseline created on the working branch. No migration
was applied and no deployment or external notification was sent. Real signed-in
preview, screenshots, and approval were pending at that date.

2026-11-10: the owner approved the visual preview and requested production.
The same frame now serves owner, employee, and developer dashboard homes. The
notification setup card is prominent until permission and registration are
active; it cannot be dismissed or snoozed. The logo backing is transparent.
Stock and checklist work, broader access hardening, and full browser QA remain
open and are not represented as complete by this dashboard release.
