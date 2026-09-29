import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export interface ValidationIssue {
  id: string;
  type: "error" | "warning";
  message: string;
  location?: {
    file: string;
    line: number;
    column: number;
  };
  code?: string;
  section?: string;
}

interface ValidationState {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  isValidating: boolean;

  setErrors: (errors: ValidationIssue[]) => void;
  setWarnings: (warnings: ValidationIssue[]) => void;
  addError: (error: ValidationIssue) => void;
  addWarning: (warning: ValidationIssue) => void;
  clear: () => void;
  startValidation: () => void;
  finishValidation: () => void;
  dismissIssue: (id: string) => void;
}

export const useValidationStore = create<ValidationState>()(
  immer((set) => ({
    errors: [],
    warnings: [],
    isValidating: false,

    setErrors: (errors) => set({ errors }),
    setWarnings: (warnings) => set({ warnings }),
    addError: (error) => set((state) => { state.errors.push(error); }),
    addWarning: (warning) => set((state) => { state.warnings.push(warning); }),
    clear: () => set({ errors: [], warnings: [] }),
    startValidation: () => set({ isValidating: true }),
    finishValidation: () => set({ isValidating: false }),
    dismissIssue: (id) =>
      set((state) => {
        state.errors = state.errors.filter((issue: ValidationIssue) => issue.id !== id);
        state.warnings = state.warnings.filter((issue: ValidationIssue) => issue.id !== id);
      }),
  }))
);