import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist, createJSONStorage } from "zustand/middleware";

type Theme = "system" | "dark" | "light";
type Locale = "ru" | "en";

interface DialogState {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

interface ToastState {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive" | "success" | "warning";
  duration?: number;
}

interface UiState {
  sidebarOpen: boolean;
  activePage: string;
  theme: Theme;
  locale: Locale;
  toasts: ToastState[];
  dialogs: DialogState[];

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setActivePage: (page: string) => void;
  setTheme: (theme: Theme) => void;
  setLocale: (locale: Locale) => void;
  addToast: (toast: Omit<ToastState, "id">) => string;
  removeToast: (id: string) => void;
  openDialog: (type: string, props: Record<string, unknown>) => string;
  closeDialog: (id: string) => void;
}

export const useUiStore = create<UiState>()(
  immer(
    persist(
      (set) => ({
        sidebarOpen: true,
        activePage: "outputs",
        theme: "dark",
        locale: "en",
        toasts: [],
        dialogs: [],

        setSidebarOpen: (open) => set({ sidebarOpen: open }),
        toggleSidebar: () => set((state) => { state.sidebarOpen = !state.sidebarOpen; }),
        setActivePage: (page) => set({ activePage: page }),
        setTheme: (theme) => set({ theme }),
        setLocale: (locale) => set({ locale }),

        addToast: (toast) => {
          const id = Math.random().toString(36).slice(2, 9);
          set((state) => { state.toasts.push({ ...toast, id }); });
          return id;
        },

        removeToast: (id) => set((state) => { state.toasts = state.toasts.filter((t: ToastState) => t.id !== id); }),

        openDialog: (type, props) => {
          const id = Math.random().toString(36).slice(2, 9);
          set((state) => { state.dialogs.push({ id, type, props }); });
          return id;
        },

        closeDialog: (id) => set((state) => { state.dialogs = state.dialogs.filter((d: DialogState) => d.id !== id); }),
      }),
      {
        name: "niriforge-ui",
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({ theme: state.theme, locale: state.locale, sidebarOpen: state.sidebarOpen }),
      }
    )
  )
);