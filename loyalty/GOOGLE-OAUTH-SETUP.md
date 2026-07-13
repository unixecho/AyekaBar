# Auth setup — loyalty app

Two distinct sign-in models, enforced in code:

- **Customers → Google only.** `/customer` offers Google and nothing else.
  No email/password self-signup.
- **Staff → manual accounts.** `/staff` is email + password / magic-link for
  accounts **you create by hand** in Supabase. Access is granted by a row in
  `public.staff` (middleware bounces anyone without one to `/`).

Project ref: **`xdvjhhgmrmrfccgdnnja`**
Supabase callback URL (paste into Google): 
`https://xdvjhhgmrmrfccgdnnja.supabase.co/auth/v1/callback`

---

## 1. Google Cloud Console

Using your existing OAuth Web client:

- **Authorized redirect URIs** → add exactly (Supabase's callback, *not* the app's):

  ```
  https://xdvjhhgmrmrfccgdnnja.supabase.co/auth/v1/callback
  ```

- **Authorized JavaScript origins** → add the app origins:
  - `http://localhost:3000` (dev)
  - `https://<deployed-domain>` (production, once known)
- OAuth consent screen: app name "אייכה בר", scopes `email` + `profile` (defaults).

Copy the **Client ID** and **Client Secret**.

## 2. Supabase → Authentication → Providers

- **Google**: enable, paste the Client ID + Client Secret from step 1, save.
- **Email**: keep **enabled** (staff sign in with it), but under its settings
  turn **"Allow new users to sign up" OFF**. This is what makes customers
  Google-only at the platform level — the app UI already hides email signup,
  and this stops anyone crafting an email signup via the API. You still add
  staff yourself via Auth → Users → Add user (admin create bypasses the
  signup toggle).

## 3. Supabase → Authentication → URL Configuration

- **Site URL**: `http://localhost:3000` for now (swap to the production URL at
  deploy).
- **Redirect URLs** (allowlist) — add:
  - `http://localhost:3000/**`
  - `https://<deployed-domain>/**` (at deploy)

## 4. Apply the staff migration + seed accounts

Run `supabase/migrations/002_staff_roles.sql` in the SQL Editor. Then for each
staff member:

1. Auth → Users → **Add user** (email + password). Copy their **User UID**.
2. SQL Editor:
   ```sql
   insert into public.staff (auth_user_id, role) values ('<uid>', 'owner'); -- you
   insert into public.staff (auth_user_id, role) values ('<uid>', 'staff'); -- others
   ```

Without a `public.staff` row, a signed-in user cannot open `/staff/dashboard`
(and only `role='owner'` opens `/owner/dashboard`). Fails closed by design.

## 5. Env (`loyalty/.env.local`, gitignored)

URL + anon key are already filled with the real (public) values. Paste the
**service role key** (Supabase → Project Settings → API → `service_role`,
secret) over the placeholder:

```
NEXT_PUBLIC_SUPABASE_URL=https://xdvjhhgmrmrfccgdnnja.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<already set>
SUPABASE_SERVICE_ROLE_KEY=<paste secret>
```

For production (Vercel or similar — this Next.js app can't run on GitHub
Pages), set the same three vars in the host's env settings.
