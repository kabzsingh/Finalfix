import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Activity, Droplets, FlaskConical, Gauge, Shield } from "lucide-react";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && session) nav({ to: "/dashboard" });
  }, [loading, session, nav]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-primary shadow-glow grid place-items-center">
              <Activity className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight">WashGrid</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login"><Button variant="ghost" size="sm">Sign in</Button></Link>
            <Link to="/signup"><Button size="sm">Get started</Button></Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6">
        <section className="py-20 md:py-28 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> Live telemetry from your ESP32 fleet
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight max-w-3xl mx-auto">
            Every wash, every drop, every chemical — <span className="bg-gradient-primary bg-clip-text text-transparent">in real time.</span>
          </h1>
          <p className="mt-5 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
            WashGrid streams wash counts, fresh water, and chemical levels from every site straight to one live dashboard. Built for fleets of 20+ wash sites running ESP32 meters.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/signup"><Button size="lg" className="shadow-glow">Start free</Button></Link>
            <Link to="/login"><Button size="lg" variant="outline">I already have an account</Button></Link>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-20">
          {[
            { icon: Gauge, title: "Wash counts", text: "Today and lifetime totals from every wash bay." },
            { icon: Droplets, title: "Fresh water", text: "Track usage per meter, spot leaks fast." },
            { icon: FlaskConical, title: "Chemical levels", text: "Tank gauges with low-level alerts." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-6 shadow-card">
              <div className="h-10 w-10 rounded-lg bg-accent grid place-items-center mb-3">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{text}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border bg-gradient-surface p-8 md:p-12 mb-20 shadow-card">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-accent grid place-items-center shrink-0">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Secure ingest for your ESP32s</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                Each site gets its own API key. Your ESP32 posts JSON readings to a single endpoint — we handle storage, time series, and access control automatically.
              </p>
              <pre className="mt-4 text-xs bg-background/60 rounded-lg p-4 overflow-x-auto border border-border">
{`POST /api/public/ingest
x-site-api-key: ws_live_********
{
  "readings": [
    { "device_key": "wash",  "value": 1 },
    { "device_key": "fresh", "value": 12.4 },
    { "device_key": "chem1", "value": 78.2 }
  ]
}`}
              </pre>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} WashGrid
      </footer>
    </div>
  );
}
