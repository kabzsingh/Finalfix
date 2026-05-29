/** Project ref the running app is configured to use (from Vite env at build/dev time). */
export function getSupabaseProjectRef(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? null;
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

export function getSupabaseDashboardTablesUrl(): string | null {
  const ref = getSupabaseProjectRef();
  if (!ref) return null;
  return `https://supabase.com/dashboard/project/${ref}/editor`;
}
