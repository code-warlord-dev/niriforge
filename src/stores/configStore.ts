import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Config, ConfigMeta, SaveOptions, SaveResult, ValidationResult, AppError } from "@/types/config";

interface ConfigState {
  config: Config | null;
  original: Config | null;
  meta: ConfigMeta | null;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: AppError | null;

  load: (path?: string) => Promise<void>;
  save: (opts?: SaveOptions) => Promise<SaveResult>;
  validate: () => Promise<ValidationResult>;
  setSection: <K extends keyof Config>(key: K, value: Config[K]) => void;
  update: (fn: (draft: Config) => void) => void;
  resetToOriginal: () => void;
  markDirty: () => void;
  markClean: () => void;
  setError: (error: AppError | null) => void;
  setLoading: (loading: boolean) => void;
  setSaving: (saving: boolean) => void;
}

export const useConfigStore = create<ConfigState>()(
  immer((set, get) => ({
    config: null,
    original: null,
    meta: null,
    dirty: false,
    loading: false,
    saving: false,
    error: null,

    load: async (path?: string) => {
      set({ loading: true, error: null });
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<{ config: Config; meta: ConfigMeta }>("load_config", { path });
        set({
          config: result.config,
          original: JSON.parse(JSON.stringify(result.config)),
          meta: result.meta,
          dirty: false,
          loading: false,
        });
      } catch (err) {
        set({ error: err as AppError, loading: false });
        throw err;
      }
    },

    save: async (opts?: SaveOptions) => {
      set({ saving: true, error: null });
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const config = get().config;
        if (!config) throw new Error("No config to save");
        const result = await invoke<SaveResult>("save_config", { config, options: opts });
        if (result.success) {
          set({
            original: JSON.parse(JSON.stringify(config)),
            dirty: false,
            saving: false,
          });
        }
        return result;
      } catch (err) {
        set({ error: err as AppError, saving: false });
        throw err;
      }
    },

    validate: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const config = get().config;
      if (!config) throw new Error("No config to validate");
      return invoke<ValidationResult>("validate_config", { config });
    },

    setSection: <K extends keyof Config>(key: K, value: Config[K]) => {
      set((state) => {
        if (state.config) {
          (state.config as Record<K, Config[K]>)[key] = value;
          state.dirty = true;
        }
      });
    },

    update: (fn: (draft: Config) => void) => {
      set((state) => {
        if (state.config) {
          fn(state.config);
          state.dirty = true;
        }
      });
    },

    resetToOriginal: () => {
      set((state) => {
        if (state.original) {
          state.config = JSON.parse(JSON.stringify(state.original));
          state.dirty = false;
        }
      });
    },

    markDirty: () => set({ dirty: true }),
    markClean: () => set({ dirty: false }),
    setError: (error: AppError | null) => set({ error }),
    setLoading: (loading: boolean) => set({ loading }),
    setSaving: (saving: boolean) => set({ saving }),
  }))
);