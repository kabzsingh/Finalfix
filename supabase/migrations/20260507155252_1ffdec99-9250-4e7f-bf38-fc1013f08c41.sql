
-- ROLES ENUM
create type public.app_role as enum ('admin', 'operator');

-- PROFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- USER ROLES (separate table to avoid privilege escalation)
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

-- has_role helper
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- SITES
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  timezone text not null default 'UTC',
  low_chemical_threshold_pct numeric not null default 20,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sites enable row level security;

-- SITE OPERATORS (which operators see which sites)
create table public.site_operators (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (site_id, user_id)
);
alter table public.site_operators enable row level security;

-- can_access_site helper
create or replace function public.can_access_site(_user_id uuid, _site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
  or exists (
    select 1 from public.site_operators
    where site_id = _site_id and user_id = _user_id
  )
$$;

-- METER TYPES
create type public.meter_type as enum ('wash', 'fresh_water', 'chemical');

-- SITE METERS (variable per site)
create table public.site_meters (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  meter_type public.meter_type not null,
  name text not null,
  unit text not null default '',           -- e.g. 'L', 'count', '%'
  capacity numeric,                         -- tank capacity for chemicals (in unit)
  low_threshold numeric,                    -- alert threshold (in unit)
  device_key text not null,                 -- short key ESP32 uses to identify this meter, e.g. "wash", "fresh", "chem1"
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (site_id, device_key)
);
alter table public.site_meters enable row level security;

-- SITE API KEYS (for ESP32)
create table public.site_api_keys (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  key_hash text not null unique,            -- sha256 of the api key
  key_prefix text not null,                 -- first 8 chars for display
  label text,
  last_used_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.site_api_keys (key_hash);
alter table public.site_api_keys enable row level security;

-- READINGS (time-series)
create table public.readings (
  id bigserial primary key,
  site_id uuid not null references public.sites(id) on delete cascade,
  meter_id uuid not null references public.site_meters(id) on delete cascade,
  value numeric not null,
  recorded_at timestamptz not null default now()
);
create index on public.readings (meter_id, recorded_at desc);
create index on public.readings (site_id, recorded_at desc);
alter table public.readings enable row level security;

-- updated_at trigger
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger sites_updated_at before update on public.sites
  for each row execute function public.tg_set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1))
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================
-- RLS POLICIES
-- =====================

-- profiles
create policy "users see own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid());

-- user_roles
create policy "users see own roles"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "admins manage roles"
  on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- sites
create policy "view accessible sites"
  on public.sites for select to authenticated
  using (public.can_access_site(auth.uid(), id));
create policy "admins manage sites"
  on public.sites for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- site_operators
create policy "view own assignments or admin"
  on public.site_operators for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "admins manage assignments"
  on public.site_operators for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- site_meters
create policy "view meters for accessible sites"
  on public.site_meters for select to authenticated
  using (public.can_access_site(auth.uid(), site_id));
create policy "admins manage meters"
  on public.site_meters for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- site_api_keys (no secret stored, just hash; readable by accessing users)
create policy "view api keys for accessible sites"
  on public.site_api_keys for select to authenticated
  using (public.can_access_site(auth.uid(), site_id));
create policy "admins manage api keys"
  on public.site_api_keys for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- readings
create policy "view readings for accessible sites"
  on public.readings for select to authenticated
  using (public.can_access_site(auth.uid(), site_id));
-- no client write policies; ingest endpoint uses service role
