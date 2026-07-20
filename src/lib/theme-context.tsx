import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Applies the admin-configured primary/accent brand colors to the whole
// app by overriding the CSS custom properties every component already
// reads from (var(--primary), var(--accent), etc). Any admin can change
// this from the Admin > App Theme panel, and it applies for everyone.
function applyBrandColors(primary: string, accent: string) {
  const root = document.documentElement.style;
  root.setProperty("--primary", primary);
  root.setProperty("--primary-glow", primary);
  root.setProperty("--accent", accent);
  root.setProperty("--sidebar-primary", primary);
  root.setProperty("--sidebar-accent", accent);
  root.setProperty("--ring", primary);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  // Load theme from localStorage on mount
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

      if (data?.primary_color && data?.accent_color) {
        applyBrandColors(data.primary_color, data.accent_color);
      }

      const savedTheme = localStorage.getItem("app-theme") as Theme | null;
      const initialTheme = savedTheme || (data?.theme_mode as Theme | undefined) || "dark";

      setThemeState(initialTheme);
      applyTheme(initialTheme);
      setMounted(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const applyTheme = (newTheme: Theme) => {
    const html = document.documentElement;
    if (newTheme === "dark") {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
    localStorage.setItem("app-theme", newTheme);
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

export function applyBrandColorsGlobally(primary: string, accent: string) {
  applyBrandColors(primary, accent);
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
