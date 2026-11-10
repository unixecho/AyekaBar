# Ayeka Bar QA scope and current status

`npm run qa` runs typechecking, a production build, every local check/verify script that can run without a local Supabase server, and the separate OMS repository's check scripts. It writes `qa/reports/portal.{json,md}` and `qa/reports/oms.{json,md}`. Every result includes a Hebrew description, expected and actual result, status, and duration. The runner uses Node directly so it works on Windows without relying on `spawn npm`.

`npm run qa:baseline` runs the existing checks while the complete suite is under construction. **The complete `qa` command deliberately returns failure while required browser, security, stock, checklist, and recovery tests are missing.** Skipped tests are named in the reports, never converted into passes. `check-isolation` and `check-workflow` require a local Supabase server; the runner records this requirement and does not point them at production.

Required final stages, following Sarcafe's `docs/QA_BLUEPRINT.md`: static checks (types, migrations, SQL privileges/RLS, secrets, API guards, dependency audit); every regression script; pure unit rules; signed-out and role-specific API security against a running stand-in; feature journeys; Playwright browser checks; database failure, slowdown and recovery. The reports need each assertion's expected/actual values, flaky retry status, browser screenshots for failures, category pass rates and comparison with the previous run. The current legacy scripts report only a process-level outcome; their internal assertions must be surfaced individually before the extensive report is complete.

The stand-in must contain realistic dated menu, staff, shift, OMS, stock, and checklist data. No QA run may write to production. Separate `portal` and `oms` reports cover the two applications. A complete implementation also needs a GitHub workflow after push and overnight, OIDC-restricted report ingestion, developer-only report history, one 07:00 Israel notification including missing-report failures, and 30-day JSON/Markdown retention. None of those are currently marked complete.

## Required feature matrix

| Area | Scenarios that must be proved end to end |
| --- | --- |
| Public menu | Server first paint, publish refresh, categories, HE/EN/AR and RTL/LTR, prices/variants/options, Happy Hour, 86 status, cart quantities/diners/rounds, remote-order and waiter-call switches |
| Management dashboard | Every ordered tool in `src/lib/dashboard/tiles.ts`, four stats, signals/drilldowns, shift view, Z report, notification volume, developer/manager/employee lenses, polling and off/default states |
| Owner operations | Menu editor load/save/publish; versions, temporary menus, availability; staff invites/roles/deactivation; schedule/availability/requests; floor layout/history; shift sessions, receipts/Z archive; feedback, payslips, links, languages, intro, accessibility, audit and developer controls |
| OMS | All waiter, bar and kitchen flows; tables/guests/splitting; tickets/status; bar tabs/quick purchase; queue, remote orders/calls, notifications, reconnect and role boundaries |
| Stock | Supplier receipts, units/conversions, atomic movements, counts, adjustment/waste, dedupe, recipe mapping, future paid-sale deduction/refund exactly once, BI reconciliation |
| Checklists | Kitchen/Floor/Bar form builder, fields/validation/ranges, drafts, versioned publication, preview, assignment, completion, immutable history, concurrency and duplicate submission |
| Security and survival | Anonymous/customer/staff/GM/owner/developer/deactivated access, private caching, origin/body controls, RLS/grants, redaction, outage/slow/recovery |
| Browser | 360/768/1280px and iPhone safe areas, all looks and languages, contrast on real pixels, keyboard/focus/reduced motion, long notification lists, stable dock and immediate skeleton |

The real-data glass preview is a separate human acceptance gate. Automated tests use only the stand-in. The preview uses the existing signed-in data readers and must be checked by the owner before live dashboard screens are restyled.
