import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { bootstrapAdminAccess, isSetupRequiredError } from "@/lib/bootstrap-admin";
import { clearSupabaseSession } from "@/lib/clear-supabase-session";
import { getSupabaseProjectRef } from "@/lib/supabase-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { createSiteApiKey, grantAdminBootstrap, getSmtpSettings, updateSmtpSettings, listAllUsers, setUserRole, deleteUser } from "@/lib/admin.functions";
import { Copy, Plus, Trash2, KeyRound, Cpu, Mail, Send, Server, ShieldCheck, Loader2, AlertTriangle, Users, UserCheck, UserX, Building2, Save, Pencil, Palette } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { previewTheme } from "@/lib/theme-context";

import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
export const Route = createFileRoute("/_authenticated/admin")({ component: AdminPage });

interface Site {
  id: string; name: string; location: string | null;
  timezone?: string;
  report_hour?: number;
  report_recipients?: string[];
  daily_report_enabled?: boolean;
  monthly_report_enabled?: boolean;
  logo_url?: string | null;
  background_url?: string | null;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  fresh_water_daily_threshold_liters?: number | null;
  machine_type?: string | null;
  poll_interval_seconds?: number;
}
interface Meter { id: string; site_id: string; meter_type: "wash"|"fresh_water"|"chemical"|"chemical_flow"; name: string; unit: string; capacity: number | null; low_threshold: number | null; device_key: string; position: number; chemical_group: string | null; modbus_address: number | null; sensor_type: "switch" | "probe" | "counter"; count_for_avg_water: boolean }
interface ApiKeyRow { id: string; site_id: string; key_prefix: string; label: string | null; revoked: boolean; last_used_at: string | null; created_at: string }

const SETUP_SQL_HINT =
  "Supabase Dashboard → SQL Editor → run scripts/setup-admin.sql from this repo.";

function AdminPage() {
  const { isAdmin, refreshRoles, user, loading } = useAuth();
  const nav = useNavigate();
  const bootstrapServer = useServerFn(grantAdminBootstrap);

  const [sites, setSites] = useState<Site[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteLoc, setNewSiteLoc] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [sketchSite, setSketchSite] = useState<Site | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [needsDbSetup, setNeedsDbSetup] = useState(false);
  const [bootstrapNote, setBootstrapNote] = useState<string | null>(null);
  const projectRef = getSupabaseProjectRef();

  const load = async () => {
    if (!isAdmin) return;
    try {
      // Load data individually to handle missing columns gracefully
      const { data: s, error: sErr } = await supabase.from("sites").select("*").order("created_at");
      if (sErr) toast.error("Error loading sites: " + sErr.message);
      else setSites((s as any) ?? []);
      const { data: m, error: mErr } = await supabase.from("site_meters").select("*").order("position");
      if (mErr) toast.error("Error loading meters: " + mErr.message);
      else setMeters((m as any) ?? []);

      const { data: k, error: kErr } = await supabase.from("site_api_keys").select("*").order("created_at");
      if (kErr) toast.error("Error loading API keys: " + kErr.message);
      else setKeys((k as any) ?? []);
    } catch (e) {
      console.error("Load failed", e);
      toast.error("Failed to load admin data");
    }
  };

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? '';
  };

  const runBootstrap = useCallback(async () => {
    if (!user?.id) return;
    setIsBootstrapping(true);
    setNeedsDbSetup(false);
    setBootstrapNote(null);
    try {
      const { data: { session } } = await supabase.getSession();
const token = session?.access_token ?? '';
const res = await bootstrapServer({ data: { __token: token } } as any);
      if (res.granted || res.isAdmin) {
        await refreshRoles();
        if (res.granted) toast.success("You've been granted Admin access!");
      } else {
        // Fallback to client-side bootstrap if server fails
        const clientRes = await bootstrapAdminAccess(user.id);
        if (clientRes.granted || clientRes.isAdmin) {
          await refreshRoles();
          if (clientRes.granted) toast.success("You're set as admin (via fallback)");
        } else {
          setBootstrapNote("No admin role detected. Please ensure you have run the setup SQL in your Supabase dashboard.");
          setNeedsDbSetup(true);
        }
      }
    } catch (e: any) {
      console.error("Bootstrap error:", e);
      setNeedsDbSetup(true);
      toast.error(e?.message || "Failed to verify admin access");
    } finally {
      setIsBootstrapping(false);
    }
  }, [user?.id, refreshRoles, bootstrapServer]);

  useEffect(() => {
    if (loading || !user?.id) return;
    if (!isAdmin) void runBootstrap();
  }, [loading, user?.id, isAdmin, runBootstrap]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (loading || isBootstrapping) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4 text-center px-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-medium">Verifying admin permissions...</p>
        <p className="text-xs text-muted-foreground/60 max-w-xs italic">
          This usually takes a few seconds. If it hangs, please check your internet connection.
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-12 rounded-xl border border-border bg-card p-8 shadow-xl text-center">
        <div className="flex justify-center mb-6">
          <div className="p-3 bg-muted rounded-full">
            <ShieldCheck className="h-10 w-10 text-muted-foreground opacity-50" />
          </div>
        </div>
        <h2 className="font-semibold text-2xl tracking-tight">Access Restricted</h2>
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
          Your account (<strong>{user?.email}</strong>) does not have administrator privileges on project
          <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-xs font-mono">{projectRef || "unknown"}</code>.
        </p>

        {needsDbSetup && (
          <div className="mt-6 p-4 text-left rounded-lg border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-sm mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span>Database Setup Required</span>
            </div>
            <p className="text-xs text-amber-700/80 dark:text-amber-300/80 leading-relaxed mb-3">
              {SETUP_SQL_HINT}
            </p>
            <div className="text-[10px] font-mono bg-background/50 p-2 rounded border border-amber-500/10 overflow-x-auto whitespace-pre">
              {`-- Find this script in:
scripts/setup-admin.sql`}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 mt-8">
          <Button onClick={() => void runBootstrap()} disabled={isBootstrapping} className="w-full">
            {isBootstrapping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Retry Access Check
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              await clearSupabaseSession();
              toast.info("Signed out. Please sign up for a new account.");
              nav({ to: "/signup" });
            }}
          >
            Sign out & Switch User
          </Button>
          <Button variant="ghost" onClick={() => nav({ to: "/dashboard" })} className="text-muted-foreground">
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const addSite = async () => {
    if (!newSiteName.trim()) return;
    const { error } = await supabase.from("sites").insert({ name: newSiteName.trim(), location: newSiteLoc.trim() || null });
    if (error) return toast.error(error.message);
    setNewSiteName(""); setNewSiteLoc(""); load();
    toast.success("Site created successfully");
  };
  const removeSite = async (id: string) => {
    if (!confirm("Are you sure? This will permanently delete the site and all its data.")) return;
    const { error } = await supabase.from("sites").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
    toast.success("Site deleted");
  };

  const addMeter = async (siteId: string, m: Partial<Meter>): Promise<boolean> => {
    const name = (m.name ?? "").trim();
    const deviceKey = (m.device_key ?? "").trim();
    if (!name || !deviceKey) {
      toast.error("Name and Device Key are required");
      return false;
    }
    try {
      const { error } = await supabase.from("site_meters").insert({
        site_id: siteId,
        meter_type: m.meter_type!,
        name,
        unit: (m.unit ?? "").trim() || "",
        capacity: m.capacity ?? null,
        low_threshold: m.low_threshold ?? null,
        device_key: deviceKey,
        chemical_group: m.chemical_group?.trim() || null,
        modbus_address: m.modbus_address ?? null,
        sensor_type: m.sensor_type ?? "switch",
        position: meters.filter((x) => x.site_id === siteId).length,
      });
      if (error) {
        toast.error(error.message);
        return false;
      }
      load();
      toast.success("Meter added");
      return true;
    } catch (e: any) {
      toast.error(e.message || "Failed to add meter");
      return false;
    }
  };

  const updateMeter = async (id: string, updates: { capacity: number | null; low_threshold: number | null; modbus_address?: number | null; sensor_type?: "switch" | "probe" | "counter" }): Promise<boolean> => {
    try {
      const payload: any = { capacity: updates.capacity, low_threshold: updates.low_threshold };
      if (updates.modbus_address !== undefined) payload.modbus_address = updates.modbus_address;
      if (updates.sensor_type !== undefined) payload.sensor_type = updates.sensor_type;
      const { error } = await supabase.from("site_meters")
        .update(payload)
        .eq("id", id);
      if (error) {
        toast.error(error.message);
        return false;
      }
      load();
      toast.success("Meter settings saved");
      return true;
    } catch (e: any) {
      toast.error(e.message || "Failed to update meter");
      return false;
    }
  };

  const toggleAvgWaterMeter = async (id: string, checked: boolean): Promise<boolean> => {
    try {
      const { error } = await supabase.from("site_meters").update({ count_for_avg_water: checked }).eq("id", id);
      if (error) {
        toast.error(error.message);
        return false;
      }
      load();
      toast.success(checked ? "Now counted in Avg Water/Car" : "Excluded from Avg Water/Car");
      return true;
    } catch (e: any) {
      toast.error(e.message || "Failed to update meter");
      return false;
    }
  };

  const removeMeter = async (id: string) => {
    if (!confirm("Remove this meter? This cannot be undone.")) return;
    const { error } = await supabase.from("site_meters").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
    toast.success("Meter removed");
  };

  const updateBranding = async (siteId: string, branding: {
    primary_color: string;
    secondary_color: string;
    accent_color: string;
    logo_url: string | null;
    background_url: string | null;
  }) => {
    const { error } = await supabase.from("sites").update(branding).eq("id", siteId);
    if (error) {
      toast.error(error.message);
      return false;
    }
    load();
    toast.success("Branding updated");
    return true;
  };

  const updateSiteDetails = async (siteId: string, details: { name: string; location: string | null; machine_type: string | null }): Promise<boolean> => {
    if (!details.name.trim()) {
      toast.error("Site name is required");
      return false;
    }
    const { error } = await supabase
      .from("sites")
      .update({ name: details.name.trim(), location: details.location?.trim() || null, machine_type: details.machine_type?.trim() || null })
      .eq("id", siteId);
    if (error) {
      toast.error(error.message);
      return false;
    }
    load();
    toast.success("Site details updated");
    return true;
  };

  const generateKey = useServerFn(createSiteApiKey);
  const handleGenKey = async (siteId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await generateKey({ data: { siteId, label: "ESP32", __token: session?.access_token ?? '' } } as any);
      setRevealedKey(res.apiKey);
      load();
    } catch (e: any) { toast.error(e.message ?? "Key generation failed"); }
  };

  const revokeKey = async (id: string) => {
    const { error } = await supabase.from("site_api_keys").update({ revoked: true }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
    toast.success("Key revoked");
  };
  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 px-4">
      <div className="border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Console</h1>
          <p className="text-muted-foreground mt-1 text-sm">Configure site infrastructure, monitor ESP32 connectivity, and manage reports.</p>
        </div>
      </div>

      <AppThemePanel />

      <UsersPanel currentUserId={user?.id ?? ""} />

      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary" />
          Infrastructure Management
        </h2>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm overflow-hidden">
          <h3 className="text-sm font-medium mb-4 text-muted-foreground">Register New Wash Site</h3>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="site-name">Friendly Name</Label>
              <Input id="site-name" value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="e.g. Manchester Central" />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="site-loc">Location / Area</Label>
              <Input id="site-loc" value={newSiteLoc} onChange={(e) => setNewSiteLoc(e.target.value)} placeholder="e.g. M1 1AA" />
            </div>
            <div className="flex items-end">
              <Button onClick={addSite} className="w-full gap-2 shadow-sm">
                <Plus className="h-4 w-4" /> Create Site
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-6">
          {sites.map((site) => (
            <SiteAdminCard
              key={site.id}
              site={site}
              meters={meters.filter((m) => m.site_id === site.id)}
              keys={keys.filter((k) => k.site_id === site.id)}
              onRemoveSite={() => removeSite(site.id)}
              onAddMeter={(m) => addMeter(site.id, m)}
              onUpdateMeter={updateMeter}
              onToggleAvgWaterMeter={toggleAvgWaterMeter}
              onRemoveMeter={removeMeter}
              onGenerateKey={() => handleGenKey(site.id)}
              onRevokeKey={revokeKey}
              onGenerateSketch={() => setSketchSite(site)}
              onUpdateBranding={(branding) => updateBranding(site.id, branding)}
              onUpdateSiteDetails={(details) => updateSiteDetails(site.id, details)}
            />
          ))}

          {sites.length === 0 && !loading && (
            <div className="py-12 text-center rounded-xl border border-dashed border-border bg-muted/30">
              <p className="text-sm text-muted-foreground italic">No wash sites registered yet. Add one above to get started.</p>
            </div>
          )}
        </div>
      </section>

      <Dialog open={!!revealedKey} onOpenChange={(o) => { if (!o) setRevealedKey(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              API Key Generated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              <strong>Action required:</strong> Copy this key immediately. For security, it will never be displayed again.
            </p>
            <div className="relative">
              <div className="rounded-lg bg-secondary/80 p-4 font-mono text-sm break-all border border-border/50 pr-12">
                {revealedKey}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-2 top-1/2 -translate-y-1/2 hover:bg-background"
                onClick={() => { navigator.clipboard.writeText(revealedKey ?? ""); toast.success("Copied to clipboard"); }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground italic bg-muted/50 p-2 rounded">
              Note: Include this in the <code>x-site-api-key</code> header of your ESP32 requests.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <EspSketchDialog
        key={sketchSite?.id ?? "esp-sketch-closed"}
        site={sketchSite}
        meters={sketchSite ? meters.filter((m) => m.site_id === sketchSite.id) : []}
        onClose={() => setSketchSite(null)}
      />
    </div>
  );
}

function AppThemePanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"light" | "dark">("dark");
  const [primary, setPrimary] = useState("#5ad1e0");
  const [accent, setAccent] = useState("#2c8f9e");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("theme_mode, primary_color, accent_color")
        .eq("id", true)
        .maybeSingle();
      if (data) {
        setMode((data.theme_mode as "light" | "dark") ?? "dark");
        setPrimary(data.primary_color ?? "#5ad1e0");
        setAccent(data.accent_color ?? "#2c8f9e");
      }
      setLoading(false);
    })();
  }, []);

  // Live preview as the admin picks colors, before saving
  useEffect(() => {
    if (!loading) previewTheme(mode, primary, accent);
  }, [primary, accent, mode, loading]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .update({ theme_mode: mode, primary_color: primary, accent_color: accent, updated_at: new Date().toISOString() })
      .eq("id", true);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("App theme saved — applies for all users");
  };

  const handleReset = () => {
    setMode("dark");
    setPrimary("#5ad1e0");
    setAccent("#2c8f9e");
  };

  if (loading) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <Palette className="h-5 w-5 text-primary" />
        App Theme
      </h2>
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
        <p className="text-sm text-muted-foreground">
          Set the default look for everyone using the app. Colors apply globally; each person's light/dark mode toggle still overrides just their own view.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="space-y-2">
            <Label>Default mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "light" | "dark")}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Primary color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                className="h-9 w-9 rounded border border-border cursor-pointer bg-transparent"
              />
              <Input value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-9 font-mono text-xs" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Accent color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="h-9 w-9 rounded border border-border cursor-pointer bg-transparent"
              />
              <Input value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 font-mono text-xs" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
          <Button variant="outline" size="sm" onClick={handleReset}>Reset to default</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving..." : "Save Theme"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function SmtpSettingsPanel() {
  const get = useServerFn(getSmtpSettings);
  const update = useServerFn(updateSmtpSettings);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [userEmail, setUserEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fromName, setFromName] = useState("Autowash Dashboard");
  const [fromEmail, setFromEmail] = useState("");
  const [encryption, setEncryption] = useState<"tls" | "ssl" | "none">("tls");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) =>
