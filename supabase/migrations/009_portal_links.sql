-- ============================================================
-- Ayeka Bar — Portal link destinations (owner-editable)
-- Apply in Supabase SQL Editor after 008_atomic_redeem.sql.
--
-- The portal's external buttons (Instagram, review, navigate — Google/Waze/
-- Apple Maps) were hardcoded in Portal.tsx. Moving them into app_settings
-- (same pattern as `loyalty_enabled`, see 007_app_settings.sql) lets the
-- owner fix a wrong link from /owner/dashboard without a code deploy.
--
-- Public read (the signed-out portal renders these buttons), service-role
-- write (owner-gated API).
-- ============================================================

insert into public.app_settings (key, value, is_public)
values (
  'portal_links',
  jsonb_build_object(
    'instagram', 'https://www.instagram.com/ayeka_bar/',
    'review', 'https://www.google.com/search?sca_esv=bf5b70d178609590&si=APenkKm7iecQ4G6P-TsbSMFKIQtv3EFIqRAFw-i8uEbk55Z-_7KuVymh7UmzzptLxAMIed7ULsObX2FBkuw7nT2KAF8MiqFu6xqzwWnw0NKO515Um1Z0Z8-i9F5axbTKJbSaHBIaHv9J&q=%D7%90%D7%99%D7%99%D7%9B%D7%94+Reviews&sa=X#',
    'gmaps', 'https://maps.app.goo.gl/RkQKuohRE2WnxehDA',
    'waze', 'https://waze.com/ul/hsvbbtt1nb',
    'amaps', 'https://maps.apple/r/I8JK.APxMAXYhS'
  ),
  true
)
on conflict (key) do update set is_public = true;
