-- ROLES ENUM
create type public.app_role as enum ('admin', 'operator');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  timezone text not null default 'UTC',
  low_chemical_threshold_pct numeric not null default 20,
  report_hour integer NOT NULL DEFAULT 7,
  report_recipients text[] NOT NULL DEFAULT '{}',
  daily_report_enabled boolean NOT NULL DEFAULT true,
  monthly_report_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sites enable row level security;

create table public.site_operators (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (site_id, user_id)
);
alter table public.site_operators enable row level security;

create or replace function public.can_access_site(_user_id uuid, _site_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'admin')
  or exists (select 1 from public.site_operators where site_id = _site_id and user_id = _user_id)
$$;

create type public.meter_type as enum ('wash', 'fresh_water', 'chemical', 'chemical_flow');

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

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create trigger sites_updated_at before update on public.sites for each row execute function public.tg_set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function public.tg_set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- POLICIES
create policy "users see own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid());

create policy "users see own roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "admins manage roles" on public.user_roles for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "view accessible sites" on public.sites for select to authenticated using (public.can_access_site(auth.uid(), id));
create policy "admins manage sites" on public.sites for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "view own assignments or admin" on public.site_operators for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "admins manage assignments" on public.site_operators for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "view meters for accessible sites" on public.site_meters for select to authenticated using (public.can_access_site(auth.uid(), site_id));
create policy "admins manage meters" on public.site_meters for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "view api keys for accessible sites" on public.site_api_keys for select to authenticated using (public.can_access_site(auth.uid(), site_id));
create policy "admins manage api keys" on public.site_api_keys for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "view readings for accessible sites" on public.readings for select to authenticated using (public.can_access_site(auth.uid(), site_id));

CREATE POLICY "admins insert readings" ON public.readings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update readings" ON public.readings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete readings" ON public.readings FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.can_access_site(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tg_set_updated_at() from public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_access_site(uuid, uuid) TO authenticated, anon;

CREATE TABLE IF NOT EXISTS public.report_send_log (
  id bigserial PRIMARY KEY,
  site_id uuid NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('daily','monthly')),
  period_key text NOT NULL,
  recipients text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'sent',
  error text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, report_type, period_key)
);
ALTER TABLE public.report_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read report log" ON public.report_send_log FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.email_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  period VARCHAR(20) NOT NULL CHECK (period IN ('daily', 'monthly')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_sent_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX idx_email_subscriptions_site ON public.email_subscriptions(site_id);
CREATE INDEX idx_email_subscriptions_active ON public.email_subscriptions(active);
CREATE INDEX idx_email_subscriptions_period ON public.email_subscriptions(period);
ALTER TABLE public.email_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own subscriptions" ON public.email_subscriptions FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can create subscriptions" ON public.email_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can update their own subscriptions" ON public.email_subscriptions FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL) WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can delete their own subscriptions" ON public.email_subscriptions FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

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

grant execute on function public.meter_totals(uuid) to authenticated;
grant execute on function public.meter_totals_since(uuid, timestamptz) to authenticated;

CREATE TABLE IF NOT EXISTS public.smtp_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  user_email TEXT NOT NULL,
  password TEXT NOT NULL,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  encryption TEXT NOT NULL DEFAULT 'tls',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT one_row CHECK (id = TRUE)
);
ALTER TABLE public.smtp_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage SMTP settings" ON public.smtp_settings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

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

revoke all on function public.bootstrap_first_admin() from public;
grant execute on function public.bootstrap_first_admin() to authenticated;

drop policy if exists "bootstrap_first_admin_insert" on public.user_roles;
create policy "bootstrap_first_admin_insert" on public.user_roles for insert to authenticated
  with check (role = 'admin' and user_id = auth.uid() and not exists (select 1 from public.user_roles ur where ur.role = 'admin'));