import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Policy that belongs to NiriForge, not to niri.
 *
 * The socket path, the binary name and the save safeguards are decisions this app
 * makes about how it talks to the compositor and how it touches the file on
 * disk. niri has no node for any of them, so they live here rather than in the
 * config: writing them into config.kdl would produce a file the compositor
 * rejects.
 */
export interface AppPolicy {
  /** Override for the niri binary the backend spawns. Empty means its default. */
  niriBinary: string;
  /** Override for the event socket path. Empty means whatever niri reports. */
  socketPath: string;
  /** Refuse to write a config that does not validate. */
  validateBeforeSave: boolean;
  /** Take a backup before replacing files. */
  backupBeforeSave: boolean;
}

interface AppPolicyState extends AppPolicy {
  setNiriBinary: (value: string) => void;
  setSocketPath: (value: string) => void;
  setValidateBeforeSave: (value: boolean) => void;
  setBackupBeforeSave: (value: boolean) => void;
  reset: () => void;
}

const DEFAULTS: AppPolicy = {
  niriBinary: "",
  socketPath: "",
  validateBeforeSave: true,
  backupBeforeSave: true,
};

export const useAppPolicyStore = create<AppPolicyState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setNiriBinary: (niriBinary) => set({ niriBinary }),
      setSocketPath: (socketPath) => set({ socketPath }),
      setValidateBeforeSave: (validateBeforeSave) => set({ validateBeforeSave }),
      setBackupBeforeSave: (backupBeforeSave) => set({ backupBeforeSave }),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: "niriforge-app-policy",
      storage: createJSONStorage(() => localStorage),
    }
  )
);