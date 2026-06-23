// Supabase project config for this site.
//
// The anon key is NOT a secret — it's meant to be embedded in client-side
// code like this. Access control is enforced server-side by Postgres Row
// Level Security (see supabase/schema.sql), not by hiding this key.
//
// Fill these in from your Supabase project: Project Settings -> API.
window.SUPABASE_URL = "https://xdvjhhgmrmrfccgdnnja.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdmpoaGdtcm1yZmNjZ2RubmphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxOTY0NTksImV4cCI6MjA5Nzc3MjQ1OX0.sA0_nVtrm7tDBrH9HfjnxouVN43Cwgt0S74w4gtZMIo";

// Which row in the `menus` table (by slug) this deployed site shows/edits.
// Multiple bars can share one Supabase project — each gets its own slug.
window.MENU_SLUG = "ayeka-bar";
