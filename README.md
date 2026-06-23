# PredictorPro — deploy guide (Vercel + Supabase)

A private AI football predictor for you and a few invited friends. Sign-in required
(email link or Google), predictions powered by Claude Opus 4.8, with fixtures,
predictions and accuracy synced across everyone's devices via Supabase.

---

## What you'll set up (~30 min, no coding)

1. **Anthropic** — API key (powers predictions)
2. **Supabase** — free database + sign-in (Google / email)
3. **GitHub** — holds the code
4. **Vercel** — hosts it, holds your secret keys
5. **Your phone** — install to home screen

You need free accounts at Anthropic Console, Supabase, GitHub, and Vercel.

---

## Step 1 — Anthropic API key

1. https://console.anthropic.com -> Settings -> API Keys -> Create Key. Copy `sk-ant-...`.
2. Add a little credit under Billing (e.g. $5). The API is pay-as-you-go and SEPARATE
   from Claude Pro — Pro credits don't apply. Each prediction is a few cents; caching
   plus the per-user daily limit keep it cheap.

---

## Step 2 — Supabase project + database

1. https://supabase.com -> New project. Pick a name + strong DB password. Wait ~2 min.
2. Sidebar -> SQL Editor -> New query. Open `supabase-setup.sql` from this project,
   paste the whole thing, click Run. This creates the tables + security rules.
3. Sidebar -> Project Settings -> API. Copy these three (needed in Step 4):
   - Project URL (e.g. https://abcd.supabase.co)
   - anon public key
   - service_role key  (SECRET — server only)

### Turn on sign-in methods
4. Sidebar -> Authentication -> Providers.
   - Email is on by default (magic sign-in link). Ready to go.
   - Google: toggle on. You'll need a Google OAuth client ID + secret from Google Cloud
     Console (Create credentials -> OAuth client ID -> Web application). Put the callback
     URL Supabase shows into Google's "Authorized redirect URIs", then paste Google's
     client ID + secret back into Supabase. You can skip Google at first and use email.
5. Sidebar -> Authentication -> URL Configuration. Set Site URL to your Vercel URL once
   you have it (Step 4), e.g. https://predictorpro-xxxx.vercel.app . Sign-in links
   redirect back here.

### Invite-only (keep it to your friends)
6. Authentication -> Providers -> Email -> disable "Allow new sign-ups", then add each
   friend under Authentication -> Users -> Add user. Only people you add can get in.
   (Skip if you're fine with anyone who has the link signing up.)

---

## Step 3 — Put the code on GitHub

1. Create a repo at https://github.com/new -> name `predictorpro` -> Create.
2. Click "uploading an existing file" and drag in everything from this project
   (src/, api/, public/, index.html, package.json, vite.config.js,
   supabase-setup.sql, .gitignore, README.md). Commit.

---

## Step 4 — Deploy on Vercel + paste keys

1. https://vercel.com -> sign in with GitHub -> Add New… -> Project -> import predictorpro.
2. Vercel auto-detects Vite. Open Environment Variables and add ALL of these:

   ANTHROPIC_API_KEY            = your sk-ant-... key
   SUPABASE_URL                 = your Supabase Project URL
   SUPABASE_SERVICE_ROLE_KEY    = the service_role key (secret)
   VITE_SUPABASE_URL            = same Project URL (exposed to browser — fine)
   VITE_SUPABASE_ANON_KEY       = the anon public key
   DAILY_SAFETY_CEILING         = 10   (abuse stop only; main limit is pre-match-only)

   The VITE_ ones are public by design (the anon key is safe in the browser; your
   database rules protect the data). The other three are server-only secrets.
3. Deploy. ~1 min later you get your URL.
4. Back in Supabase -> Authentication -> URL Configuration, set Site URL to that Vercel
   URL (Step 2.5). Without this, sign-in links won't return to your app.

Open the URL -> sign-in screen -> log in -> the app loads.

---

## Step 5 — Install on your phone

- iPhone (Safari): open URL -> Share -> Add to Home Screen.
- Android (Chrome): open URL -> menu -> Add to Home Screen / Install app.

---

## How it all fits together

- Sign-in is handled entirely by Supabase — no passwords ever touch your code.
- Everything is PRIVATE per account: your fixtures, your predictions, your results. When
  you analyze a match, that prediction is yours alone — nobody else sees it, and each
  account builds its own private history. (Trade-off: two friends analyzing the same match
  run two separate Opus calls. Re-opening YOUR OWN analyzed match is free — it's cached.)
- Pre-match only: a match can be analyzed only before kickoff. Once it has started, the
  card locks (greyed out, no new analysis) — you can't spend a call on a game in progress.
  You can still log its final score afterward from the Stats tab.
- Day rollover: the default view stays on today until ALL of today's matches have kicked
  off, then it automatically moves to tomorrow. (Tapping a date tab navigates freely.)
- Token cost is kept low: the fixtures list only fetches team names + kickoff times (cheap),
  and the heavy Opus reasoning runs only when you tap a specific upcoming match.
- Safety ceiling: a generous per-user daily cap in the server stops runaway abuse, but the
  real limiter is simply that you can only analyze matches that haven't started yet.

---

## Troubleshooting

- "Not signed in" / predictions fail: auth token isn't reaching the server. Confirm the
  SUPABASE_* env vars are set in Vercel, then redeploy.
- Sign-in link opens but doesn't log in: Site URL in Supabase doesn't match your Vercel
  URL. Fix in Authentication -> URL Configuration.
- "Daily safety limit reached": you hit the abuse-stop ceiling. Raise DAILY_SAFETY_CEILING
  in Vercel + redeploy if needed (normal use rarely reaches it).
- Google button errors: the redirect URI in Google Cloud must exactly match the one
  Supabase gives you. Easiest: use email sign-in first, add Google later.
- Changed an env var: you must REDEPLOY for it to take effect (Deployments -> ... -> Redeploy).

---

## IMPORTANT — keep this private and honest

Built for you and people you personally invite. It produces AI reasoning over web search
— NOT a betting edge. No model, Opus included, reliably beats bookmakers or chance on
scorelines. Keep it as entertainment among friends; don't charge for the predictions or
market it as a winning tipster service, and never bet money you can't afford to lose.

---

## Per-match access tokens (you control who can analyze)

Each new analysis requires a single-use token that YOU issue. Tapping a match
shows a token box; the server checks it before spending any API call, and the
token is consumed on first successful use.

### The match_id format
Tokens are tied to a match by its `match_id`, which the app builds as:

    <date>__<Home>__<Away>      with spaces replaced by underscores

Example: for Argentina vs Austria on 2026-06-23 the id is
`2026-06-23__Argentina__Austria`. (Date is YYYY-MM-DD; team names exactly as
they appear in the fixtures list.)

### Issue a token
In Supabase: Table Editor -> match_tokens -> Insert row:
- token    = any code you make up (e.g. `ARG-AUS-7Q2`)
- match_id = the id above
- note     = optional (e.g. who it's for)
Leave used_by / used_at empty. Hand the token to the person.

### Revoke / reuse
- Revoke an unused token: delete its row.
- See if it was used: the used_by / used_at columns fill in after redemption.
- Single-use by design: once used it won't work again. To allow another
  analysis of the same match, insert a new token row.

Tip: if a prediction call fails (model/format error), the token is automatically
released so it isn't wasted.
