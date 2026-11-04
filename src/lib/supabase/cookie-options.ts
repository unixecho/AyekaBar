// Handed to all three Supabase clients. It only adds Secure, so the sign-in cookie can never travel over plain HTTP;
// everything else stays Supabase's default, as scripts/check-privacy.mjs pins and /cookies declares.
export const SESSION_COOKIE_OPTIONS = { secure: process.env.NODE_ENV === 'production' }