(get as any)({ data: { __token: session?.access_token ?? '' } })).then((data: any) => {
      if (data) {
        setHost(data.host || "");
        setPort(String(data.port || "587"));
        setUserEmail(data.user_email || "");
        setPassword(data.password || "");
        setFromName(data.from_name || "Autowash Dashboard");
        setFromEmail(data.from_email || "");
        setEncryption((data.encryption as any) || "tls");
      }
      setLoading(false);
    }).catch((e) => {
      console.warn("SMTP fetch failed (normal if not setup):", e);
      setLoading(false);
    });
  }, []); // eslint-disable-line
  const handleSave = async () => {
    if (!host || !userEmail || !password) {
      return toast.error("Host, User Email, and Password are required");
    }
    setSaving(true);
    try {
      const { data: { session: smtpSession } } = await supabase.auth.getSession();
      await (update as any)({
       data: {
        host, port: Number(port), user_email: userEmail, password,
        from_name: fromName, from_email: fromEmail, encryption: encryption as "tls" | "ssl" | "none",
         __token: smtpSession?.access_token ?? '',
  },
});
      toast.success("Mail server settings updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save SMTP settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm border-l-4 border-l-primary/50">
      <div className="flex items-center gap-2 mb-6">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Server className="h-5 w-5 text-primary" />
        </div>
        <h2 className="font-semibold text-lg">System Mail Server (SMTP)</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="space-y-2">
          <Label>Outbound Host</Label>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="e.g. smtp.postmarkapp.com" />
        </div>
        <div className="space-y-2">
          <Label>Port</Label>
          <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" />
        </div>
        <div className="space-y-2">
          <Label>Encryption Method</Label>
          <Select value={encryption} onValueChange={(v) => setEncryption(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tls">STARTTLS / TLS</SelectItem>
              <SelectItem value="ssl">SSL / SMTPS</SelectItem>
              <SelectItem value="none">Unencrypted (Not Recommended)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>User Email / Login</Label>
          <Input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="smtp_user@domain.com" />
        </div>
        <div className="space-y-2">
          <Label>Account Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <div className="space-y-2">
          <Label>Global Sender Name</Label>
          <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Autowash Dashboard Automations" />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label>Global From Address</Label>
          <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="reports@yourdomain.com" />
        </div>
        <div className="flex items-end">
          <Button onClick={handleSave} className="w-full font-medium" disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Apply SMTP Configuration
          </Button>
        </div>
      </div>
      <div className="mt-4 p-3 rounded bg-muted/30 flex gap-2 items-start">
        <Loader2 className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong>Pro-tip:</strong> Use a dedicated transactional mail provider (Postmark, SendGrid, or Resend) for reliable report delivery. Gmail App Passwords work but are prone to rate limiting.
        </p>
      </div>
    </div>
  );
}

function MeterRow({
  meter, onUpdateMeter, onToggleAvgWaterMeter, onRemoveMeter,
}: {
  meter: Meter;
  onUpdateMeter: (id: string, updates: { capacity: number | null; low_threshold: number | null; modbus_address?: number | null; sensor_type?: "switch" | "probe" | "counter" }) => Promise<boolean>;
  onToggleAvgWaterMeter: (id: string, checked: boolean) => Promise<boolean>;
  onRemoveMeter: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [capacity, setCapacity] = useState(meter.capacity != null ? String(meter.capacity) : "");
  const [lowThreshold, setLowThreshold] = useState(meter.low_threshold != null ? String(meter.low_threshold) : "");
  const [modbusAddress, setModbusAddress] = useState(meter.modbus_address != null ? String(meter.modbus_address) : "");
  const [sensorType, setSensorType] = useState<"switch" | "probe" | "counter">(meter.sensor_type ?? "switch");
  const [saving, setSaving] = useState(false);
  const [savingAvgWater, setSavingAvgWater] = useState(false);
  const isChemical = meter.meter_type === "chemical" || meter.meter_type === "chemical_flow";
  const isChemicalLevel = meter.meter_type === "chemical";
  const isFreshWater = meter.meter_type === "fresh_water";

  const handleSave = async () => {
    setSaving(true);
    const ok = await onUpdateMeter(meter.id, {
      capacity: capacity.trim() ? Number(capacity) : null,
      low_threshold: lowThreshold.trim() ? Number(lowThreshold) : null,
      modbus_address: modbusAddress.trim() ? Number(modbusAddress) : null,
      sensor_type: isChemicalLevel ? sensorType : undefined,
    });
    setSaving(false);
    if (ok) setEditing(false);
  };

  const handleToggleAvgWater = async (checked: boolean) => {
    setSavingAvgWater(true);
    await onToggleAvgWaterMeter(meter.id, checked);
    setSavingAvgWater(false);
  };

  return (
    <div className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center justify-center px-2 py-1 rounded bg-muted font-mono text-[10px] font-bold text-muted-foreground">
            ID
            <span className="text-primary">{meter.device_key}</span>
          </div>
          <div>
            <div className="text-sm font-semibold">{meter.name}</div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[10px] uppercase font-bold text-muted-foreground/70">{meter.meter_type.replace("_", " ")}</span>
              {meter.chemical_group && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold border border-indigo-500/10">
                  GRP: {meter.chemical_group}
                </span>
              )}
              {isChemicalLevel && !editing && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold border ${meter.sensor_type === "probe" ? "bg-cyan-500/10 text-cyan-500 border-cyan-500/10" : "bg-muted text-muted-foreground/70 border-border"}`}>
                  {meter.sensor_type === "probe" ? "PROBE" : "SWITCH"}
                </span>
              )}
              {!editing && meter.capacity != null && (
                <span className="text-[10px] text-muted-foreground/60">Drum: {meter.capacity}{meter.unit}</span>
              )}
              {!editing && meter.low_threshold != null && (
                <span className="text-[10px] text-muted-foreground/60">Float trips at: {meter.low_threshold}{meter.unit} used</span>
              )}
              {!editing && (
                <span className={`text-[10px] font-mono ${meter.modbus_address != null ? "text-muted-foreground/60" : "text-amber-500"}`}>
                  {meter.modbus_address != null ? `Modbus: ${meter.modbus_address}` : "Modbus: not set"}
                </span>
              )}
            </div>
            {isFreshWater && (
              <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/80 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  checked={meter.count_for_avg_water}
                  disabled={savingAvgWater}
                  onChange={(e) => handleToggleAvgWater(e.target.checked)}
                  className="h-3 w-3 accent-primary"
                />
                Count this meter in "Avg Water / Car"
              </label>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setEditing((v) => !v)} className="h-8 w-8 text-muted-foreground hover:text-primary">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onRemoveMeter(meter.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-2 gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-[10px]">HMI Modbus Address (mapping table)</Label>
            <Input
              className="h-8 text-xs"
              type="number"
              placeholder="e.g. 3025"
              value={modbusAddress}
              onChange={(e) => setModbusAddress(e.target.value)}
            />
          </div>
          {isChemical && (
            <>
              {isChemicalLevel && (
                <div className="space-y-1">
                  <Label className="text-[10px]">Sensor Type</Label>
                  <Select value={sensorType} onValueChange={(v) => setSensorType(v as "switch" | "probe" | "counter")}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="switch">Switch (float — low/ok only)</SelectItem>
                      <SelectItem value="probe">Probe (continuous level reading)</SelectItem>
                      <SelectItem value="counter">Counter (PLC counts washes since low)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-[10px]">Total drum capacity ({meter.unit || "L"})</Label>
                <Input
                  className="h-8 text-xs"
                  type="number"
                  placeholder="e.g. 210"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">
                  {isChemicalLevel && sensorType === "probe"
                    ? `Low alert threshold (${meter.unit || "L"} remaining)`
                    : `Float trips after (${meter.unit || "L"} used from full)`}
                </Label>
                <Input
                  className="h-8 text-xs"
                  type="number"
                  placeholder="e.g. 50"
                  value={lowThreshold}
                  onChange={(e) => setLowThreshold(e.target.value)}
                />
              </div>
            </>
          )}
          <div className="col-span-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SiteAdminCard({
  site, meters, keys, onRemoveSite, onAddMeter, onUpdateMeter, onToggleAvgWaterMeter, onRemoveMeter, onGenerateKey, onRevokeKey, onGenerateSketch, onUpdateBranding, onUpdateSiteDetails,
}: {
  site: Site; meters: Meter[]; keys: ApiKeyRow[];
  onRemoveSite: () => void;
  onAddMeter: (m: Partial<Meter>) => Promise<boolean>;
  onUpdateMeter: (id: string, updates: { capacity: number | null; low_threshold: number | null; modbus_address?: number | null; sensor_type?: "switch" | "probe" | "counter" }) => Promise<boolean>;
  onToggleAvgWaterMeter: (id: string, checked: boolean) => Promise<boolean>;
  onRemoveMeter: (id: string) => void;
  onGenerateKey: () => void;
  onRevokeKey: (id: string) => void;
  onGenerateSketch: () => void;
  onUpdateBranding: (branding: { primary_color: string; secondary_color: string; accent_color: string; logo_url: string | null; background_url: string | null }) => Promise<boolean>;
  onUpdateSiteDetails: (details: { name: string; location: string | null; machine_type: string | null }) => Promise<boolean>;
}) {
  const [type, setType] = useState<Meter["meter_type"]>("chemical");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("L");
  const [deviceKey, setDeviceKey] = useState("");
  const [modbusAddress, setModbusAddress] = useState("");
  const [capacity, setCapacity] = useState("");
  const [low, setLow] = useState("");
  const [group, setGroup] = useState("");
  const [sensorType, setSensorType] = useState<"switch" | "probe" | "counter">("switch");
  const [editingDetails, setEditingDetails] = useState(false);
  const [editName, setEditName] = useState(site.name);
  const [editLocation, setEditLocation] = useState(site.location ?? "");
  const [editMachineType, setEditMachineType] = useState(site.machine_type ?? "");
  const [savingDetails, setSavingDetails] = useState(false);

  const saveSiteDetails = async () => {
    setSavingDetails(true);
    const ok = await onUpdateSiteDetails({ name: editName, location: editLocation || null, machine_type: editMachineType || null });
    setSavingDetails(false);
    if (ok) setEditingDetails(false);
  };

  const cancelEditDetails = () => {
    setEditName(site.name);
    setEditLocation(site.location ?? "");
    setEditMachineType(site.machine_type ?? "");
    setEditingDetails(false);
  };
  // No branding customization - original simple setup

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden transition-all hover:shadow-md">
      <div className="bg-muted/30 px-6 py-4 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="h-10 w-10 rounded bg-background border border-border flex items-center justify-center font-bold text-primary shrink-0">
            {site.name.charAt(0)}
          </div>
          {editingDetails ? (
            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Site name"
                className="h-8 text-sm font-semibold"
              />
              <Input
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                placeholder="Location / Address"
                className="h-8 text-sm"
              />
              <Input
                value={editMachineType}
                onChange={(e) => setEditMachineType(e.target.value)}
                placeholder="Machine type (e.g. Delta DOP-107EV)"
                className="h-8 text-sm"
              />
            </div>
          ) : (
            <div className="min-w-0">
              <h3 className="font-bold text-lg leading-tight truncate">{site.name}</h3>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wider font-medium flex-wrap">
                <Cpu className="h-3 w-3" />
                {site.location || "Remote Site"}
                <span className="mx-1 opacity-30">•</span>
                {meters.length} Sensor{meters.length === 1 ? "" : "s"}
                {site.machine_type && (
                  <>
                    <span className="mx-1 opacity-30">•</span>
                    {site.machine_type}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editingDetails ? (
            <>
              <Button type="button" size="sm" onClick={saveSiteDetails} disabled={savingDetails} className="h-8 text-xs font-semibold">
                {savingDetails ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={cancelEditDetails} className="h-8 text-xs">
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="icon" onClick={() => setEditingDetails(true)} className="h-8 w-8" title="Edit site details">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onGenerateSketch} disabled={meters.length === 0} className="h-8 text-xs font-semibold">
                <Cpu className="h-3.5 w-3.5 mr-1.5" /> Sketch
              </Button>
              <Button variant="ghost" size="icon" onClick={onRemoveSite} className="h-8 w-8 text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
        </div>
      </div>

      <div className="p-6 space-y-8">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Meter & Sensor Configuration</h4>
          </div>

          <div className="space-y-2">
            {meters.map((m) => (
              <MeterRow key={m.id} meter={m} onUpdateMeter={onUpdateMeter} onToggleAvgWaterMeter={onToggleAvgWaterMeter} onRemoveMeter={onRemoveMeter} />
            ))}

            {meters.length === 0 && (
              <div className="text-center py-6 border-2 border-dashed border-border rounded-lg bg-muted/10">
                <p className="text-xs text-muted-foreground italic">No sensors configured for this site.</p>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-lg bg-muted/20 p-4 border border-border/40">
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-3 tracking-widest">Connect New Meter</p>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px]">Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as any)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wash">Wash</SelectItem>
                    <SelectItem value="fresh_water">Water</SelectItem>
                    <SelectItem value="chemical">Level</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Name</Label>
                <Input className="h-8 text-xs" placeholder="e.g. Soap 1" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Device Key</Label>
                <Input className="h-8 text-xs" placeholder="esp_id" value={deviceKey} onChange={(e) => setDeviceKey(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">HMI Modbus Addr</Label>
                <Input className="h-8 text-xs" placeholder="e.g. 3025" type="number" value={modbusAddress} onChange={(e) => setModbusAddress(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Unit</Label>
                <Input className="h-8 text-xs" placeholder="L / ml" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Cap</Label>
                <Input className="h-8 text-xs" placeholder="200" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Alert</Label>
                <Input className="h-8 text-xs" placeholder="20" type="number" value={low} onChange={(e) => setLow(e.target.value)} />
              </div>
            </div>

            <div className="mt-3 flex flex-col md:flex-row gap-3 items-end">
              {type === "chemical" && (
                <div className="flex-1 space-y-1 w-full">
                  <Label className="text-[10px]">Sensor Type</Label>
                  <Select value={sensorType} onValueChange={(v) => setSensorType(v as "switch" | "probe" | "counter")}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="switch">Switch (float — low/ok only)</SelectItem>
                      <SelectItem value="probe">Probe (continuous level reading)</SelectItem>
                      <SelectItem value="counter">Counter (PLC counts washes since low)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(type === "chemical" || type === "chemical_flow") && (
                <div className="flex-1 space-y-1 w-full">
                  <Label className="text-[10px]">Chemical Grouping (optional)</Label>
                  <Input className="h-8 text-xs" placeholder="e.g. Blue Soap" value={group} onChange={(e) => setGroup(e.target.value)} />
                </div>
              )}
              <Button
                size="sm"
                className="h-8 px-4 font-bold text-[11px]"
                onClick={async () => {
                  const ok = await onAddMeter({
                    meter_type: type,
                    name: name.trim(),
                    unit,
                    device_key: deviceKey.trim(),
                    modbus_address: modbusAddress.trim() ? Number(modbusAddress) : null,
                    capacity: capacity ? Number(capacity) : null,
                    low_threshold: low ? Number(low) : null,
                    chemical_group: group.trim() || null,
                    sensor_type: type === "chemical" ? sensorType : "switch",
                  });
                  if (!ok) return;
                  setName(""); setDeviceKey(""); setModbusAddress(""); setCapacity(""); setLow(""); setGroup(""); setSensorType("switch");
                }}
              ><Plus className="h-3.5 w-3.5 mr-1" /> Add Sensor</Button>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Active ESP32 Access Keys</h4>
            <Button size="sm" variant="outline" onClick={onGenerateKey} className="h-7 text-[10px] font-bold uppercase border-dashed"><KeyRound className="h-3 w-3 mr-1.5" /> New Key</Button>
          </div>

          <div className="grid gap-2">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-md border border-border/60 px-4 py-2.5 bg-muted/10">
                <div className="flex items-center gap-4">
                  <div className="font-mono text-[11px] bg-background border border-border px-2 py-0.5 rounded font-bold shadow-sm">
                    {k.key_prefix}••••••••
                  </div>
                  {k.revoked ? (
                    <span className="text-[9px] font-bold uppercase text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">Revoked</span>
                  ) : (
                    <span className="text-[9px] font-bold uppercase text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">Active</span>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {k.last_used_at ? `Activity: ${new Date(k.last_used_at).toLocaleDateString()}` : "Not used"}
                  </div>
                </div>
                {!k.revoked && (
                  <Button variant="ghost" size="sm" onClick={() => onRevokeKey(k.id)} className="h-7 text-[10px] font-bold text-destructive hover:bg-destructive/10 uppercase tracking-wider">Deactivate</Button>
                )}
              </div>
            ))}

            {keys.length === 0 && (
              <p className="text-xs text-muted-foreground italic text-center py-4 bg-muted/10 rounded-lg">No security keys active. Generate one to start streaming data.</p>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-border/60">
          <WaterAlertSettings site={site} onSaved={() => { /* parent will refetch on next mount */ }} />
        </div>

        <div className="pt-4 border-t border-border/60">
          <PollIntervalSettings site={site} onSaved={() => { /* parent will refetch on next mount */ }} />
        </div>

        <div className="pt-4 border-t border-border/60">
          <ReportSettings site={site} onSaved={() => { /* parent will refetch on next mount */ }} />
        </div>
      </div>
    </div>
  );
}

function PollIntervalSettings({ site, onSaved }: { site: Site; onSaved: () => void }) {
  const [seconds, setSeconds] = useState<string>(String(site.poll_interval_seconds ?? 15));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const value = Number(seconds);
    if (!seconds.trim() || Number.isNaN(value) || value < 5 || value > 3600) {
      setSaving(false);
      return toast.error("Enter a number of seconds between 5 and 3600");
    }
    const { error } = await supabase
      .from("sites")
      .update({ poll_interval_seconds: Math.round(value) })
      .eq("id", site.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Poll interval saved");
    onSaved();
  };

  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <h4 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">ESP32 Poll Interval</h4>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              How often the ESP32 reads meters and sends data. Only affects sketches generated after saving — already-flashed devices need to be reflashed to pick up a change.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={saving} className="h-8 text-xs font-bold">
          {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
          Save Interval
        </Button>
      </div>

      <div className="max-w-xs space-y-2">
        <Label className="text-xs font-semibold">Poll Interval (seconds)</Label>
        <Input
          type="number"
          min={5}
          max={3600}
          className="h-9 bg-background"
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          placeholder="e.g. 15"
        />
        <p className="text-[10px] text-muted-foreground/70 px-1">Default is 15 seconds. Longer intervals reduce data freshness but also reduce load on the HMI/PLC and network traffic.</p>
      </div>
    </div>
  );
}

function WaterAlertSettings({ site, onSaved }: { site: Site; onSaved: () => void }) {
  const [threshold, setThreshold] = useState<string>(
    site.fresh_water_daily_threshold_liters != null ? String(site.fresh_water_daily_threshold_liters) : ""
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const value = threshold.trim() ? Number(threshold) : null;
    if (value != null && (Number.isNaN(value) || value < 0)) {
      setSaving(false);
      return toast.error("Enter a valid number of liters");
    }
    const { error } = await supabase
      .from("sites")
      .update({ fresh_water_daily_threshold_liters: value })
      .eq("id", site.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Water alert threshold saved");
    onSaved();
  };

  return (
    <div className="rounded-xl border border-border/50 bg-primary/5 p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center">
            <AlertTriangle className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h4 className="text-sm font-bold uppercase tracking-widest text-primary/80">Fresh Water Daily Alert</h4>
            <p className="text-[10px] text-muted-foreground mt-0.5">Flag this site on the main dashboard if today's fresh water usage exceeds the limit below.</p>
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={saving} className="h-8 text-xs font-bold">
          {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
          Save Threshold
        </Button>
      </div>

      <div className="max-w-xs space-y-2">
        <Label className="text-xs font-semibold">Daily Limit (liters)</Label>
        <Input
          type="number"
          min={0}
          className="h-9 bg-background"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder="e.g. 20000"
        />
        <p className="text-[10px] text-muted-foreground/70 px-1">Leave blank to disable this alert for the site.</p>
      </div>
    </div>
  );
}

function ReportSettings({ site, onSaved }: { site: Site; onSaved: () => void }) {
  const [hour, setHour] = useState<number>(site.report_hour ?? 7);
  const [tz, setTz] = useState<string>(site.timezone || "UTC");
  const [recipients, setRecipients] = useState<string>((site.report_recipients ?? []).join(", "));
  const [daily, setDaily] = useState<boolean>(site.daily_report_enabled ?? true);
  const [monthly, setMonthly] = useState<boolean>(site.monthly_report_enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const save = async () => {
    setSaving(true);
    const list = recipients.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
    const bad = list.find((e) => !/.+@.+\..+/.test(e));
    if (bad) { setSaving(false); return toast.error(`Invalid email address: ${bad}`); }
    const { error } = await supabase.from("sites").update({
      report_hour: hour, timezone: tz, report_recipients: list,
      daily_report_enabled: daily, monthly_report_enabled: monthly,
    }).eq("id", site.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Automated report settings saved");
    onSaved();
  };

  const sendTest = async () => {
    setSending(true);
    try {
      // Clear previous log so test always sends
      await supabase.from("report_send_log").delete().eq("site_id", site.id);
      const res = await fetch(`/api/public/hooks/send-reports?force=${site.id}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Network error");
      toast.success("Test report dispatched successfully!");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to send test report");
    } finally { setSending(false); }
  };

  return (
    <div className="rounded-xl border border-border/50 bg-primary/5 p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center">
            <Mail className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h4 className="text-sm font-bold uppercase tracking-widest text-primary/80">Automated Site Reports</h4>
            <p className="text-[10px] text-muted-foreground mt-0.5">Scheduled email analytics for site performance.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={sendTest} disabled={sending} className="h-8 text-xs font-bold bg-background">
            {sending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Send className="mr-2 h-3 w-3" />}
            Instant Test
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="h-8 text-xs font-bold">
            {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Save Schedule
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Scheduled Send Time</Label>
          <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
            <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }).map((_, i) => (
                <SelectItem key={i} value={String(i)}>{String(i).padStart(2, "0")}:00 (Site Local)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Site Timezone</Label>
          <Input className="h-9 bg-background" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="e.g. Africa/Johannesburg" />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label className="text-xs font-semibold">Delivery Recipients</Label>
          <Textarea className="min-h-[80px] bg-background text-sm" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="manager@wash.com, ops@wash.com" />
          <p className="text-[10px] text-muted-foreground/70 px-1">Multiple addresses supported. Separate with commas.</p>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-primary/10 bg-background px-4 py-3">
          <div className="space-y-0.5">
            <span className="text-xs font-bold">Daily Intelligence</span>
            <p className="text-[9px] text-muted-foreground">Every morning at {String(hour).padStart(2, "0")}:00</p>
          </div>
          <Switch checked={daily} onCheckedChange={setDaily} />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-primary/10 bg-background px-4 py-3">
          <div className="space-y-0.5">
            <span className="text-xs font-bold">Monthly CSV Analytics</span>
            <p className="text-[9px] text-muted-foreground">Full site data on the 1st of every month.</p>
          </div>
          <Switch checked={monthly} onCheckedChange={setMonthly} />
        </div>
      </div>
    </div>
  );
}

function buildEsp32Sketch(site: Site, meters: Meter[]) {
  const endpoint = `${typeof window !== "undefined" ? window.location.origin : "https://your-deployment-url.com"}/api/public/ingest`;
  const pollIntervalSeconds = site.poll_interval_seconds ?? 15;

  // Only meters with an HMI Modbus Address configured (in Admin > Meter &
  // Sensor Configuration) can be included in the generated sketch — that
  // address is what tells the ESP32 where to read this meter's value from.
  const configured = meters.filter((m) => m.modbus_address != null);
  const missing = meters.filter((m) => m.modbus_address == null);

  const meterEntries = configured.length > 0
    ? configured
        .map((m) => {
          const zeroBased = (m.modbus_address as number) - 1;
          const safeName = m.name.replace(/"/g, '\\"');
          const safeKey = m.device_key.replace(/"/g, '\\"');
          return `  { ${zeroBased}, "${safeKey}", "${safeName}" },  // mapping table ${m.modbus_address}`;
        })
        .join("\n")
    : "  // No meters have a Modbus Address configured yet — add one for each meter in Admin first.";

  const mappingComment = configured.length > 0
    ? configured
        .map((m) => {
          const addr = m.modbus_address as number;
          return `//   Modbus Addr ${addr}-${addr + 1}  ->  ${m.name}  (DWORD)  [device_key ${m.device_key}]`;
        })
        .join("\n")
    : "//   (no meters configured yet)";

  const missingComment = missing.length > 0
    ? "//\n// ⚠ The following meters have NO Modbus Address set in Admin yet, so they\n// are NOT included below. Set each one's HMI Modbus Address in Admin > this\n// site > Meter & Sensor Configuration, then regenerate this sketch:\n" +
      missing.map((m) => `//   - ${m.name} (device_key ${m.device_key})`).join("\n") + "\n"
    : "";

  const sketch = `// Auto-generated for site: ${site.name}
// "Bulletproof" version — hardened for unattended field operation.
//
// Reads ${configured.length} meter value(s) from the Delta HMI/PLC over Modbus TCP
// (the HMI acts as a Modbus TCP Server on port 502, exposing PLC
// D-registers via the Modbus TCP Mapping Table configured in DOPSoft),
// then POSTs them over HTTPS to the wash dashboard ingest API.
//
// === MODBUS MAPPING (from DOPSoft Modbus TCP Mapping Table) ===
${mappingComment}
${missingComment}
// IMPORTANT: word order (high/low) for 32-bit values is uncertain.
// This tries LOW-word-first (register N = low 16 bits, N+1 = high 16
// bits), Delta's typical default. If a reading looks wildly wrong vs
// the HMI screen, swap combineWords() to: ((uint32_t)lo << 16) | hi;
//
// NOTE ON MODBUS ADDRESSING: mapping table addresses are 1-based
// (e.g. 3025). The wire protocol is 0-based, so 3025 in the table
// means we request address 3024. This -1 offset is already applied.
//
// === HARDENING NOTES (what makes this "bulletproof") ===
//  1. HTTPS actually works: HTTPClient on ESP32 needs an explicit
//     WiFiClientSecure attached via http.begin(client, url) for
//     https:// URLs to connect reliably. setInsecure() skips cert
//     validation (fine for this use case; the endpoint isn't handling
//     anything more sensitive than meter counts and an API key header).
//  2. Modbus reads retry up to MODBUS_MAX_RETRIES times before a
//     meter is marked failed for this cycle.
//  3. A hardware watchdog reboots the device if the main loop ever
//     stalls (bad socket state, driver lockup, etc.) for more than
//     WDT_TIMEOUT_S seconds.
//  4. WiFi reconnect uses backoff instead of hammering reconnect in
//     a tight loop when WiFi is down for an extended period.
//  5. The Modbus TCP socket is proactively closed/reopened every
//     SOCKET_REFRESH_CYCLES polls, since some Delta HMIs silently
//     let long-held sockets go stale without sending a FIN/RST.
//  6. Offline queue (SPIFFS) still buffers readings if the network
//     or API is down, and is capped at MAX_FILE_LINES.
//
// ============================================================
// TODO BEFORE FLASHING — fill in the values below from the dashboard:
//   1. WIFI_SSID / WIFI_PASS   -> WiFi credentials for this site
//   2. SITE_API_KEY            -> "ws_live_..." key for ${site.name}
//   3. HMI_IP                  -> IP address of the HMI/PLC on this site's LAN
// ============================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPIFFS.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

const char* WIFI_SSID    = "";                          // TODO: ${site.name} WiFi SSID
const char* WIFI_PASS    = "";                          // TODO: ${site.name} WiFi password
const char* SITE_API_KEY = "";                          // TODO: dashboard API key for ${site.name} (generate in Admin > this site > API Keys)
const char* INGEST_URL   = "${endpoint}";
const char* QUEUE_FILE   = "/queue.jsonl";

// HMI acting as Modbus TCP Server
const char* HMI_IP = "";   // TODO: ${site.name} HMI/PLC IP, e.g. "192.168.8.10"
const int   MODBUS_PORT = 502;

const unsigned long POLL_INTERVAL_MS   = ${pollIntervalSeconds}UL * 1000UL; // how often to read + send
const int           MAX_FILE_LINES     = 5000;
const int           MODBUS_MAX_RETRIES = 3;              // per-register retry attempts
const int           SOCKET_REFRESH_CYCLES = 40;           // ~10 min at 15s interval
const unsigned long WDT_TIMEOUT_S      = 30;              // reboot if loop stalls this long
const unsigned long WIFI_RETRY_BASE_MS = 2000;            // backoff base for WiFi reconnect
const unsigned long WIFI_RETRY_MAX_MS  = 60000;           // cap backoff at 60s

WiFiClient modbusSocket;
uint16_t modbusTransactionId = 0;
unsigned long lastPollMs = 0;
int pollsSinceSocketOpen = 0;
unsigned long wifiRetryDelay = WIFI_RETRY_BASE_MS;
unsigned long lastWifiAttemptMs = 0;
bool spiffsAvailable = false; // set in setup(); guards all offline-queue file access

// ===== Modbus register map =====
// modbusAddr is already 0-based (mapping table address minus 1).
struct MeterReg {
  int modbusAddr;
  const char* deviceKey;
  const char* label;
};

MeterReg meters[] = {
${meterEntries}
};
const int NUM_METERS = sizeof(meters) / sizeof(meters[0]);

// Combine two 16-bit registers into a 32-bit value.
// Delta typically stores DWORD as LOW word first, HIGH word second.
// If values look wrong once tested, swap to: ((uint32_t)lo << 16) | hi;
uint32_t combineWords(uint16_t lo, uint16_t hi) {
  return ((uint32_t)hi << 16) | lo;
}

// ===== SPIFFS helpers (offline-buffering pattern) =====
// All guarded by spiffsAvailable — if SPIFFS failed to mount in setup(),
// these become no-ops and loop() falls back to sending readings live
// instead of queuing them (see loop() below).
void appendToQueue(uint32_t values[], bool ok[], int count) {
  if (!spiffsAvailable) return;
  File f = SPIFFS.open(QUEUE_FILE, FILE_APPEND);
  if (!f) { Serial.println("Failed to open queue"); return; }
  f.print("{");
  for (int i = 0; i < count; i++) {
    f.printf("\\"v%d\\":%u,\\"ok%d\\":%d", i, values[i], i, ok[i] ? 1 : 0);
    if (i < count - 1) f.print(",");
  }
  f.println("}");
  f.close();
}

int countQueueLines() {
  if (!spiffsAvailable) return 0;
  File f = SPIFFS.open(QUEUE_FILE, FILE_READ);
  if (!f) return 0;
  int c = 0;
  while (f.available()) { f.readStringUntil('\\n'); c++; }
  f.close();
  return c;
}

void removeFirstLines(int n) {
  if (!spiffsAvailable) return;
  File src = SPIFFS.open(QUEUE_FILE, FILE_READ);
  File tmp = SPIFFS.open("/tmp.jsonl", FILE_WRITE);
  if (!src || !tmp) return;
  int skipped = 0;
  while (src.available()) {
    String line = src.readStringUntil('\\n');
    if (skipped < n) { skipped++; continue; }
    if (line.length() > 0) tmp.println(line);
  }
  src.close(); tmp.close();
  SPIFFS.remove(QUEUE_FILE);
  SPIFFS.rename("/tmp.jsonl", QUEUE_FILE);
}

// Builds the ingest JSON payload directly from live meter readings (used
// when SPIFFS isn't available, bypassing the on-disk queue entirely).
String buildPayloadFromLive(uint32_t values[], bool ok[]) {
  String payload = "{\\"readings\\":[";
  bool first = true;
  for (int i = 0; i < NUM_METERS; i++) {
    if (!ok[i]) continue;
    if (!first) payload += ",";
    payload += "{\\"device_key\\":\\"" + String(meters[i].deviceKey) + "\\",\\"value\\":" + String(values[i]) + "}";
    first = false;
  }
  payload += "]}";
  return payload;
}

// ===== WiFi with backoff =====
void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiRetryDelay = WIFI_RETRY_BASE_MS; // reset backoff once healthy
    return;
  }

  unsigned long now = millis();
  if (now - lastWifiAttemptMs < wifiRetryDelay) return; // still backing off
  lastWifiAttemptMs = now;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting WiFi");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 10000) {
    delay(250);
    Serial.print(".");
    esp_task_wdt_reset(); // don't let a slow connect trip the watchdog
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" OK");
    wifiRetryDelay = WIFI_RETRY_BASE_MS;
  } else {
    Serial.println(" FAIL, backing off");
    wifiRetryDelay = min(wifiRetryDelay * 2, WIFI_RETRY_MAX_MS);
  }
}

// ===== HTTPS send (fixed: explicit WiFiClientSecure so https:// actually connects) =====
bool postPayload(const String& payload) {
  WiFiClientSecure client;
  client.setInsecure(); // no cert pinning needed for this endpoint/use case

  HTTPClient http;
  if (!http.begin(client, INGEST_URL)) {
    Serial.println("http.begin() failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-site-api-key", SITE_API_KEY);
  http.setTimeout(8000);
  int code = http.POST(payload);
  http.end();

  if (code == 200) return true;
  Serial.printf("Send failed (HTTP %d)\\n", code);
  return false;
}

void flushQueue() {
  if (!spiffsAvailable) return;
  File f = SPIFFS.open(QUEUE_FILE, FILE_READ);
  if (!f || f.size() == 0) { if (f) f.close(); return; }
  int sent = 0;
  while (f.available()) {
    String line = f.readStringUntil('\\n');
    line.trim();
    if (line.length() == 0) continue;
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, line)) continue;

    String payload = "{\\"readings\\":[";
    bool first = true;
    for (int i = 0; i < NUM_METERS; i++) {
      char okKey[8];
      snprintf(okKey, sizeof(okKey), "ok%d", i);
      bool wasOk = doc[okKey] | 0;
      if (!wasOk) continue; // skip readings that failed this cycle - don't send bogus 0

      char key[8];
      snprintf(key, sizeof(key), "v%d", i);
      uint32_t val = doc[key];

      if (!first) payload += ",";
      payload += "{\\"device_key\\":\\"" + String(meters[i].deviceKey) + "\\",\\"value\\":" + String(val) + "}";
      first = false;
    }
    payload += "]}";

    if (first) continue; // every reading in this queued line failed

    if (WiFi.status() != WL_CONNECTED) connectWifi();
    if (WiFi.status() != WL_CONNECTED) break;

    if (postPayload(payload)) {
      sent++;
    } else {
      break; // stop on first failure, retry whole remaining queue next cycle
    }
    esp_task_wdt_reset();
  }
  f.close();
  if (sent > 0) {
    Serial.printf("Flushed %d records\\n", sent);
    removeFirstLines(sent);
  }
}

bool ensureModbusConnected(bool forceReconnect = false) {
  if (forceReconnect && modbusSocket.connected()) {
    modbusSocket.stop();
  }
  if (modbusSocket.connected()) return true;

  Serial.print("Connecting to HMI Modbus TCP...");
  if (!modbusSocket.connect(HMI_IP, MODBUS_PORT)) {
    Serial.println(" FAILED");
    return false;
  }
  modbusSocket.setTimeout(2000);
  Serial.println(" OK");
  pollsSinceSocketOpen = 0;
  return true;
}

// Reads \`numRegs\` holding registers starting at \`startAddr\` (0-based)
// from the Modbus TCP server. Writes results into outRegs[]. Returns
// true on success.
bool modbusReadHoldingRegistersOnce(uint16_t startAddr, uint16_t numRegs, uint16_t outRegs[]) {
  if (!ensureModbusConnected()) return false;

  // Flush any stale/leftover bytes sitting in the socket buffer from a
  // previous slow response before sending a new request.
  while (modbusSocket.available()) {
    modbusSocket.read();
  }

  modbusTransactionId++;

  // Build the Modbus TCP request frame (MBAP header + PDU)
  uint8_t request[12];
  request[0] = (modbusTransactionId >> 8) & 0xFF; // Transaction ID hi
  request[1] = modbusTransactionId & 0xFF;        // Transaction ID lo
  request[2] = 0x00;                              // Protocol ID hi (always 0)
  request[3] = 0x00;                              // Protocol ID lo (always 0)
  request[4] = 0x00;                              // Length hi
  request[5] = 0x06;                              // Length lo (6 bytes follow)
  request[6] = 0x01;                              // Unit ID (station number)
  request[7] = 0x03;                              // Function code: Read Holding Registers
  request[8] = (startAddr >> 8) & 0xFF;           // Start address hi
  request[9] = startAddr & 0xFF;                  // Start address lo
  request[10] = (numRegs >> 8) & 0xFF;            // Quantity hi
  request[11] = numRegs & 0xFF;                   // Quantity lo

  modbusSocket.write(request, sizeof(request));

  // Expected response: 9-byte header/prefix + 2 bytes per register
  int expectedLen = 9 + (numRegs * 2);
  uint8_t response[64];
  int received = 0;
  unsigned long t0 = millis();
  while (received < expectedLen && millis() - t0 < 2000) {
    if (modbusSocket.available()) {
      int n = modbusSocket.read(response + received, expectedLen - received);
      if (n > 0) received += n;
    } else {
      delay(2);
    }
  }

  if (received < expectedLen) {
    Serial.printf("Modbus read timeout (got %d of %d bytes)\\n", received, expectedLen);
    modbusSocket.stop(); // force reconnect next attempt
    return false;
  }

  // response[7] = function code (should echo 0x03, or 0x83 if error)
  if (response[7] == 0x83) {
    Serial.printf("Modbus exception code: 0x%02X\\n", response[8]);
    return false;
  }
  if (response[7] != 0x03) {
    Serial.println("Unexpected Modbus function code in response");
    return false;
  }

  // response[8] = byte count, response[9..] = register data (big-endian per register)
  for (int i = 0; i < numRegs; i++) {
    uint8_t hiByte = response[9 + (i * 2)];
    uint8_t loByte = response[9 + (i * 2) + 1];
    outRegs[i] = ((uint16_t)hiByte << 8) | loByte;
  }
  return true;
}

// Retries a register read up to MODBUS_MAX_RETRIES times, forcing a
// fresh socket connection between attempts.
bool modbusReadHoldingRegisters(uint16_t startAddr, uint16_t numRegs, uint16_t outRegs[]) {
  for (int attempt = 1; attempt <= MODBUS_MAX_RETRIES; attempt++) {
    if (modbusReadHoldingRegistersOnce(startAddr, numRegs, outRegs)) return true;
    Serial.printf("  retry %d/%d for addr %u\\n", attempt, MODBUS_MAX_RETRIES, startAddr);
    ensureModbusConnected(true); // force reconnect before next attempt
    delay(150);
    esp_task_wdt_reset();
  }
  return false;
}

bool readAllMeters(uint32_t outValues[], bool outOk[]) {
  bool anyOk = false;

  // Proactively refresh the socket periodically — some Delta HMIs let
  // long-held Modbus sockets go stale without a clean FIN/RST.
  pollsSinceSocketOpen++;
  if (pollsSinceSocketOpen >= SOCKET_REFRESH_CYCLES) {
    Serial.println("Refreshing Modbus socket (periodic maintenance)");
    ensureModbusConnected(true);
  }

  for (int i = 0; i < NUM_METERS; i++) {
    uint16_t regs[2];
    if (!modbusReadHoldingRegisters((uint16_t)meters[i].modbusAddr, 2, regs)) {
      Serial.printf("%s: read failed after retries\\n", meters[i].label);
      outValues[i] = 0;
      outOk[i] = false;
      delay(100);
      esp_task_wdt_reset();
      continue;
    }

    uint16_t lo = regs[0];
    uint16_t hi = regs[1];
    outValues[i] = combineWords(lo, hi);
    outOk[i] = true;
    anyOk = true;

    Serial.printf("%s (Modbus addr %d): raw lo=%u hi=%u -> value=%u\\n",
                  meters[i].label, meters[i].modbusAddr + 1, lo, hi, outValues[i]);

    delay(100); // brief pause between requests, avoids overlapping/stale responses
    esp_task_wdt_reset();
  }
  return anyOk; // true if AT LEAST ONE meter was read successfully this cycle
}

void setup() {
  Serial.begin(115200);
  delay(500);

  // Hardware watchdog: reboot automatically if the loop ever stalls.
  //
  // NOTE: newer Arduino-ESP32 cores (3.x, ESP-IDF 5.x) already auto-init the
  // Task Watchdog Timer for the idle tasks before setup() ever runs. Calling
  // esp_task_wdt_init() again on top of that returns ESP_ERR_INVALID_STATE
  // ("TWDT already initialized") — reconfigure the existing one instead of
  // treating that as a fatal error.
  esp_task_wdt_config_t wdtConfig = {
    .timeout_ms = WDT_TIMEOUT_S * 1000,
    .idle_core_mask = 0,
    .trigger_panic = true
  };
  esp_err_t wdtInitErr = esp_task_wdt_init(&wdtConfig);
  if (wdtInitErr == ESP_ERR_INVALID_STATE) {
    esp_task_wdt_reconfigure(&wdtConfig);
  } else if (wdtInitErr != ESP_OK) {
    Serial.printf("WDT init returned %d (continuing)\\n", wdtInitErr);
  }
  esp_err_t wdtAddErr = esp_task_wdt_add(NULL);
  if (wdtAddErr != ESP_OK && wdtAddErr != ESP_ERR_INVALID_ARG) {
    Serial.printf("WDT add returned %d (continuing)\\n", wdtAddErr);
  }

  // SPIFFS mount, with an explicit format-and-retry if the first mount
  // fails (error -10025 / SPIFFS_ERR_NOT_A_FS means the flash region isn't
  // a valid filesystem yet — first boot on a fresh chip, or the previous
  // partition table used a different filesystem there).
  //
  // If SPIFFS still isn't available after that (e.g. the board's Partition
  // Scheme in Tools menu doesn't actually allocate a SPIFFS partition), the
  // device keeps running WITHOUT the offline queue: readings are sent live
  // each cycle and simply dropped (not buffered) if the network is down,
  // rather than the whole device being non-functional.
  if (SPIFFS.begin(true)) {
    spiffsAvailable = true;
  } else {
    Serial.println("SPIFFS mount failed, formatting...");
    if (SPIFFS.format() && SPIFFS.begin(true)) {
      spiffsAvailable = true;
      Serial.println("SPIFFS formatted and mounted OK");
    } else {
      spiffsAvailable = false;
      Serial.println("SPIFFS unavailable — running WITHOUT offline queue buffering.");
      Serial.println("Check Tools > Partition Scheme in Arduino IDE: pick a scheme that includes a SPIFFS partition (e.g. 'Default 4MB with spiffs').");
    }
  }
  if (spiffsAvailable) {
    Serial.printf("SPIFFS OK — %u bytes free\\n", SPIFFS.totalBytes() - SPIFFS.usedBytes());
  }

  connectWifi();
}

void loop() {
  esp_task_wdt_reset();

  if (WiFi.status() != WL_CONNECTED) connectWifi();

  unsigned long now = millis();
  if (now - lastPollMs >= POLL_INTERVAL_MS) {
    lastPollMs = now;

    uint32_t values[NUM_METERS];
    bool ok[NUM_METERS];
    readAllMeters(values, ok); // fills what it can; failed reads are marked not-ok

    if (spiffsAvailable) {
      if (countQueueLines() >= MAX_FILE_LINES) removeFirstLines(100);
      appendToQueue(values, ok, NUM_METERS);
      flushQueue();
    } else {
      // No offline buffering available this boot — send directly. If this
      // fails (WiFi/API down), this cycle's reading is simply skipped
      // rather than queued, since there's nowhere to persist it.
      bool anyOk = false;
      for (int i = 0; i < NUM_METERS; i++) if (ok[i]) { anyOk = true; break; }
      if (anyOk && WiFi.status() == WL_CONNECTED) {
        postPayload(buildPayloadFromLive(values, ok));
      }
    }
  }

  delay(10);
}
`;

  return sketch;
}


function EspSketchDialog({ site, meters, onClose }: { site: Site | null; meters: Meter[]; onClose: () => void }) {
  const code = site ? buildEsp32Sketch(site, meters) : "";
  return (
    <Dialog open={!!site} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-4 overflow-hidden shadow-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            ESP32 Configuration Script — {site?.name}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground shrink-0 leading-relaxed">
          Copy the code below into the Arduino IDE. Ensure you have the <strong>ESP32 Board Library</strong> installed. Wire your pulse counters or level sensors to the designated GPIO pins and map them to the <code>TODO</code> variables at the bottom of the sketch.
        </p>
        <div className="flex-1 relative overflow-hidden rounded-lg border border-border bg-black/5">
          <Textarea readOnly value={code} className="font-mono text-[11px] h-full w-full resize-none bg-transparent p-6 leading-relaxed" spellCheck={false} />
          <Button
            size="sm"
            className="absolute right-4 top-4 shadow-lg h-8 px-4 font-bold"
            onClick={() => { navigator.clipboard.writeText(code); toast.success("Sketch copied to clipboard"); }}
          >
            <Copy className="h-3.5 w-3.5 mr-2" /> Copy to Clipboard
          </Button>
        </div>
        <DialogFooter className="shrink-0 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="h-9 font-semibold">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  roles: string[];
}

function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const list = useServerFn(listAllUsers);
  const setRole = useServerFn(setUserRole);
  const del = useServerFn(deleteUser);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? '';
  const data = await (list as any)({ data: { __token: token } });
      setUsers(data as AdminUser[]);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line

  const changeRole = async (userId: string, role: "admin" | "operator" | "none") => {
    setBusyId(userId);
    try {
  const { data: { session: s1 } } = await supabase.auth.getSession();
  await (setRole as any)({ data: { userId, role, __token: s1?.access_token ?? '' } });
    toast.success(role === "none" ? "Access revoked" : `Set as ${role}`);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusyId(null);
    }
  };

  const removeUser = async (userId: string, email: string) => {
    if (!confirm(`Permanently delete ${email}? This cannot be undone.`)) return;
    setBusyId(userId);
    try {
      const { data: { session: s2 } } = await supabase.auth.getSession();
await (del as any)({ data: { userId, __token: s2?.access_token ?? '' } });
      toast.success("User deleted");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusyId(null);
    }
  };

  const pending = users.filter((u) => u.roles.length === 0);
  const approved = users.filter((u) => u.roles.length > 0);

  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm border-l-4 border-l-amber-500/60">
      <div className="flex items-center gap-2 mb-1">
        <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h2 className="font-semibold text-lg">User Access Control</h2>
          <p className="text-xs text-muted-foreground">Approve new sign-ups and manage roles.</p>
        </div>
        {loading && <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {pending.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-2">
            <AlertTriangle className="h-3 w-3" /> Pending Approval ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map((u) => (
              <UserRow key={u.id} user={u} busy={busyId === u.id} currentUserId={currentUserId}
                onApprove={(role) => changeRole(u.id, role)}
                onRevoke={() => changeRole(u.id, "none")}
                onDelete={() => removeUser(u.id, u.email)}
                isPending
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Approved Users ({approved.length})
        </h3>
        <div className="space-y-2">
          {approved.map((u) => (
            <UserRow key={u.id} user={u} busy={busyId === u.id} currentUserId={currentUserId}
              onApprove={(role) => changeRole(u.id, role)}
              onRevoke={() => changeRole(u.id, "none")}
              onDelete={() => removeUser(u.id, u.email)}
            />
          ))}
          {approved.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground italic py-3">No approved users yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function UserRow({
  user, busy, currentUserId, onApprove, onRevoke, onDelete, isPending,
}: {
  user: AdminUser; busy: boolean; currentUserId: string;
  onApprove: (role: "admin" | "operator") => void;
  onRevoke: () => void;
  onDelete: () => void;
  isPending?: boolean;
}) {
  const isSelf = user.id === currentUserId;
  const [sitesOpen, setSitesOpen] = useState(false);
  const isOperator = user.roles.includes("operator");
  const isAdmin = user.roles.includes("admin");
  return (
    <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border px-4 py-3 ${isPending ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-background"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{user.email}</span>
          {isSelf && <span className="text-[9px] font-bold uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded">You</span>}
          {user.roles.map((r) => (
            <span key={r} className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${r === "admin" ? "bg-violet-500/10 text-violet-500" : "bg-emerald-500/10 text-emerald-500"}`}>
              {r}
            </span>
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Joined {new Date(user.created_at).toLocaleDateString()}
          {user.last_sign_in_at && ` · Last seen ${new Date(user.last_sign_in_at).toLocaleDateString()}`}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {isPending ? (
          <>
            <Button size="sm" variant="default" disabled={busy} onClick={() => onApprove("operator")} className="h-8 text-xs gap-1">
              <UserCheck className="h-3 w-3" /> Approve
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onApprove("admin")} className="h-8 text-xs">
              Approve as Admin
            </Button>
          </>
        ) : (
          <>
            {isOperator && (
              <Button size="sm" variant="outline" onClick={() => setSitesOpen(true)} className="h-8 text-xs gap-1">
                <Building2 className="h-3 w-3" /> Sites
              </Button>
            )}
            {isAdmin && (
              <span className="text-[10px] text-muted-foreground italic px-2">All sites</span>
            )}
            <Select disabled={busy || isSelf} value={user.roles[0] ?? "none"} onValueChange={(v) => {
              if (v === "none") onRevoke();
              else onApprove(v as "admin" | "operator");
            }}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="operator">Operator</SelectItem>
                <SelectItem value="none">Revoke access</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        {!isSelf && (
          <Button size="icon" variant="ghost" disabled={busy} onClick={onDelete} className="h-8 w-8 text-destructive hover:bg-destructive/10">
            <UserX className="h-4 w-4" />
          </Button>
        )}
      </div>
      <SiteAccessDialog open={sitesOpen} onOpenChange={setSitesOpen} userId={user.id} userEmail={user.email} />
    </div>
  );
}

function SiteAccessDialog({
  open, onOpenChange, userId, userEmail,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  userEmail: string;
}) {
  const [sites, setSites] = useState<{ id: string; name: string; location: string | null }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const [{ data: s, error: sErr }, { data: a, error: aErr }] = await Promise.all([
          supabase.from("sites").select("id,name,location").order("name"),
          supabase.from("site_operators").select("site_id").eq("user_id", userId),
        ]);
        if (sErr) throw sErr;
        if (aErr) throw aErr;
        setSites((s as any) ?? []);
        setSelected(new Set(((a as any) ?? []).map((r: { site_id: string }) => r.site_id)));
      } catch (e: any) {
        toast.error(e.message ?? "Failed to load sites");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, userId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      // Replace all assignments for this user
      const { error: delErr } = await supabase.from("site_operators").delete().eq("user_id", userId);
      if (delErr) throw delErr;
      const rows = Array.from(selected).map((site_id) => ({ user_id: userId, site_id }));
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("site_operators").insert(rows);
        if (insErr) throw insErr;
      }
      toast.success(`Site access updated (${rows.length} site${rows.length === 1 ? "" : "s"})`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Site Access
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Select which sites <strong>{userEmail}</strong> can view on their dashboard.
          </p>
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {loading ? (
            <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
          ) : sites.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground italic">No sites registered yet.</p>
          ) : (
            sites.map((s) => (
              <label key={s.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30">
                <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  {s.location && <div className="text-[10px] text-muted-foreground truncate">{s.location}</div>}
                </div>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Access ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



function EmailSubscriptionsPanel({ sites }: { sites: Site[] }) {
  const [configs, setConfigs] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(false);
  const [testSending, setTestSending] = useState<string | null>(null);

  useEffect(() => {
    loadAllConfigs();
  }, [sites]);

  const loadAllConfigs = async () => {
    try {
      const { data: subscriptions } = await supabase
        .from("email_subscriptions")
        .select("*");
      
      const configMap = new Map();
      sites.forEach((site) => {
        const subs = subscriptions?.filter((s: any) => s.site_id === site.id) || [];
        configMap.set(site.id, {
          scheduled_hour: subs[0]?.scheduled_hour || 7,
          timezone: subs[0]?.timezone || "UTC",
          recipients: subs[0]?.recipients?.join(", ") || "",
          send_daily: subs[0]?.send_daily ?? true,
          send_monthly: subs[0]?.send_monthly ?? false,
          is_active: subs[0]?.is_active ?? true,
          subscription_id: subs[0]?.id,
        });
      });
      setConfigs(configMap);
    } catch (e) {
      console.error("Failed to load configs:", e);
    }
  };

  const updateConfig = async (siteId: string, field: string, value: any) => {
    const config = configs.get(siteId);
    const updated = { ...config, [field]: value };
    setConfigs(new Map(configs).set(siteId, updated));
  };

  const saveConfig = async (siteId: string) => {
    setLoading(true);
    try {
      const config = configs.get(siteId);
      const site = sites.find((s) => s.id === siteId);
      const recipients = config.recipients
        .split(",")
        .map((e: string) => e.trim())
        .filter((e: string) => e);

      if (recipients.length === 0) {
        toast.error("Please add at least one recipient email");
        setLoading(false);
        return;
      }

      if (config.subscription_id) {
        // Update existing
        const { error } = await supabase
          .from("email_subscriptions")
          .update({
            scheduled_hour: parseInt(config.scheduled_hour),
            timezone: config.timezone,
            recipients,
            send_daily: config.send_daily,
            send_monthly: config.send_monthly,
            is_active: config.is_active,
          })
          .eq("id", config.subscription_id);
        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase
          .from("email_subscriptions")
          .insert({
            site_id: siteId,
            email: recipients[0],
            recipients,
            scheduled_hour: parseInt(config.scheduled_hour),
            timezone: config.timezone,
            send_daily: config.send_daily,
            send_monthly: config.send_monthly,
            is_active: config.is_active,
            period: "daily",
          });
        if (error) throw error;
      }

      toast.success(`Email schedule saved for ${site?.name}`);
      await loadAllConfigs();
    } catch (e: any) {
      toast.error(e.message || "Failed to save configuration");
    } finally {
      setLoading(false);
    }
  };

  const sendTestEmail = async (siteId: string) => {
    setTestSending(siteId);
    try {
      const config = configs.get(siteId);
      const recipients = config.recipients
        .split(",")
        .map((e: string) => e.trim())
        .filter((e: string) => e);

      if (recipients.length === 0) {
        toast.error("Please add at least one recipient email");
        setTestSending(null);
        return;
      }

      const response = await fetch("/api/public/hooks/send-test-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          recipients,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to send test email");
      
      toast.success("✅ Test email sent! Check your inbox.");
    } catch (e: any) {
      toast.error(e.message || "Failed to send test email");
    } finally {
      setTestSending(null);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <Mail className="h-5 w-5 text-primary" />
        Email Report Schedules
      </h2>

      <div className="space-y-4">
        {sites.map((site) => {
          const config = configs.get(site.id) || {
            scheduled_hour: 7,
            timezone: "UTC",
            recipients: "",
            send_daily: true,
            send_monthly: false,
            is_active: true,
          };

          return (
            <div key={site.id} className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
              {/* Site Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-base">{site.name}</h3>
                  {site.location && <p className="text-xs text-muted-foreground">{site.location}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {config.is_active ? "🟢 Active" : "⚫ Disabled"}
                  </span>
                  <Switch
                    checked={config.is_active}
                    onCheckedChange={(checked) =>
                      updateConfig(site.id, "is_active", checked)
                    }
                  />
                </div>
              </div>

              {/* Configuration Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Send Time */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Send Time (24h)</Label>
                  <Select
                    value={String(config.scheduled_hour).padStart(2, "0")}
                    onValueChange={(val) =>
                      updateConfig(site.id, "scheduled_hour", parseInt(val))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={String(i).padStart(2, "0")}>
                          {String(i).padStart(2, "0")}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Timezone */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Timezone</Label>
                  <Select value={config.timezone} onValueChange={(val) => updateConfig(site.id, "timezone", val)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="America/New_York">EST/EDT</SelectItem>
                      <SelectItem value="America/Chicago">CST/CDT</SelectItem>
                      <SelectItem value="America/Denver">MST/MDT</SelectItem>
                      <SelectItem value="America/Los_Angeles">PST/PDT</SelectItem>
                      <SelectItem value="Europe/London">GMT/BST</SelectItem>
                      <SelectItem value="Europe/Paris">CET/CEST</SelectItem>
                      <SelectItem value="Asia/Dubai">GST</SelectItem>
                      <SelectItem value="Asia/Tokyo">JST</SelectItem>
                      <SelectItem value="Australia/Sydney">AEDT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Recipients */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Recipients (comma-separated emails)</Label>
                <Textarea
                  value={config.recipients}
                  onChange={(e) => updateConfig(site.id, "recipients", e.target.value)}
                  placeholder="manager@company.com, ops@company.com"
                  rows={2}
                  className="text-sm resize-none"
                />
                <p className="text-[11px] text-muted-foreground">
                  💡 Multiple addresses supported. One per line or comma-separated.
                </p>
              </div>

              {/* Report Type Toggles */}
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
                <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                  <label className="text-xs font-medium cursor-pointer flex-1">
                    Daily Reports
                  </label>
                  <Switch
                    checked={config.send_daily}
                    onCheckedChange={(checked) =>
                      updateConfig(site.id, "send_daily", checked)
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                  <label className="text-xs font-medium cursor-pointer flex-1">
                    Monthly Reports
                  </label>
                  <Switch
                    checked={config.send_monthly}
                    onCheckedChange={(checked) =>
                      updateConfig(site.id, "send_monthly", checked)
                    }
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 border-t border-border pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => sendTestEmail(site.id)}
                  disabled={testSending === site.id || !config.recipients.trim()}
                  className="flex-1 gap-2 text-xs h-9"
                >
                  {testSending === site.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Test Email
                </Button>
                <Button
                  onClick={() => saveConfig(site.id)}
                  disabled={loading || !config.recipients.trim()}
                  className="flex-1 gap-2 text-xs h-9"
                >
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  Save Schedule
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
