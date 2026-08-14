-- ============================================================
-- Ayeka Bar — item-level modifiers/options: what a waiter actually chose
-- (pasta sauce, hookah flavor, …) beyond the existing price-variant split.
--
-- PLAN_OMS_V2.md §"Shared foundation: item options" + item 4/6. Additive
-- and orthogonal to the existing price-string variant mechanism
-- (toVariants() in ayeka-staff/src/menu.ts) — that mechanism stays exactly
-- as it is (beer size, wine glass/bottle, cocktail single/pitcher all keep
-- working unchanged). This column is for choices a price split cannot
-- express: same-priced named options with no size/quantity meaning.
--
-- The menu side needs NO migration — menus.draft/published is schemaless
-- JSONB, so an item's new optional `options` array is a content change in
-- the editor, not a schema change here.
-- ============================================================

alter table public.waiter_order_items
  add column if not exists selected_options jsonb not null default '[]'::jsonb;

comment on column public.waiter_order_items.selected_options is
  'Snapshot of chosen option-group choices at order time, e.g.
   [{"groupId":"sauce","choiceId":"pesto","label":{"he":"פסטו","en":"Pesto"}}].
   Snapshotted like name_he/variant/unit_agorot — a later menu edit must
   never rewrite what was actually sold. Empty array, not null, when the
   item carries no options (the common case today).';
