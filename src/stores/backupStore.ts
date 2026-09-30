import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { invokeCommand, toAppError } from "@/lib/ipc";
import type { AppError, BackupMeta } from "@/types/config";

export type { BackupMeta };

interface BackupState {
  backups: BackupMeta[];
  loading: boolean;
  error: AppError | null;

  fetchBackups: () => Promise<void>;
  restore: (id: string) => Promise<void>;
  create: (name?: string, comment?: string) => Promise<BackupMeta>;
  delete: (id: string) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: AppError | null) => void;
}

export const useBackupStore = create<BackupState>()(
  immer((set) => ({
    backups: [],
    loading: false,
    error: null,

    fetchBackups: async () => {
      set({ loading: true, error: null });
      try {
        const backups = await invokeCommand<BackupMeta[]>("list_backups");
        set({ backups, loading: false });
      } catch (err) {
        set({ error: toAppError(err), loading: false });
      }
    },

    restore: async (id: string) => {
      set({ loading: true, error: null });
      try {
        await invokeCommand<null>("restore_backup", { id });
        set({ loading: false });
      } catch (err) {
        set({ error: toAppError(err), loading: false });
        throw err;
      }
    },

    create: async (name?: string, comment?: string) => {
      set({ loading: true, error: null });
      try {
        const backup = await invokeCommand<BackupMeta>("create_backup", { name, comment });
        set((state) => {
          state.backups.unshift(backup);
          state.loading = false;
        });
        return backup;
      } catch (err) {
        set({ error: toAppError(err), loading: false });
        throw err;
      }
    },

    delete: async (id: string) => {
      set({ loading: true, error: null });
      try {
        await invokeCommand<null>("delete_backup", { id });
        set((state) => {
          state.backups = state.backups.filter((backup) => backup.id !== id);
          state.loading = false;
        });
      } catch (err) {
        set({ error: toAppError(err), loading: false });
        throw err;
      }
    },

    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error }),
  }))
);
