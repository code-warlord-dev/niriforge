import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { invokeCommand, toAppError } from "@/lib/ipc";
import { logger } from "@/lib/logger";
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
      logger.debug("configStore", "loading config", { path });
      set({ loading: true, error: null });
      try {
        const result = await invokeCommand<ConfigDto>("load_config", { path });
        logger.info("configStore", "config loaded", {
          outputsCount: result.config.outputs.length,
          hasMeta: !!result.meta,
        });
        set({
          config: result.config,
          original: structuredClone<Config>(result.config),
          meta: result.meta,
          dirty: false,
          loading: false,
        });
      } catch (err) {
        logger.error("configStore", "failed to load config", err);
        set({ error: toAppError(err), loading: false });
        throw err;
      }
    },

    save: async (opts?: SaveOptions) => {
      logger.debug("configStore", "saving config", { options: opts });
      set({ saving: true, error: null });
      try {
        const { config, meta } = get();
        if (!config || !meta) throw new Error("No config is loaded");
        const result = await invokeCommand<SaveResult>("save_config", {
          config: { config, meta },
          options: opts ?? {},
        });
        if (result.success) {
          logger.info("configStore", "config saved successfully");
          set({
            original: structuredClone<Config>(config),
            dirty: false,
            saving: false,
          });
        } else {
          logger.warn("configStore", "save returned failure", result);
        }
        return result;
      } catch (err) {
        logger.error("configStore", "failed to save config", err);
        set({ error: toAppError(err), saving: false });
        throw err;
      }
    },

    validate: async () => {
      const { config, meta } = get();
      if (!config || !meta) throw new Error("No config is loaded");
      logger.debug("configStore", "validating config");
      const result = await invokeCommand<ValidationResult>("validate_config", {
        config: { config, meta },
      });
      logger.info("configStore", "validation complete", {
        valid: result.valid,
        errorsCount: result.errors.length,
        warningsCount: result.warnings.length,
      });
      return result;
    },

    update: (fn: (draft: Config) => void) => {
      logger.trace("configStore", "updating config");
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
