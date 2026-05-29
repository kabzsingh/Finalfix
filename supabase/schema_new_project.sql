-- ================================================================
-- FULL SCHEMA — paste this into Supabase SQL Editor and Run All
-- New project setup for dashboardwash
-- ================================================================

-- 1. ENUMS
create type public.app_role as enum ('admin', 'operator');
create type public.meter_type as enum ('wash', 'fresh_water', 'chemical', 'chemical_flow');

-- 2. PROFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- 3. USER ROLES
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

-- 4. SITES
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  timezone text not null default 'UTC',
  low_chemical_threshold_pct numeric not null default 20,
  report_hour integer not null default 7,
  report_recipients text[] not null default '{}',
  daily_report_enabled boolean not null default true,
  monthly_report_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sites enable row level security;

-- 5. SITE OPERATORS
create table public.site_operators (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (site_id, user_id)
);
alter table public.site_operators enable row level security;

-- 6. SITE METERS
create table public.site_meters (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  meter_type public.meter_type not null,
  name text not null,
  unit text not null default '',
  capacity numeric,
  low_threshold numeric,
  device_key text not null,
  position int not null default 0,
  chemical_group text,
  created_at timestamptz not null default now(),
  unique (site_id, device_key)
);
alter table public.site_meters enable row level security;

-- 7. SITE API KEYS
create table public.site_api_keys (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  label text,
  last_used_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.site_api_keys (key_hash);
alter table public.site_api_keys enable row level security;

-- 8. READINGS
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

-- 9. REPORT SEND LOG
create table public.report_send_log (
  id bigserial primary key,
  site_id uuid not null,
  report_type text not null check (report_type in ('daily','monthly')),
  period_key text not null,
  recipients text[] not null default '{}',
  status text not null default 'sent',
  error text,
  sent_at timestamptz not null default now(),
  unique (site_id, report_type, period_key)
);
alter table public.report_send_log enable row level security;

-- 10. EMAIL SUBSCRIPTIONS
create table public.email_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email varchar(255) not null,
  site_id uuid not null references public.sites(id) on delete cascade,
  period varchar(20) not null check (period in ('daily', 'monthly')),
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_sent_at timestamptz
);
create index idx_email_subscriptions_site on public.email_subscriptions(site_id);
create index idx_email_subscriptions_active on public.email_subscriptions(active);
create index idx_email_subscriptions_period on public.email_subscriptions(period);
alter table public.email_subscriptions enable row level security;

-- 11. SMTP SETTINGS
create table public.smtp_settings (
  id boolean primary key default true,
  host text not null,
  port integer not null default 587,
  user_email text not null,
  password text not null,
  from_name text not null,
  from_email text not null,
  encryption text not null default 'tls',
  updated_at timestamptz default now(),
  constraint one_row check (id = true)
);
alter table public.smtp_settings enable row level security;

-- ================================================================
-- FUNCTIONS
-- ================================================================

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create trigger sites_updated_at before update on public.sites for each row execute function public.tg_set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function public.tg_set_updated_at();

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.can_access_site(_user_id uuid, _site_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'admin')
  or exists (select 1 from public.site_operators where site_id = _site_id and user_id = _user_id)
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.meter_totals(_site_id uuid)
returns table(meter_id uuid, total numeric)
language sql stable security definer set search_path = public as $$
  select meter_id, sum(value)::numeric from public.readings where site_id = _site_id group by meter_id
$$;

create or replace function public.meter_totals_since(_site_id uuid, _since timestamptz)
returns table(meter_id uuid, total numeric)
language sql stable security definer set search_path = public as $$
  select meter_id, sum(value)::numeric from public.readings where site_id = _site_id and recorded_at >= _since group by meter_id
$$;

create or replace function public.bootstrap_first_admin()
returns json language plpgsql security definer set search_path = public as $$
declare admin_count int; already_admin boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select count(*)::int into admin_count from public.user_roles where role = 'admin';
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') into already_admin;
  if admin_count > 0 then return json_build_object('granted', false, 'is_admin', already_admin); end if;
  insert into public.user_roles (user_id, role) values (auth.uid(), 'admin') on conflict (user_id, role) do nothing;
  return json_build_object('granted', true, 'is_admin', true);
end;
$$;

-- ================================================================
-- GRANTS
-- ================================================================

revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.can_access_site(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tg_set_updated_at() from public, anon, authenticated;

grant execute on function public.has_role(uuid, public.app_role) to authenticated, anon;
grant execute on function public.can_access_site(uuid, uuid) to authenticated, anon;
grant execute on function public.meter_totals(uuid) to authenticated;
grant execute on function public.meter_totals_since(uuid, timestamptz) to authenticated;
revoke all on function public.bootstrap_first_admin() from public;
grant execute on function public.bootstrap_first_admin() to authenticated;

-- ================================================================
-- RLS POLICIES
-- ================================================================

-- profiles
create policy "users see own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid());

-- user_roles
create policy "users see own roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "admins manage roles" on public.user_roles for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "bootstrap_first_admin_insert" on public.user_roles for insert to authenticated
  with check (role = 'admin' and user_id = auth.uid() and not exists (select 1 from public.user_roles ur where ur.role = 'admin'));

-- sites
create policy "view accessible sites" on public.sites for select to authenticated using (public.can_access_site(auth.uid(), id));
create policy "admins manage sites" on public.sites for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- site_operators
create policy "view own assignments or admin" on public.site_operators for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "admins manage assignments" on public.site_operators for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- site_meters
create policy "view meters for accessible sites" on public.site_meters for select to authenticated using (public.can_access_site(auth.uid(), site_id));
create policy "admins manage meters" on public.site_meters for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- site_api_keys
create policy "view api keys for accessible sites" on public.site_api_keys for select to authenticated using (public.can_access_site(auth.uid(), site_id));
create policy "admins manage api keys" on public.site_api_keys for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- readings
create policy "view readings for accessible sites" on public.readings for select to authenticated using (public.can_access_site(auth.uid(), site_id));
create policy "admins insert readings" on public.readings for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "admins update readings" on public.readings for update to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "admins delete readings" on public.readings for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- report_send_log
create policy "admins read report log" on public.report_send_log for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- email_subscriptions
create policy "Users can view their own subscriptions" on public.email_subscriptions for select using (auth.uid() = user_id or user_id is null);
create policy "Users can create subscriptions" on public.email_subscriptions for insert with check (auth.uid() = user_id or user_id is null);
create policy "Users can update their own subscriptions" on public.email_subscriptions for update using (auth.uid() = user_id or user_id is null) with check (auth.uid() = user_id or user_id is null);
create policy "Users can delete their own subscriptions" on public.email_subscriptions for delete using (auth.uid() = user_id or user_id is null);

-- smtp_settings
create policy "Admins can manage SMTP settings" on public.smtp_settings for all to authenticated using (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'));

-- ================================================================
-- REALTIME
-- ================================================================
do $$ begin
  begin
    alter publication supabase_realtime add table public.readings;
  exception when duplicate_object then null;
  end;
end $$;
alter table public.readings replica identity full;
