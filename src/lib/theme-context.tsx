import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// ---- color helpers -------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hueOf(hex: string): number {
  try {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHsl(r, g, b).h;
  } catch {
    return 200; // fallback to original teal-ish hue
  }
}

// Picks readable black/white text for a given background hex color
function contrastForeground(hex: string): string {
  try {
    const { r, g, b } = hexToRgb(hex);
    // relative luminance (simplified)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? "hsl(0 0% 9%)" : "hsl(0 0% 98%)";
  } catch {
    return "hsl(0 0% 98%)";
  }
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(1)} ${s}% ${l}%)`;
}

/**
 * Builds a full set of CSS variable values (background, card, border,
 * text, etc — not just primary/accent) so that picking brand colors in
 * Admin genuinely reskins the whole app, not just buttons. The overall
 * hue comes from the chosen PRIMARY color; ACCENT is applied as its own
 * distinct highlight color. Structural lightness levels differ between
 * light and dark mode so the mode toggle is a real visual difference.
 */
function generatePalette(mode: Theme, primaryHex: string, accentHex: string): Record<string, string> {
  const hue = hueOf(primaryHex);
  const primaryForeground = contrastForeground(primaryHex);
  const accentForeground = contrastForeground(accentHex);

  const shared: Record<string, string> = {
    primary: primaryHex,
    "primary-foreground": primaryForeground,
    "primary-glow": primaryHex,
    accent: accentHex,
    "accent-foreground": accentForeground,
    ring: primaryHex,
    "chart-1": primaryHex,
    "chart-2": accentHex,
    "sidebar-primary": primaryHex,
    "sidebar-primary-foreground": primaryForeground,
    "sidebar-ring": primaryHex,
  };

  if (mode === "dark") {
    return {
      ...shared,
      background: hsl(hue, 22, 10),
      foreground: hsl(hue, 15, 95),
      card: hsl(hue, 20, 14),
      "card-foreground": hsl(hue, 15, 95),
      popover: hsl(hue, 20, 14),
      "popover-foreground": hsl(hue, 15, 95),
      secondary: hsl(hue, 18, 19),
      "secondary-foreground": hsl(hue, 15, 95),
      muted: hsl(hue, 15, 17),
      "muted-foreground": hsl(hue, 10, 65),
      border: hsl(hue, 18, 24),
      input: hsl(hue, 18, 24),
      sidebar: hsl(hue, 20, 12),
      "sidebar-foreground": hsl(hue, 15, 95),
      "sidebar-accent": hsl(hue, 18, 19),
      "sidebar-accent-foreground": hsl(hue, 15, 95),
      "sidebar-border": hsl(hue, 18, 24),
    };
  }

  return {
    ...shared,
    background: hsl(hue, 45, 97),
    foreground: hsl(hue, 25, 12),
    card: hsl(hue, 30, 99),
    "card-foreground": hsl(hue, 25, 12),
    popover: hsl(hue, 30, 99),
    "popover-foreground": hsl(hue, 25, 12),
    secondary: hsl(hue, 25, 93),
    "secondary-foreground": hsl(hue, 25, 12),
    muted: hsl(hue, 20, 94),
    "muted-foreground": hsl(hue, 10, 40),
    border: hsl(hue, 20, 85),
    input: hsl(hue, 20, 85),
    sidebar: hsl(hue, 25, 96),
    "sidebar-foreground": hsl(hue, 25, 12),
    "sidebar-accent": hsl(hue, 25, 93),
    "sidebar-accent-foreground": hsl(hue, 25, 12),
    "sidebar-border": hsl(hue, 20, 85),
  };
}

// Applies the full generated palette to :root as inline style overrides,
// which take priority over the .dark/:root rules in styles.css. Every
// component already reads these same CSS variables, so nothing else
// needs to change for the reskin to take effect everywhere.
function applyFullTheme(mode: Theme, primaryHex: string, accentHex: string) {
  const palette = generatePalette(mode, primaryHex, accentHex);
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(palette)) {
    root.setProperty(`--${key}`, value);
  }
}

// ---------------------------------------------------------------------

const DEFAULT_PRIMARY = "#5ad1e0";
const DEFAULT_ACCENT = "#2c8f9e";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);
  const brandRef = useRef({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Fetch the admin-configured global default (mode + brand colors).
      // A user's own saved preference (localStorage) always wins for
      // light/dark mode; colors are global for everyone.
      const { data } = await supabase
        .from("app_settings")
        .select("theme_mode, primary_color, accent_color")
        .eq("id", true)
        .maybeSingle();

      if (cancelled) return;

      const primary = data?.primary_color || DEFAULT_PRIMARY;
      const accent = data?.accent_color || DEFAULT_ACCENT;
      brandRef.current = { primary, accent };

      const savedTheme = localStorage.getItem("app-theme") as Theme | null;
      const initialTheme = savedTheme || (data?.theme_mode as Theme | undefined) || "dark";

      setThemeState(initialTheme);
      applyTheme(initialTheme, primary, accent);
      setMounted(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const applyTheme = (newTheme: Theme, primary?: string, accent?: string) => {
    const html = document.documentElement;
    if (newTheme === "dark") {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
    localStorage.setItem("app-theme", newTheme);
    applyFullTheme(newTheme, primary ?? brandRef.current.primary, accent ?? brandRef.current.accent);
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    applyTheme(newTheme);
  };

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Used by the Admin > App Theme panel for live preview and after saving.
// Applies against whichever mode is currently active on screen.
export function applyBrandColorsGlobally(primary: string, accent: string) {
  const currentMode: Theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
  applyFullTheme(currentMode, primary, accent);
}

// Same as above, but lets the caller specify the mode explicitly — used
// by the Admin panel so its preview matches the "Default mode" dropdown
// the admin is actively choosing, not just their own current view.
export function previewTheme(mode: Theme, primary: string, accent: string) {
  applyFullTheme(mode, primary, accent);
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
