-- ███ PokéDraft database schema ███
-- Paste this whole file into your Supabase project's SQL Editor and click "Run".
-- Safe to run more than once.

-- ── Tables ────────────────────────────────────────────────────────
create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  admin_token uuid not null,
  budget int not null default 100,
  nomination_mode text not null default 'admin',
  pool jsonb not null default '{}'::jsonb,  -- { "<monId>": "<tier>" }
  status text not null default 'lobby',     -- lobby | drafting | done
  ruleset text not null default '',         -- e.g. "VGC 2025 Reg I · Tera"
  tier_values jsonb not null default '{}'::jsonb,  -- { "<tier>": <points> }
  team_size int not null default 6,         -- max Pokémon per coach
  tournament jsonb,                         -- bracket state (null until created)
  battle_format text not null default 'doubles',  -- singles | doubles
  created_at timestamptz not null default now()
);
-- If the table already existed before these columns were added:
alter table leagues add column if not exists ruleset text not null default '';
alter table leagues add column if not exists tier_values jsonb not null default '{}'::jsonb;
alter table leagues add column if not exists team_size int not null default 6;
alter table leagues add column if not exists tournament jsonb;
alter table leagues add column if not exists battle_format text not null default 'doubles';

create table if not exists coaches (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  name text not null,
  color text not null default '#d9594c',
  is_admin boolean not null default false,
  team jsonb,                               -- battle sets the coach built (null until built)
  created_at timestamptz not null default now()
);
alter table coaches add column if not exists team jsonb;

create table if not exists lots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  mon_id int not null,
  status text not null default 'active',    -- active | sold | passed
  winner_coach_id uuid references coaches(id) on delete set null,
  final_price int,
  created_at timestamptz not null default now()
);

create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  lot_id uuid not null references lots(id) on delete cascade,
  coach_id uuid not null references coaches(id) on delete cascade,
  amount int not null,
  created_at timestamptz not null default now()
);

-- ── Battles (Stage 3) ─────────────────────────────────────────────
-- A battle is fully described by its two packed teams + a seed + the ordered
-- list of player choices (battle_choices). Every client replays the engine
-- locally to render — no central referee.
create table if not exists battles (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  format text not null default 'doubles',   -- singles | doubles
  p1_coach_id uuid references coaches(id) on delete set null,
  p2_coach_id uuid references coaches(id) on delete set null,
  p1_name text not null default 'P1',
  p2_name text not null default 'P2',
  p1_team text not null,                     -- packed Showdown team
  p2_team text not null,
  seed jsonb not null default '[]'::jsonb,   -- PRNG seed so all clients agree
  status text not null default 'active',     -- active | done
  winner text,                               -- coach name, 'tie', or null
  created_at timestamptz not null default now()
);

create table if not exists battle_choices (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references battles(id) on delete cascade,
  side text not null,                        -- p1 | p2
  seq int not null,                          -- per-side index (prevents double-submit)
  choice text not null,                      -- e.g. "move 1", "switch 3", "default"
  created_at timestamptz not null default now(),
  unique (battle_id, side, seq)
);

create index if not exists idx_coaches_league on coaches(league_id);
create index if not exists idx_lots_league on lots(league_id);
create index if not exists idx_bids_lot on bids(lot_id);
create index if not exists idx_battles_league on battles(league_id);
create index if not exists idx_battle_choices_battle on battle_choices(battle_id, created_at);

-- ── Realtime (push changes to every connected client) ─────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='lots') then
    alter publication supabase_realtime add table lots; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='bids') then
    alter publication supabase_realtime add table bids; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='coaches') then
    alter publication supabase_realtime add table coaches; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='leagues') then
    alter publication supabase_realtime add table leagues; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='battles') then
    alter publication supabase_realtime add table battles; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='battle_choices') then
    alter publication supabase_realtime add table battle_choices; end if;
end $$;

-- ── Row Level Security ────────────────────────────────────────────
-- This is a casual friends app with no login, so the anon key is allowed
-- public access. Anyone with the league code can read/write that room.
alter table leagues enable row level security;
alter table coaches enable row level security;
alter table lots    enable row level security;
alter table bids    enable row level security;
alter table battles enable row level security;
alter table battle_choices enable row level security;

drop policy if exists p_leagues_all on leagues;
drop policy if exists p_coaches_all on coaches;
drop policy if exists p_lots_all    on lots;
drop policy if exists p_bids_all     on bids;
drop policy if exists p_battles_all  on battles;
drop policy if exists p_battle_choices_all on battle_choices;

create policy p_leagues_all on leagues for all using (true) with check (true);
create policy p_coaches_all on coaches for all using (true) with check (true);
create policy p_lots_all    on lots    for all using (true) with check (true);
create policy p_bids_all    on bids    for all using (true) with check (true);
create policy p_battles_all on battles for all using (true) with check (true);
create policy p_battle_choices_all on battle_choices for all using (true) with check (true);
