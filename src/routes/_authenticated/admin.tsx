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
import { createSiteApiKey, grantAdminBootstrap, seedDemoData, getSmtpSettings, updateSmtpSettings, listAllUsers, setUserRole, deleteUser } from "@/lib/admin.functions";
import { Copy, Plus, Trash2, KeyRound, Sparkles, Cpu, Mail, Send, Server, ShieldCheck, Loader2, AlertTriangle, Users, UserCheck, UserX, Building2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

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
}
interface Meter { id: string; site_id: string; meter_type: "wash"|"fresh_water"|"chemical"|"chemical_flow"; name: string; unit: string; capacity: number | null; low_threshold: number | null; device_key: string; position: number; chemical_group: string | null }
interface ApiKeyRow { id: string; site_id: string; key_prefix: string; label: string | null; revoked: boolean; last_used_at: string | null; created_at: string }

const SETUP_SQL_HINT =
  "Supabase Dashboard → SQL Editor → run scripts/setup-admin.sql from this repo.";

function AdminPage() {
  const { isAdmin, refreshRoles, user, loading } = useAuth();
  const nav = useNavigate();
  const bootstrapServer = useServerFn(grantAdminBootstrap);
  const seed = useServerFn(seedDemoData);

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Console</h1>
          <p className="text-muted-foreground mt-1 text-sm">Configure site infrastructure, monitor ESP32 connectivity, and manage reports.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={async () => {
          const r = await seed();
          if (r.seeded) {
            toast.success("Demo environment initialized");
            load();
          } else {
            toast.info("Database already contains data — seeding skipped");
          }
        }} className="gap-2 shrink-0">
          <Sparkles className="h-4 w-4" /> Initialize Demo Sites
        </Button>
      </div>

      <UsersPanel currentUserId={user?.id ?? ""} />

      <EmailSubscriptionsPanel sites={sites} />

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
              onRemoveMeter={removeMeter}
              onGenerateKey={() => handleGenKey(site.id)}
              onRevokeKey={revokeKey}
              onGenerateSketch={() => setSketchSite(site)}
              onUpdateBranding={(branding) => updateBranding(site.id, branding)}
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

function SmtpSettingsPanel() {
  const get = useServerFn(getSmtpSettings);
  const update = useServerFn(updateSmtpSettings);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [userEmail, setUserEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fromName, setFromName] = useState("WashGrid Dashboard");
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
        setFromName(data.from_name || "WashGrid Dashboard");
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
          <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="WashGrid Automations" />
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

function SiteAdminCard({
  site, meters, keys, onRemoveSite, onAddMeter, onRemoveMeter, onGenerateKey, onRevokeKey, onGenerateSketch, onUpdateBranding,
}: {
  site: Site; meters: Meter[]; keys: ApiKeyRow[];
  onRemoveSite: () => void;
  onAddMeter: (m: Partial<Meter>) => Promise<boolean>;
  onRemoveMeter: (id: string) => void;
  onGenerateKey: () => void;
  onRevokeKey: (id: string) => void;
  onGenerateSketch: () => void;
  onUpdateBranding: (branding: { primary_color: string; secondary_color: string; accent_color: string; logo_url: string | null; background_url: string | null }) => Promise<boolean>;
}) {
  const [type, setType] = useState<Meter["meter_type"]>("chemical");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("L");
  const [deviceKey, setDeviceKey] = useState("");
  const [capacity, setCapacity] = useState("");
  const [low, setLow] = useState("");
  const [group, setGroup] = useState("");
  // No branding customization - original simple setup

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden transition-all hover:shadow-md">
      <div className="bg-muted/30 px-6 py-4 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-background border border-border flex items-center justify-center font-bold text-primary">
            {site.name.charAt(0)}
          </div>
          <div>
            <h3 className="font-bold text-lg leading-tight">{site.name}</h3>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wider font-medium">
              <Cpu className="h-3 w-3" />
              {site.location || "Remote Site"}
              <span className="mx-1 opacity-30">•</span>
              {meters.length} Sensor{meters.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onGenerateSketch} disabled={meters.length === 0} className="h-8 text-xs font-semibold">
            <Cpu className="h-3.5 w-3.5 mr-1.5" /> Sketch
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemoveSite} className="h-8 w-8 text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="p-6 space-y-8">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Meter & Sensor Configuration</h4>
          </div>

          <div className="space-y-2">
            {meters.map((m) => (
              <div key={m.id} className="group flex items-center justify-between rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/30">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center justify-center px-2 py-1 rounded bg-muted font-mono text-[10px] font-bold text-muted-foreground">
                    ID
                    <span className="text-primary">{m.device_key}</span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{m.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground/70">{m.meter_type.replace("_", " ")}</span>
                      {m.chemical_group && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold border border-indigo-500/10">
                          GRP: {m.chemical_group}
                        </span>
                      )}
                      {m.capacity && <span className="text-[10px] text-muted-foreground/60">CAP: {m.capacity}{m.unit}</span>}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => onRemoveMeter(m.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}

            {meters.length === 0 && (
              <div className="text-center py-6 border-2 border-dashed border-border rounded-lg bg-muted/10">
                <p className="text-xs text-muted-foreground italic">No sensors configured for this site.</p>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-lg bg-muted/20 p-4 border border-border/40">
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-3 tracking-widest">Connect New Meter</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px]">Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as any)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wash">Wash</SelectItem>
                    <SelectItem value="fresh_water">Water</SelectItem>
                    <SelectItem value="chemical">Level</SelectItem>
                    <SelectItem value="chemical_flow">Flow</SelectItem>
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
                    capacity: capacity ? Number(capacity) : null,
                    low_threshold: low ? Number(low) : null,
                    chemical_group: group.trim() || null,
                  });
                  if (!ok) return;
                  setName(""); setDeviceKey(""); setCapacity(""); setLow(""); setGroup("");
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
          <ReportSettings site={site} onSaved={() => { /* parent will refetch on next mount */ }} />
        </div>
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
  
  // Hardcoded Modbus register mapping for Delta HMI
  // Adjust these based on your actual HMI configuration
  const modbusMap: Record<string, number> = {
    "wash_count": 3025,
    "rinse_meter": 3027,
    "recycle_topup": 3029,
    "multi_clean_chem": 3031,
    "autowash_chem": 3033,
    "peach_wax_chem": 3035,
  };
  
  // Create meter to register mapping
  const meterToRegister = new Map<string, number>();
  for (const m of meters) {
    // Map meter device_key to register address if available
    // For now use a simple mapping - you can customize this per site
    if (m.meter_type === "wash") meterToRegister.set(m.device_key, modbusMap.wash_count);
    else if (m.meter_type === "fresh_water" && m.name.toLowerCase().includes("rinse")) meterToRegister.set(m.device_key, modbusMap.rinse_meter);
    else if (m.meter_type === "fresh_water" && m.name.toLowerCase().includes("recycle")) meterToRegister.set(m.device_key, modbusMap.recycle_topup);
    else if (m.meter_type === "chemical" && m.name.toLowerCase().includes("multi")) meterToRegister.set(m.device_key, modbusMap.multi_clean_chem);
    else if (m.meter_type === "chemical" && m.name.toLowerCase().includes("autowash")) meterToRegister.set(m.device_key, modbusMap.autowash_chem);
    else if (m.meter_type === "chemical" && m.name.toLowerCase().includes("wax")) meterToRegister.set(m.device_key, modbusMap.peach_wax_chem);
  }

  const sketch = `#include <WiFi.h>
#include <ArduinoJson.h>
#include <ModbusTCP.h>
#include <time.h>

// WiFi Configuration
const char* SSID = "YOUR_SSID";
const char* PASSWORD = "YOUR_PASSWORD";
const char* HMI_IP = "192.168.1.100";      // Delta HMI IP address
const uint16_t HMI_PORT = 502;             // Modbus TCP port (default 502)

// API Configuration
const char* API_KEY = "YOUR_SITE_API_KEY"; // From the admin panel
const char* API_ENDPOINT = "${endpoint}";

// Modbus register addresses for Delta HMI
const uint16_t REG_WASH_COUNT = 3025;
const uint16_t REG_RINSE_METER = 3027;
const uint16_t REG_RECYCLE_TOPUP = 3029;
const uint16_t REG_MULTI_CLEAN_CHEM = 3031;
const uint16_t REG_AUTOWASH_CHEM = 3033;
const uint16_t REG_PEACH_WAX_CHEM = 3035;

// Previous readings (for detecting changes)
struct {
  uint32_t wash_count = 0;
  uint32_t rinse_meter = 0;
  uint32_t recycle_topup = 0;
  uint8_t multi_clean_chem = 0;
  uint8_t autowash_chem = 0;
  uint8_t peach_wax_chem = 0;
} prevReadings;

ModbusTCP modbus;
unsigned long lastReadTime = 0;
const unsigned long READ_INTERVAL = 5000;  // Read every 5 seconds

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\\n\\nESP32 Modbus TCP Client");
  Serial.println("Connecting to WiFi...");
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(SSID, PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\\nWiFi connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\\nFailed to connect to WiFi");
  }
  
  // Set up time for timestamps
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("Waiting for NTP time sync...");
  time_t now = time(nullptr);
  while (now < 24 * 3600 * 2) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println("\\nTime synced");
  
  // Connect to Modbus TCP server
  Serial.print("Connecting to Modbus TCP server at ");
  Serial.print(HMI_IP);
  Serial.print(":");
  Serial.println(HMI_PORT);
  
  modbus.begin(HMI_IP, HMI_PORT);
}

void loop() {
  unsigned long now = millis();
  
  if (now - lastReadTime >= READ_INTERVAL) {
    lastReadTime = now;
    
    if (!modbus.isConnected(HMI_IP, HMI_PORT)) {
      Serial.println("Modbus TCP disconnected, reconnecting...");
      modbus.begin(HMI_IP, HMI_PORT);
      delay(1000);
    }
    
    if (modbus.isConnected(HMI_IP, HMI_PORT)) {
      readModbusAndSend();
    } else {
      Serial.println("Failed to connect to Modbus TCP server");
    }
  }
  
  delay(100);
}

void readModbusAndSend() {
  JsonDocument doc;
  JsonArray readings = doc.createNestedArray("readings");
  
  bool hasReadings = false;
  
  // Read all registers
  // Wash count - absolute counter (total)
  uint32_t washCount = readHoldingRegister(REG_WASH_COUNT);
  if (washCount != prevReadings.wash_count) {
    JsonObject r = readings.createNestedObject();
    r["device_key"] = "0001";  // Wash Count
    r["value"] = washCount;
    r["type"] = "total";
    prevReadings.wash_count = washCount;
    hasReadings = true;
    Serial.print("Wash Count: ");
    Serial.println(washCount);
  }
  
  // Rinse meter - absolute counter (total)
  uint32_t rinseMeter = readHoldingRegister(REG_RINSE_METER);
  if (rinseMeter != prevReadings.rinse_meter) {
    JsonObject r = readings.createNestedObject();
    r["device_key"] = "0002";  // Rinse Meter
    r["value"] = rinseMeter;
    r["type"] = "total";
    prevReadings.rinse_meter = rinseMeter;
    hasReadings = true;
    Serial.print("Rinse Meter: ");
    Serial.println(rinseMeter);
  }
  
  // Recycle top-up - absolute counter (total)
  uint32_t recycleTopup = readHoldingRegister(REG_RECYCLE_TOPUP);
  if (recycleTopup != prevReadings.recycle_topup) {
    JsonObject r = readings.createNestedObject();
    r["device_key"] = "0003";  // Recycle Top-up
    r["value"] = recycleTopup;
    r["type"] = "total";
    prevReadings.recycle_topup = recycleTopup;
    hasReadings = true;
    Serial.print("Recycle Top-up: ");
    Serial.println(recycleTopup);
  }
  
  // Chemical levels (0=full, 1=empty)
  uint8_t multiCleanChem = readHoldingRegister(REG_MULTI_CLEAN_CHEM) & 0xFF;
  if (multiCleanChem != prevReadings.multi_clean_chem) {
    JsonObject r = readings.createNestedObject();
    r["device_key"] = "CHEM_001";  // Multi Clean Chemical
    r["value"] = multiCleanChem;
    r["type"] = "level";
    prevReadings.multi_clean_chem = multiCleanChem;
    hasReadings = true;
    Serial.print("Multi Clean Chemical: ");
    Serial.println(multiCleanChem == 0 ? "FULL" : "LOW");
  }
  
  uint8_t autowashChem = readHoldingRegister(REG_AUTOWASH_CHEM) & 0xFF;
  if (autowashChem != prevReadings.autowash_chem) {
    JsonObject r = readings.createNestedObject();
    r["device_key"] = "CHEM_002";  // Autowash Chemical
    r["value"] = autowashChem;
    r["type"] = "level";
    prevReadings.autowash_chem = autowashChem;
    hasReadings = true;
    Serial.print("Autowash Chemical: ");
    Serial.println(autowashChem == 0 ? "FULL" : "LOW");
  }
  
  uint8_t peachWaxChem = readHoldingRegister(REG_PEACH_WAX_CHEM) & 0xFF;
  if (peachWaxChem != prevReadings.peach_wax_chem) {
    JsonObject r = readings.createNestedObject();
    r["device_key"] = "CHEM_003";  // Peach Wax Chemical
    r["value"] = peachWaxChem;
    r["type"] = "level";
    prevReadings.peach_wax_chem = peachWaxChem;
    hasReadings = true;
    Serial.print("Peach Wax Chemical: ");
    Serial.println(peachWaxChem == 0 ? "FULL" : "LOW");
  }
  
  // If any readings changed, send them
  if (hasReadings && readings.size() > 0) {
    sendReadings(doc);
  }
}

uint32_t readHoldingRegister(uint16_t regAddr) {
  // Read 2 consecutive registers (32-bit value)
  uint16_t result[2] = {0, 0};
  if (modbus.readHreg(HMI_IP, regAddr, result, 2)) {
    // Combine registers: high word + low word
    return ((uint32_t)result[0] << 16) | result[1];
  }
  Serial.print("Failed to read register ");
  Serial.println(regAddr);
  return 0;
}

void sendReadings(JsonDocument& doc) {
  // Get current timestamp
  time_t now = time(nullptr);
  struct tm timeinfo = *localtime(&now);
  char timestamp[30];
  strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  
  // Add timestamp to first reading
  JsonArray readings = doc["readings"].as<JsonArray>();
  if (readings.size() > 0) {
    readings[0]["recorded_at"] = timestamp;
  }
  
  String payload;
  serializeJson(doc, payload);
  
  Serial.println("Sending: ");
  Serial.println(payload);
  
  WiFiClient client;
  if (client.connect(WiFi.gatewayIP(), 80)) {
    // Extract path from endpoint
    String path = "/api/public/ingest";
    
    client.print("POST ");
    client.print(path);
    client.println(" HTTP/1.1");
    client.print("Host: ");
    client.println(WiFi.gatewayIP());
    client.println("Content-Type: application/json");
    client.println("x-site-api-key: " + String(API_KEY));
    client.print("Content-Length: ");
    client.println(payload.length());
    client.println();
    client.println(payload);
    
    // Wait for response
    while (client.connected()) {
      if (client.available()) {
        String line = client.readStringUntil('\\n');
        Serial.println(line);
        if (line == "\\r") break;  // End of headers
      }
    }
    client.stop();
    Serial.println("Request sent");
  } else {
    Serial.println("Failed to connect to API endpoint");
  }
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
  const [subscriptions, setSubscriptions] = useState<Array<{ id: string; email: string; site_id: string; site_name?: string }>>([]);
  const [newEmail, setNewEmail] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState<string>(sites[0]?.id || "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSubscriptions();
  }, []);

  const loadSubscriptions = async () => {
    try {
      const { data } = await supabase.from("email_subscriptions").select("*");
      const subs = (data || []).map((s: any) => ({
        ...s,
        site_name: sites.find((site) => site.id === s.site_id)?.name,
      }));
      setSubscriptions(subs);
    } catch (e) {
      console.error("Failed to load subscriptions:", e);
    }
  };

  const addSubscription = async () => {
    if (!newEmail || !selectedSiteId) {
      toast.error("Please select a site and enter an email");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from("email_subscriptions").insert([
        { email: newEmail, site_id: selectedSiteId, period: "daily" },
      ]);

      if (error) throw error;
      toast.success(`Email subscription added for ${newEmail}`);
      setNewEmail("");
      loadSubscriptions();
    } catch (e: any) {
      toast.error(e.message || "Failed to add subscription");
    } finally {
      setLoading(false);
    }
  };

  const removeSubscription = async (id: string) => {
    try {
      const { error } = await supabase.from("email_subscriptions").delete().eq("id", id);
      if (error) throw error;
      toast.success("Subscription removed");
      loadSubscriptions();
    } catch (e: any) {
      toast.error(e.message || "Failed to remove subscription");
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <Mail className="h-5 w-5 text-primary" />
        Email Report Subscriptions
      </h2>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div>
          <p className="text-sm text-muted-foreground mb-3">
            Add email addresses to receive automated reports for each site.
          </p>
          
          <div className="bg-muted/50 rounded-lg p-4 text-xs space-y-2 mb-4">
            <div className="font-semibold text-foreground">📧 Email Schedule:</div>
            <div className="space-y-1">
              <div>• <strong>Frequency:</strong> Sent every hour (top of each hour)</div>
              <div>• <strong>Data Period:</strong> Last 24 hours of readings</div>
              <div>• <strong>Includes:</strong> Wash counts, water usage, chemical status</div>
              <div>• <strong>Timezone:</strong> UTC (Coordinated Universal Time)</div>
            </div>
            <div className="mt-3 pt-3 border-t border-border text-foreground">
              <strong>Example:</strong> Email sent at 14:00 UTC contains data from 00:00-14:00 UTC
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label htmlFor="sub-site">Site</Label>
            <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
              <SelectTrigger id="sub-site">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2 space-y-2">
            <Label htmlFor="sub-email">Email Address</Label>
            <Input
              id="sub-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="team@example.com"
            />
          </div>

          <div className="flex items-end">
            <Button onClick={addSubscription} disabled={loading} className="w-full gap-2">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        {subscriptions.length > 0 && (
          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-medium">Active Subscriptions</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {subscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 border border-border/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{sub.email}</div>
                    <div className="text-xs text-muted-foreground">{sub.site_name}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeSubscription(sub.id)}
                    className="ml-2 h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {subscriptions.length === 0 && (
          <div className="py-6 text-center rounded-lg bg-muted/30 border border-dashed border-border">
            <p className="text-sm text-muted-foreground">No email subscriptions yet. Add one above to start receiving reports.</p>
          </div>
        )}
      </div>
    </section>
  );
}
