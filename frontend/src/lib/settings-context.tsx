import { createContext, useContext, useState, type ReactNode } from "react";
import { defaultSettings, paletteToCss, type AppSettings } from "./settings.functions";

const SettingsContext = createContext<{
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
} | null>(null);

export function SettingsProvider({
  initial,
  children,
}: {
  initial: AppSettings;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<AppSettings>(initial ?? defaultSettings);
  return (
    <SettingsContext.Provider value={{ settings, setSettings }}>
      <style dangerouslySetInnerHTML={{ __html: paletteToCss(settings) }} />
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) return { settings: defaultSettings, setSettings: () => {} };
  return ctx;
}
