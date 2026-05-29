import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

function createSupabaseClient() {
  const SUPABASE_URL =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    (typeof process !== 'undefined' ? process.env.SUPABASE_URL : undefined) ||
    "https://fqunlzvwtxsfithghfhr.supabase.co";

  const SUPABASE_PUBLISHABLE_KEY =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
    (typeof process !== 'undefined' ? process.env.SUPABASE_PUBLISHABLE_KEY : undefined) ||
    "sb_publishable_i7s0-XEBWmHWGlxRV7Qbvg_sCC5Wi5u";

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== 'undefined' ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    }
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
