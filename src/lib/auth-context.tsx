import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { signIn as serverSignIn } from "./auth";

type Role = "admin" | "operator";

interface AuthCtx {
  session: Session | null;
  user: User | null;
  loading: boolean;
  roles: Role[];
  isAdmin: boolean;
  refreshRoles: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>([]);

  const fetchRoles = async (userId: string | undefined) => {
    if (!userId) { setRoles([]); return; }
    try {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      if (error) throw error;
      setRoles((data ?? []).map((r: { role: Role }) => r.role));
    } catch (e) {
      console.error("Failed to fetch roles:", e);
      setRoles([]);
    }
  };

  useEffect(() => {
    const applySession = async (s: Session | null) => {
      if (s) {
        // Sync to server-side cookies
        try {
          await serverSignIn({
            data: {
              accessToken: s.access_token,
              refreshToken: s.refresh_token || "",
            }
          });
        } catch (e) {
          console.error("Failed to sync session to server:", e);
        }

        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) {
          await supabase.auth.signOut();
          setSession(null);
          setRoles([]);
          return;
        }
        setSession(s);
        await fetchRoles(data.user.id);
        return;
      }
      setSession(null);
      setRoles([]);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setTimeout(() => { void applySession(s); }, 0);
    });

    supabase.auth.getSession().then(({ data }) => applySession(data.session)).finally(() => setLoading(false));

    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    loading,
    roles,
    isAdmin: roles.includes("admin"),
    refreshRoles: () => fetchRoles(session?.user?.id),
    signOut: async () => { await supabase.auth.signOut(); },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be inside AuthProvider");
  return v;
}
