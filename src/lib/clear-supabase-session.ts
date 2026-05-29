import { supabase } from "@/integrations/supabase/client";
import { getSupabaseProjectRef } from "@/lib/supabase-project";

/** Drop cached auth from another Supabase project (common after changing .env). */
export async function clearSupabaseSession() {
  const ref = getSupabaseProjectRef();
  if (typeof window !== "undefined" && ref) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("sb-") && key.includes(ref)) continue;
      if (key?.startsWith("sb-")) localStorage.removeItem(key);
    }
  }
  await supabase.auth.signOut();
}
