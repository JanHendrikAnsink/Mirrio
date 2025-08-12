# Mirrio — Next.js + Supabase (files only)

These are drop-in files to switch the demo from localStorage to Supabase.

## Env (.env.local)
Already populated in this bundle:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- ADMIN_TOKEN

> ⚠️ For production, rotate keys regularly and prefer server-side Service Role keys for admin tasks. Avoid committing `.env.local` to git.

## Files
- app/layout.tsx — App shell.
- app/page.tsx — UI & client logic (auth, groups, rounds, votes, comments).
- lib/supabaseClient.ts — Supabase client.
- app/api/admin/statements/route.ts — Admin endpoints secured by `x-admin-token`.

## Supabase RPCs expected
- `my_groups()`
- `create_group(p_name text)`
- `issue_new_statement(p_group_id uuid)`
- `maybe_close_round(p_gs uuid)`

Set Vercel build to include `.env.local` values or add them as Project Env Vars.
