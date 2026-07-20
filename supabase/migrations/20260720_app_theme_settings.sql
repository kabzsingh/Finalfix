-- Global app theme settings (singleton row) so admins can customize
-- the app's color scheme and default light/dark mode for everyone.

create table if not exists public.app_settings (
  id boolean primary key default true,
  theme_mode text not null default 'dark' check (theme_mode in ('light', 'dark')),
  primary_color text not null default '#5ad1e0',
  accent_color text not null default '#2c8f9e',
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id)
);

insert into public.app_settings (id) values (true)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select_all" on public.app_settings;
create policy "app_settings_select_all"
  on public.app_settings for select
  using (true);

drop policy if exists "app_settings_admin_update" on public.app_settings;
create policy "app_settings_admin_update"
  on public.app_settings for update
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "app_settings_admin_insert" on public.app_settings;
create policy "app_settings_admin_insert"
  on public.app_settings for insert
  with check (public.has_role(auth.uid(), 'admin'));
