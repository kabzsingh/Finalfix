import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Activity, LayoutDashboard, Settings, LogOut, FileDown } from "lucide-react";
import { getSupabaseDashboardTablesUrl, getSupabaseProjectRef } from "@/lib/supabase-project";
import { signOut as serverSignOut } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({ component: AuthLayout });

function AuthLayout() {
  const { session, loading, signOut, user, roles } = useAuth();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const supabaseRef = getSupabaseProjectRef();
  const supabaseTablesUrl = getSupabaseDashboardTablesUrl();

  useEffect(() => {
    if (!loading && !session) nav({ to: "/login" });
  }, [loading, session, nav]);
  const handleSignOut = async () => {
    try {
      await signOut();
      await serverSignOut();
      nav({ to: "/" });
    } catch (error) {
      console.error("Sign out failed:", error);
      nav({ to: "/" });
    }
  };

  if (loading || !session) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  }

  // Pending approval gate: user signed in but no roles assigned
  // Pending approval gate: user signed in but no roles assigned.
  // Allow /admin so the first user can bootstrap themselves as admin.
  if (roles.length === 0 && !path.startsWith("/admin")) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-md w-full rounded-xl border border-border bg-card p-8 shadow-xl text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 bg-amber-500/10 rounded-full">
              <Activity className="h-8 w-8 text-amber-500" />
            </div>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Awaiting Admin Approval</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your account <strong>{user?.email}</strong> has been created but needs to be approved by an administrator before you can access WashGrid.
          </p>
          <p className="text-xs text-muted-foreground/70">
            Please contact your administrator. You'll get access as soon as they approve your account.
          </p>
          <Button variant="outline" onClick={handleSignOut} className="w-full mt-4">
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/dashboard" className="flex items-center gap-2 shrink-0">
            <div className="h-8 w-8 rounded-lg bg-gradient-primary shadow-glow grid place-items-center">
              <Activity className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight hidden sm:inline">WashGrid</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link to="/dashboard">
              <Button variant={path === "/dashboard" ? "secondary" : "ghost"} size="sm">
                <LayoutDashboard className="h-4 w-4" /> <span className="hidden sm:inline ml-1">Sites</span>
              </Button>
            </Link>
            <Link to="/admin">
              <Button variant={path.startsWith("/admin") ? "secondary" : "ghost"} size="sm">
                <Settings className="h-4 w-4" /> <span className="hidden sm:inline ml-1">Admin</span>
              </Button>
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden md:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 md:px-6 py-6 md:py-8">
        <Outlet />
      </main>
      {supabaseRef && (
        <footer className="border-t border-border py-2 text-center text-[11px] text-muted-foreground">
          Database:{" "}
          {supabaseTablesUrl ? (
            <a href={supabaseTablesUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
              {supabaseRef}
            </a>
          ) : (
            supabaseRef
          )}
          <span className="mx-1">·</span>
          Empty tables here mean no data yet, not a wrong project (if the ID matches your dashboard URL).
        </footer>
      )}
    </div>
  );
}
