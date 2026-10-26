import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

type Theme = "light" | "dark";

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void } | null>(null);

export const themeInitScript = `(function(){try{var t=localStorage.getItem('sv-theme')||'dark';document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const stored = (localStorage.getItem("sv-theme") as Theme | null) ?? "dark";
    setThemeState(stored);
    document.documentElement.classList.toggle("dark", stored === "dark");

    // Sincroniza com a preferência salva na conta do usuário
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: pref } = await supabase
        .from("user_preferences")
        .select("tema")
        .eq("user_id", data.user.id)
        .maybeSingle();
      const remote = pref?.tema as Theme | undefined;
      if (remote && remote !== stored) {
        localStorage.setItem("sv-theme", remote);
        setThemeState(remote);
        document.documentElement.classList.toggle("dark", remote === "dark");
      }
    });
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem("sv-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      void supabase.from("user_preferences").upsert({ user_id: data.user.id, tema: t });
    });
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de ThemeProvider");
  return ctx;
}
