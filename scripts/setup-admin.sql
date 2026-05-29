-- Run once in Supabase Dashboard → SQL Editor (fixes Admin page / first-user access).

-- 1) RPC bootstrap (optional but recommended)
create or replace function public.bootstrap_first_admin()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_count int;
  already_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::int into admin_count
  from public.user_roles where role = 'admin';

  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  ) into already_admin;

  if admin_count > 0 then
    return json_build_object('granted', false, 'is_admin', already_admin);
  end if;

  insert into public.user_roles (user_id, role)
  values (auth.uid(), 'admin')
  on conflict (user_id, role) do nothing;

  return json_build_object('granted', true, 'is_admin', true);
end;
$$;

revoke all on function public.bootstrap_first_admin() from public;
grant execute on function public.bootstrap_first_admin() to authenticated;

-- 2) RLS fallback when RPC is unavailable
drop policy if exists "bootstrap_first_admin_insert" on public.user_roles;
create policy "bootstrap_first_admin_insert"
  on public.user_roles
  for insert
  to authenticated
  with check (
    role = 'admin'
    and user_id = auth.uid()
    and not exists (
      select 1 from public.user_roles ur where ur.role = 'admin'
    )
  );
