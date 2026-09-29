import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export interface BackupMeta {
  id: string;
  name: string;
  type: "auto" | "named";
  timestamp: number;
  niriVersion?: string;
  sourceFiles: string[];
  comment?: string;
  size: number;
}

export interface BackupState {
  backups: BackupMeta[];
  loading: boolean;
  error: Error | null;

  fetchBackups: () => Promise<void>;
  restore: (id: string) => Promise<void>;
  create: (name?: string, comment?: string) => Promise<BackupMeta>;
  delete: (id: string) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: Error | null) => void;
}

export const useBackupStore = create<BackupState>()(
  immer((set) => ({
    backups: [],
    loading: false,
    error: null,

    fetchBackups: async () => {
      set({ loading: true, error: null });
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const backups = await invoke<BackupMeta[]>("list_backups");
        set({ backups, loading: false });
      } catch (err) {
        set({ error: err as Error, loading: false });
      }
    },

    restore: async (id: string) => {
      set({ loading: true, error: null });
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("restore_backup", { id });
        set({ loading: false });
      } catch (err) {
        set({ error: err as Error, loading: false });
        throw err;
      }
    },

    create: async (name?: string, comment?: string) => {
      set({ loading: true, error: null });
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const backup = await invoke<BackupMeta>("create_backup", { name, comment });
        set((state) => { state.backups.unshift(backup); state.loading = false; });
        return backup;
      } catch (err) {
        set({ error: err as Error, loading: false });
        throw err;
      }
    },

    delete: async (id: string) => {
      set({ loading: true, error: null });
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("delete_backup", { id });
        set((state) => { state.backups = state.backups.filter((b: BackupMeta) => b.id !== id); state.loading = false; });
      } catch (err) {
        set({ error: err as Error, loading: false });
        throw err;
      }
    },

    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error }),
  }))
);