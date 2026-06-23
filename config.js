// Supabase project config for this site.
//
// The anon key is NOT a secret — it's meant to be embedded in client-side
// code like this. Access control is enforced server-side by Postgres Row
// Level Security (see supabase/schema.sql), not by hiding this key.
//
// Fill these in from your Supabase project: Project Settings -> API.
window.SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

// Which row in the `menus` table (by slug) this deployed site shows/edits.
// Multiple bars can share one Supabase project — each gets its own slug.
window.MENU_SLUG = "ayeka-bar";
