-- ============================================================
-- Ayeka Bar — audit vocabulary for the 86 list
-- Apply in Supabase SQL Editor after 050_customer_feedback.sql.
--
-- OPTIONAL, and the feature works without it. Taking an item off the menu
-- (86), bringing it back, and deleting it for good from the 86 list all write
-- to the audit log through logAudit(), which swallows failures by design ("a
-- missing log line is better than a change that appears to have failed"). Until
-- this file runs, menu_audit's CHECK rejects those three action names, so the
-- changes happen but the audit page does not list them. Running this makes the
-- log show who 86'd what — the question the owner will actually ask.
--
-- Same shape as 048 §9: the full list restated, not a diff, so this file is a
-- complete statement of the intended end state. Nothing is dropped from it.
-- No table or data changes; the 86 list itself lives in app_settings under
-- the key `menu_86` (private — is_public stays false) and needs no migration.
-- ============================================================

alter table public.menu_audit drop constraint if exists menu_audit_action_check;
alter table public.menu_audit
  add constraint menu_audit_action_check
  check (action in (
    'menu.save',
    'menu.publish',
    'menu.archive',         -- new: item or category taken off the menu (86)
    'menu.restore',         -- new: brought back from the 86 list
    'menu.purge',           -- new: deleted for good from the 86 list
    'variant.create',
    'variant.update',
    'variant.delete',
    'variant.activate',
    'variant.default',
    'happy_hour.update',
    'menu_cart.update'
  ));
