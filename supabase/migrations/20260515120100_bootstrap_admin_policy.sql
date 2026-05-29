-- Lets the first signed-in user claim admin without a service role key.
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
