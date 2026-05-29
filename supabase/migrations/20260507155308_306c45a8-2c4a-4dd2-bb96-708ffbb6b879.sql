
-- Fix mutable search_path on trigger function
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Revoke execute on SECURITY DEFINER helpers from anon/authenticated.
-- They are only invoked from RLS policies, which run as the table owner
-- and bypass these grants.
revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.can_access_site(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tg_set_updated_at() from public, anon, authenticated;
