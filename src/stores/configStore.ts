import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { invokeCommand, toAppError } from "@/lib/ipc";
import type {
  AppError,
  Config,
  ConfigDto,
  ConfigMeta,
  SaveOptions,
  SaveResult,
  ValidationResult,
} from "@/types/config";

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
        const result = await invokeCommand<ConfigDto>("load_config", { path });
        set({
          config: result.config,
          original: structuredClone<Config>(result.config),
          meta: result.meta,
          dirty: false,
          loading: false,
        });
      } catch (err) {
        set({ error: toAppError(err), loading: false });
        throw err;
      }
    },

    save: async (opts?: SaveOptions) => {
      set({ saving: true, error: null });
      try {
        const { config, meta } = get();
        if (!config || !meta) throw new Error("No config is loaded");
        const result = await invokeCommand<SaveResult>("save_config", {
          config: { config, meta },
          options: opts ?? {},
        });
        if (result.success) {
          set({
            original: structuredClone<Config>(config),
            dirty: false,
            saving: false,
          });
        }
        return result;
      } catch (err) {
        set({ error: toAppError(err), saving: false });
        throw err;
      }
    },

    validate: async () => {
      const { config, meta } = get();
      if (!config || !meta) throw new Error("No config is loaded");
      return invokeCommand<ValidationResult>("validate_config", {
        config: { config, meta },
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
      // Read outside the recipe: a value taken out of an immer draft is a
      // proxy, and a proxy cannot be cloned.
      const { original } = get();
      if (!original) return;
      set({ config: structuredClone<Config>(original), dirty: false });
    },

    markDirty: () => set({ dirty: true }),
    markClean: () => set({ dirty: false }),
    setError: (error) => set({ error }),
    setLoading: (loading) => set({ loading }),
    setSaving: (saving) => set({ saving }),
  }))
);
