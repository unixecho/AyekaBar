-- ============================================================
-- Ayeka Bar — Portal review wall + Facebook link (owner-editable)
-- Apply in Supabase SQL Editor after 017_temp_menu_versions.sql.
--
-- Two changes, both in app_settings (same pattern as 007/009/013):
--
-- 1. `portal_reviews` — the quotes behind the portal's review wall. Curated by
--    the owner rather than synced from Google: the Places API caps at five
--    reviews per place and forbids storing them, and scraping the listing is
--    bot-blocked, so neither can produce the 10-15 quotes the wall is built
--    for. Seeded here from the Maps listing as read on 2026-08-10
--    (4.4 stars over 38 reviews).
--
-- 2. `portal_links` gains `facebook`. NOTE this seed is tidiness, not a
--    prerequisite: getPortalLinks() and the owner PATCH both merge over
--    PORTAL_LINKS_DEFAULT in code, so the portal renders the Facebook button
--    correctly even if this file is never applied, and the row self-heals on
--    the owner's next save. `review` is also repointed at the listing's CID —
--    the old google.com/search URL carried a session-scoped `sca_esv` token
--    that would eventually rot.
--
-- Both keys are public-read (the signed-out portal renders them) and
-- service-role write (owner-gated API).
--
-- Reviews 5-8 have no author on purpose: those quotes arrived without
-- attribution, and inventing a name for a real customer's words is not
-- something to guess at. The owner fills them in from /owner/dashboard.
-- ============================================================

-- 1. Review wall ---------------------------------------------------------

insert into public.app_settings (key, value, is_public)
values (
  'portal_reviews',
  jsonb_build_object(
    'rating', 4.4,
    'count', 38,
    'url', 'https://maps.google.com/?cid=8772973758950612975',
    'items', jsonb_build_array(
      jsonb_build_object(
        'id', 'levi-avgil', 'author', 'Levi Avgil', 'stars', 5,
        'lang', 'he', 'date', '2026-05', 'visible', true,
        'text', 'המלצר/בעלים/ברמן ממש אדיב ונחמד ישב איתנו דאג שיהיה לנו הכי טוב שאפשר אין מילים באמת רמה גבוהה של שירות ואוכל'
      ),
      jsonb_build_object(
        'id', 'rafael-lavi', 'author', 'רפאל לביא', 'stars', 5,
        'lang', 'he', 'date', '2026-01', 'visible', true,
        'text', 'מקום מעוצב בצורה מאוד יפה תפריט עשיר ומאוד טעים! מומלץ.'
      ),
      jsonb_build_object(
        'id', 'aviad-adani', 'author', 'אביעד עדני', 'stars', 5,
        'lang', 'he', 'date', '2026-06', 'visible', true,
        'text', 'אווירה ממש מעולה ממליץ בחום!'
      ),
      jsonb_build_object(
        'id', 'maor-refael', 'author', 'Maor Refael', 'stars', 5,
        'lang', 'he', 'date', '2026-04', 'visible', true,
        'text', 'תמיד כיף לשבת אווירה טובה אוכל טוב ושירות מעולה☝️'
      ),
      jsonb_build_object(
        'id', 'bar-metoraf', 'author', '', 'stars', 5,
        'lang', 'he', 'date', '', 'visible', true,
        'text', 'בר מטורף בצפון חוויה ואווירה כיפית ברמות!!! אוכל חלבי מדהים וטעים מאוד והכי חשוב כשר ברמה גבוהה ממליצה בחום🫶'
      ),
      jsonb_build_object(
        'id', 'madhim', 'author', '', 'stars', 5,
        'lang', 'he', 'date', '', 'visible', true,
        'text', 'מדהים. אוכל וואו, מיקום ונראות וואו, שירות מדהים, אווירה טובה, מקום יפיפיה, מחירים ממש נגישים. המסעדה היחידה הטובה בחריש סוף סוף'
      ),
      jsonb_build_object(
        'id', 'leyad-habait', 'author', '', 'stars', 5,
        'lang', 'he', 'date', '', 'visible', true,
        'text', 'איזה כיף שיש אתכם ממש ליד הבית ❤️'
      ),
      jsonb_build_object(
        'id', 'beer-next-door', 'author', '', 'stars', 5,
        'lang', 'en', 'date', '', 'visible', true,
        'text', 'A great place to sit down for a beer next to the house!'
      )
    )
  ),
  true
)
on conflict (key) do update set is_public = true;

-- 2. Facebook link + CID-based review link -------------------------------
-- Merge into the existing row rather than replacing it, so `instagram`,
-- `gmaps`, `waze` and `amaps` keep whatever the owner has saved — they are not
-- named on the right-hand side, so `||` leaves them untouched.
--
-- The two keys that ARE named are overwritten (in `a || b`, b wins). That is
-- intended for both: `facebook` is new, and `review` is deliberately repointed
-- off the stale search URL seeded in 009. If the owner has since customised
-- `review`, this clobbers it — check the row before applying if unsure.

update public.app_settings
set value = value
          || jsonb_build_object('facebook', 'https://www.facebook.com/p/%D7%90%D7%99%D7%99%D7%9B%D7%94-61568228073670/')
          || jsonb_build_object('review', 'https://maps.google.com/?cid=8772973758950612975'),
    is_public = true
where key = 'portal_links';
