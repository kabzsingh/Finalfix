import { createMiddleware } from '@tanstack/react-start'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

const FALLBACK_URL = "https://fqunlzvwtxsfithghfhr.supabase.co";
const FALLBACK_KEY = "sb_publishable_i7s0-XEBWmHWGlxRV7Qbvg_sCC5Wi5u";

export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next, data }) => {
    const SUPABASE_URL = (typeof process !== 'undefined' && (process.env?.SUPABASE_URL || process.env?.VITE_SUPABASE_URL)) || FALLBACK_URL;
    const SUPABASE_PUBLISHABLE_KEY = (typeof process !== 'undefined' && (process.env?.SUPABASE_PUBLISHABLE_KEY || process.env?.SUPABASE_ANON_KEY || process.env?.VITE_SUPABASE_PUBLISHABLE_KEY)) || FALLBACK_KEY;
    const token = (data as any)?.__token as string | undefined;
    if (!token) throw new Error('This endpoint requires a valid Bearer token');
    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: claimsData, error } = await supabase.auth.getClaims(token);
    if (error || !claimsData?.claims) throw new Error('Unauthorized: Invalid or expired session');
    if (!claimsData.claims.sub) throw new Error('Unauthorized: No user ID in token');
    return next({ context: { supabase, userId: claimsData.claims.sub, claims: claimsData.claims } });
  },
);
