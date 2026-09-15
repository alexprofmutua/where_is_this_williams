create table if not exists public.witw_players (
  unix text primary key,
  email text not null,
  instagram text not null,
  screen_name text not null,
  real_name text,
  avatar text,
  avatar_image text,
  referred_by text,
  verified boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.witw_votes (
  id text primary key,
  unix text not null references public.witw_players(unix) on delete cascade,
  question_id text not null,
  title text not null,
  choice text not null,
  feedback_text text,
  answered_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists witw_votes_unix_idx on public.witw_votes(unix);
create index if not exists witw_votes_question_id_idx on public.witw_votes(question_id);
