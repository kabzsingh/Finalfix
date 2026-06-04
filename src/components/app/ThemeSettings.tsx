import { useEffect, useState } from "react";
import { Palette } from "lucide-react";

const THEMES = [
  {
    id: "dark-teal",
    name: "Dark Teal",
    description: "Default industrial look",
    primary: "oklch(0.78 0.16 200)",
    background: "oklch(0.18 0.025 220)",
    card: "oklch(0.22 0.028 222)",
    preview: "#2dd4bf",
  },
  {
    id: "dark-blue",
    name: "Dark Blue",
    description: "Deep navy with blue accent",
    primary: "oklch(0.72 0.18 250)",
    background: "oklch(0.16 0.03 240)",
    card: "oklch(0.20 0.035 242)",
    preview: "#3b82f6",
  },
  {
    id: "dark-purple",
    name: "Dark Purple",
    description: "Dark with violet accent",
    primary: "oklch(0.72 0.2 300)",
    background: "oklch(0.16 0.03 280)",
    card: "oklch(0.20 0.035 282)",
    preview: "#a855f7",
  },
  {
    id: "dark-green",
    name: "Dark Green",
    description: "Dark with emerald accent",
    primary: "oklch(0.74 0.18 155)",
    background: "oklch(0.16 0.025 160)",
    card: "oklch(0.20 0.03 162)",
    preview: "#10b981",
  },
  {
    id: "dark-orange",
    name: "Dark Orange",
    description: "Dark with amber accent",
    primary: "oklch(0.78 0.18 55)",
    background: "oklch(0.16 0.025 40)",
    card: "oklch(0.20 0.03 42)",
    preview: "#f59e0b",
  },
  {
    id: "light",
    name: "Light",
    description: "Clean light theme",
    primary: "oklch(0.55 0.18 200)",
    background: "oklch(0.97 0.005 220)",
    card: "oklch(1 0 0)",
    preview: "#0891b2",
  },
];

function applyTheme(theme: typeof THEMES[0]) {
  const root = document.documentElement;
  const isLight = theme.id === "light";

  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--ring", theme.primary);
  root.style.setProperty("--chart-1", theme.primary);
  root.style.setProperty("--sidebar-primary", theme.primary);
  root.style.setProperty("--sidebar-ring", theme.primary);
  root.style.setProperty("--background", theme.background);
  root.style.setProperty("--card", theme.card);
  root.style.setProperty("--popover", theme.card);
  root.style.setProperty("--sidebar", theme.background);

  if (isLight) {
    root.style.setProperty("--foreground", "oklch(0.15 0.02 220)");
    root.style.setProperty("--card-foreground", "oklch(0.15 0.02 220)");
    root.style.setProperty("--popover-foreground", "oklch(0.15 0.02 220)");
    root.style.setProperty("--sidebar-foreground", "oklch(0.15 0.02 220)");
    root.style.setProperty("--muted", "oklch(0.93 0.005 220)");
    root.style.setProperty("--muted-foreground", "oklch(0.45 0.02 220)");
    root.style.setProperty("--secondary", "oklch(0.92 0.008 220)");
    root.style.setProperty("--secondary-foreground", "oklch(0.15 0.02 220)");
    root.style.setProperty("--accent", "oklch(0.90 0.015 200)");
    root.style.setProperty("--border", "oklch(0.85 0.01 220)");
    root.style.setProperty("--input", "oklch(0.85 0.01 220)");
    root.style.setProperty("--primary-foreground", "oklch(0.97 0.005 220)");
    root.style.setProperty("--sidebar-border", "oklch(0.85 0.01 220)");
    root.style.setProperty("--sidebar-accent", "oklch(0.92 0.008 220)");
    root.style.setProperty("--sidebar-accent-foreground", "oklch(0.15 0.02 220)");
    root.style.setProperty("--sidebar-primary-foreground", "oklch(0.97 0.005 220)");
  } else {
    root.style.setProperty("--foreground", "oklch(0.96 0.01 220)");
    root.style.setProperty("--card-foreground", "oklch(0.96 0.01 220)");
    root.style.setProperty("--popover-foreground", "oklch(0.96 0.01 220)");
    root.style.setProperty("--sidebar-foreground", "oklch(0.96 0.01 220)");
    root.style.setProperty("--muted", "oklch(0.26 0.025 222)");
    root.style.setProperty("--muted-foreground", "oklch(0.7 0.02 220)");
    root.style.setProperty("--secondary", "oklch(0.28 0.03 222)");
    root.style.setProperty("--secondary-foreground", "oklch(0.96 0.01 220)");
    root.style.setProperty("--accent", "oklch(0.32 0.06 200)");
    root.style.setProperty("--border", "oklch(0.3 0.02 222)");
    root.style.setProperty("--input", "oklch(0.3 0.02 222)");
    root.style.setProperty("--primary-foreground", "oklch(0.18 0.025 220)");
    root.style.setProperty("--sidebar-border", "oklch(0.3 0.02 222)");
    root.style.setProperty("--sidebar-accent", "oklch(0.28 0.03 222)");
    root.style.setProperty("--sidebar-accent-foreground", "oklch(0.96 0.01 220)");
    root.style.setProperty("--sidebar-primary-foreground", "oklch(0.18 0.025 220)");
  }

  localStorage.setItem("washgrid-theme", theme.id);
}

export function initTheme() {
  const saved = localStorage.getItem("washgrid-theme");
  if (saved) {
    const theme = THEMES.find((t) => t.id === saved);
    if (theme) applyTheme(theme);
  }
}

export function ThemeSettingsPanel() {
  const [active, setActive] = useState(() => localStorage.getItem("washgrid-theme") ?? "dark-teal");

  useEffect(() => {
    initTheme();
  }, []);

  const select = (theme: typeof THEMES[0]) => {
    setActive(theme.id);
    applyTheme(theme);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm border-l-4 border-l-primary/50">
      <div className="flex items-center gap-2 mb-6">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Palette className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-semibold text-lg">Theme & Appearance</h2>
          <p className="text-xs text-muted-foreground">Choose a colour scheme for your dashboard.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            onClick={() => select(theme)}
            className={`rounded-lg border-2 p-3 text-left transition-all ${
              active === theme.id
                ? "border-primary bg-primary/10"
                : "border-border bg-muted/20 hover:border-primary/40"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div
                className="h-5 w-5 rounded-full border border-border/50 shadow-sm"
                style={{ backgroundColor: theme.preview }}
              />
              <span className="text-xs font-semibold truncate">{theme.name}</span>
              {active === theme.id && (
                <span className="ml-auto text-[9px] font-bold uppercase text-primary">Active</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">{theme.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
