import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { toIssues, type ValidationError, type ValidationIssue } from "@/types/config";

interface ValidationState {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  isValidating: boolean;

  setErrors: (errors: ValidationError[]) => void;
  setWarnings: (warnings: ValidationError[]) => void;
  addError: (error: ValidationError) => void;
  addWarning: (warning: ValidationError) => void;
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

    // The backend sends `ValidationError`s; the identity a row needs is ours to
    // make, so it is made once here rather than guessed at in the panel.
    setErrors: (errors) => set({ errors: toIssues(errors) }),
    setWarnings: (warnings) => set({ warnings: toIssues(warnings) }),
    addError: (error) =>
      set((current) => {
        current.errors.push(...toIssues([error]));
      }),
    addWarning: (warning) =>
      set((current) => {
        current.warnings.push(...toIssues([warning]));
      }),
    clear: () => set({ errors: [], warnings: [] }),
    startValidation: () => set({ isValidating: true }),
    finishValidation: () => set({ isValidating: false }),
    dismissIssue: (id) =>
      set((current) => {
        current.errors = current.errors.filter((issue) => issue.id !== id);
        current.warnings = current.warnings.filter((issue) => issue.id !== id);
      }),
  }))
);
