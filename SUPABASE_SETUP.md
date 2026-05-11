# Supabase setup — Phase 1

This is a one-time setup so the app can store its data online instead of in a local file.

## Your project
- URL: `https://xyvltgegptamtlzsdjwo.supabase.co`
- Publishable key: `sb_publishable_7iJwmFOM5lUI4tOTzbYLcg_VVOS5CXF`

These are already wired into [src/main/supabaseClient.ts](src/main/supabaseClient.ts). The publishable (anon) key is safe to commit and ship in the installer — Row-Level Security in the database is what blocks unauthorized access.

## What you need to do — in order

### 1. Install the new dependency

In the project folder, run:

```
npm install
```

This installs `@supabase/supabase-js` (just added to `package.json`).

### 2. Create the tables in Supabase

1. Open https://supabase.com/dashboard/project/xyvltgegptamtlzsdjwo
2. Left sidebar → **SQL Editor** → **New query**
3. Open [supabase/schema.sql](supabase/schema.sql) in this repo, copy the whole file
4. Paste it into the SQL editor, click **Run**
5. Expected result: "Success. No rows returned."

To verify, go to **Table Editor** in the left sidebar — you should see 4 tables: `banks`, `kontrahenci`, `adresy`, `history`.

### 3. Lock down sign-up (recommended)

By default, anyone who knows your project URL can create an account. For an internal accounting tool you almost certainly want only invited users.

1. Left sidebar → **Authentication** → **Providers** → **Email**
2. Turn **OFF** "Enable Sign Ups"
3. **Save**

You'll create accounts manually in step 4.

### 4. Create user accounts

For each person who needs access:

1. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**
2. Enter their email and a temporary password
3. **Auto Confirm User**: ON (so they don't need to click an email link)
4. **Create user**

Write down each email + password — you'll give these to your users.

### 5. Confirm it's wired up

After `npm install` finishes, run:

```
npm run build:main
```

If it builds with no errors, Phase 1 is done. The Supabase client is ready, but the app still uses the local file (electron-store) — nothing has changed for end users yet.

## What's next — Phase 2

Once you confirm steps 1–5 are done, I'll:

1. Rewrite `src/main/database.ts` to read/write from Supabase instead of the local file
2. Add a login screen (shown on first launch / when session expires)
3. Add a one-time "Migrate local data → cloud" button so your existing banks/kontrahenci/adresy come along
4. Update all main-process callers (~25 sites) to `await` the now-async DB methods

That's the bigger change. We'll do it once Phase 1 is verified.
