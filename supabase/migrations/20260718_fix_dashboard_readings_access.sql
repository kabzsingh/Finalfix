-- Fix dashboard readings access by updating can_access_site function
-- This allows users with user_access entries to see readings, not just site_operators

create or replace function public.can_access_site(_user_id uuid, _site_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'admin')
  or exists (select 1 from public.site_operators where site_id = _site_id and user_id = _user_id)
  or exists (select 1 from public.user_access where site_id = _site_id and user_id = _user_id)
$$;
