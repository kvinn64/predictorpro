-- ============================================================================
--  PredictorPro — Supabase database setup  (PRIVATE per-user version)
--  Run in your Supabase project: SQL Editor -> New query -> paste -> Run.
--  Every row is owned by a user; users can only ever see their own data.
-- ============================================================================

-- Each user's own cache of each day's fixtures
create table if not exists fixtures (
  user_id uuid references auth.users(id) on delete cascade,
  date_key text not null,
  data jsonb not null,
  updated_at timestamptz default now(),
  primary key (user_id, date_key)
);

-- Each user's own full predictions, keyed by match id
create table if not exists predictions (
  user_id uuid references auth.users(id) on delete cascade,
  match_id text not null,
  data jsonb not null,
  updated_at timestamptz default now(),
  primary key (user_id, match_id)
);

-- Each user's logged actual results
create table if not exists results (
  user_id uuid references auth.users(id) on delete cascade,
  match_id text not null,
  actual text not null,
  primary key (user_id, match_id)
);

-- Per-user daily API usage (safety ceiling; written by the server only)
create table if not exists usage (
  user_id uuid references auth.users(id) on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (user_id, day)
);

-- ---------- Row Level Security: everything is private to its owner ----------
alter table fixtures    enable row level security;
alter table predictions enable row level security;
alter table results     enable row level security;
alter table usage       enable row level security;

-- fixtures: owner only
create policy "own fixtures select" on fixtures for select to authenticated using (auth.uid() = user_id);
create policy "own fixtures insert" on fixtures for insert to authenticated with check (auth.uid() = user_id);
create policy "own fixtures update" on fixtures for update to authenticated using (auth.uid() = user_id);
create policy "own fixtures delete" on fixtures for delete to authenticated using (auth.uid() = user_id);

-- predictions: owner only
create policy "own preds select" on predictions for select to authenticated using (auth.uid() = user_id);
create policy "own preds insert" on predictions for insert to authenticated with check (auth.uid() = user_id);
create policy "own preds update" on predictions for update to authenticated using (auth.uid() = user_id);
create policy "own preds delete" on predictions for delete to authenticated using (auth.uid() = user_id);

-- results: owner only
create policy "own results select" on results for select to authenticated using (auth.uid() = user_id);
create policy "own results insert" on results for insert to authenticated with check (auth.uid() = user_id);
create policy "own results update" on results for update to authenticated using (auth.uid() = user_id);
create policy "own results delete" on results for delete to authenticated using (auth.uid() = user_id);

-- usage: NO client policies. RLS on + no policy = clients can't read or write it.
-- Only the server (service role) touches this table, and service role bypasses RLS.
