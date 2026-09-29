import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist, createJSONStorage } from "zustand/middleware";

type Theme = "system" | "dark" | "light";
type Locale = "ru" | "en";

interface AppSettings {
  theme: Theme;
  locale: Locale;
}

interface SettingsState extends AppSettings {
  setTheme: (theme: Theme) => void;
  setLocale: (locale: Locale) => void;
  hydrate: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  immer(
    persist(
      (set) => ({
        theme: "system",
        locale: "en",

        setTheme: (theme) => set({ theme }),
        setLocale: (locale) => set({ locale }),
        hydrate: () => {},
      }),
      {
        name: "niriforge-settings",
        storage: createJSONStorage(() => localStorage),
      }
    )
  )
);