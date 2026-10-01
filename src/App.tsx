import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { StatusBar } from "@/components/layout/StatusBar";
import { ValidationPanel } from "@/components/validation/ValidationPanel";
import { EmptyState } from "@/components/pages/EmptyState";
import { SectionPlaceholder } from "@/components/pages/SectionPlaceholder";
import { OutputsPage } from "@/pages/OutputsPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { InputPage } from "@/pages/InputPage";
import { KeyBindingsPage } from "@/pages/KeyBindingsPage";
import { LayoutPage } from "@/pages/LayoutPage";
import { WindowRulesPage } from "@/pages/WindowRulesPage";
import { LayerRulesPage } from "@/pages/LayerRulesPage";
import { AnimationsPage } from "@/pages/AnimationsPage";
import { WorkspacesPage } from "@/pages/WorkspacesPage";
import { StartupPage } from "@/pages/StartupPage";
import { GesturesDebugPage } from "@/pages/GesturesDebugPage";
import { RawKdlEditorPage } from "@/pages/RawKdlEditorPage";
import { AppSettingsPage } from "@/pages/AppSettingsPage";
import { BackupsProfilesPage } from "@/pages/BackupsProfilesPage";
import { useConfigStore } from "@/stores/configStore";
import { useUiStore } from "@/stores/uiStore";
import { useValidationStore } from "@/stores/validationStore";
import { cn } from "@/lib/utils";
import { describeAppError, toAppError } from "@/lib/ipc";

/**
 * Application shell.
 * No demo/sample config feature — empty state until a real config is loaded.
 * Validation feedback via toasts / status (success green, failure red).
 */
function App() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const meta = useConfigStore((s) => s.meta);
  const dirty = useConfigStore((s) => s.dirty);
  const loading = useConfigStore((s) => s.loading);
  const saving = useConfigStore((s) => s.saving);
  const error = useConfigStore((s) => s.error);
  const errorText = error ? describeAppError(error) : null;
  const load = useConfigStore((s) => s.load);
  const save = useConfigStore((s) => s.save);
  const validate = useConfigStore((s) => s.validate);

  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const activePage = useUiStore((s) => s.activePage);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setActivePage = useUiStore((s) => s.setActivePage);
  const addToast = useUiStore((s) => s.addToast);

  const validationErrors = useValidationStore((s) => s.errors);
  const validationWarnings = useValidationStore((s) => s.warnings);
  const isValidating = useValidationStore((s) => s.isValidating);
  const setErrors = useValidationStore((s) => s.setErrors);
  const setWarnings = useValidationStore((s) => s.setWarnings);
  const startValidation = useValidationStore((s) => s.startValidation);
  const finishValidation = useValidationStore((s) => s.finishValidation);
  const clearValidation = useValidationStore((s) => s.clear);
  const dismissIssue = useValidationStore((s) => s.dismissIssue);

  const busy = loading || saving;

  const handleOpen = useCallback(
    async (path: string) => {
      try {
        clearValidation();
        await load(path);
        addToast({
          title: t("toast.config_loaded"),
          description: path,
          variant: "success",
          duration: 3000,
        });
      } catch (err) {
        // The thrown value, not the store: this callback closes over the state
        // of the render it was created in, which is the state before the load.
        addToast({
          title: t("toast.config_load_failed"),
          description: describeAppError(toAppError(err)) || t("toast.try_again"),
          variant: "destructive",
          duration: 5000,
        });
      }
    },
    [load, clearValidation, addToast, t]
  );

  const _handleValidate = useCallback(async () => {
    if (!config) return;
    startValidation();
    try {
      const result = await validate();
      setErrors(result.errors);
      setWarnings(result.warnings);
      if (result.valid) {
        addToast({
          title: t("toast.validate_ok"),
          variant: "success",
          duration: 2500,
        });
      } else {
        addToast({
          title: t("toast.validate_failed"),
          description: t("validation.errors_count", { count: result.errors.length }),
          variant: "destructive",
          duration: 5000,
        });
      }
    } catch (err) {
      addToast({
        title: t("toast.validate_failed"),
        description: describeAppError(toAppError(err)),
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      finishValidation();
    }
  }, [config, validate, startValidation, finishValidation, setErrors, setWarnings, addToast, t]);

  const handleValidate = useCallback(async () => {
    await _handleValidate();
  }, [_handleValidate]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    try {
      // Validate before save when backend supports it; surface result via toasts.
      startValidation();
      const result = await validate();
      setErrors(result.errors);
      setWarnings(result.warnings);
      finishValidation();

      if (!result.valid) {
        addToast({
          title: t("toast.save_blocked"),
          description: t("validation.errors_count", { count: result.errors.length }),
          variant: "destructive",
          duration: 5000,
        });
        return;
      }

      const saveResult = await save({ "create-backup": true });
      if (saveResult.success) {
        addToast({
          title: t("toast.save_ok"),
          description: saveResult["backup-id"]
            ? t("toast.backup_created", { id: saveResult["backup-id"] })
            : undefined,
          variant: "success",
          duration: 3000,
        });
      } else {
        addToast({
          title: t("toast.save_failed"),
          variant: "destructive",
          duration: 5000,
        });
      }
    } catch (err) {
      finishValidation();
      addToast({
        title: t("toast.save_failed"),
        description: describeAppError(toAppError(err)),
        variant: "destructive",
        duration: 5000,
      });
    }
  }, [config, validate, save, startValidation, finishValidation, setErrors, setWarnings, addToast, t]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <Sidebar
          isOpen={sidebarOpen}
          activePage={activePage}
          onPageChange={setActivePage}
          onToggle={toggleSidebar}
        />
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col transition-[margin] duration-200",
            sidebarOpen ? "ml-64" : "ml-16"
          )}
        >
          <Header
            configPath={meta?.["main-path"] ?? null}
            isDirty={dirty}
            isLoading={busy}
            onSave={handleSave}
            onValidate={handleValidate}
          />
          <main className="min-h-0 flex-1 overflow-auto">
            {!config ? (
              <EmptyState
                loading={loading}
                errorMessage={errorText}
                onOpen={handleOpen}
              />
            ) : activePage === "overview" ? (
              <OverviewPage />
            ) : activePage === "outputs" ? (
              <OutputsPage />
            ) : activePage === "input" ? (
              <InputPage />
            ) : activePage === "key-bindings" ? (
              <KeyBindingsPage />
            ) : activePage === "layout" ? (
              <LayoutPage />
            ) : activePage === "window-rules" ? (
              <WindowRulesPage />
            ) : activePage === "layer-rules" ? (
              <LayerRulesPage />
            ) : activePage === "animations" ? (
              <AnimationsPage />
            ) : activePage === "gestures" ? (
              <GesturesDebugPage />
            ) : activePage === "workspaces" ? (
              <WorkspacesPage />
            ) : activePage === "startup" ? (
              <StartupPage />
            ) : activePage === "app-settings" ? (
              <AppSettingsPage />
            ) : activePage === "backups-profiles" ? (
              <BackupsProfilesPage />
            ) : activePage === "raw-kdl" ? (
              <RawKdlEditorPage />
            ) : (
              <SectionPlaceholder pageId={activePage} />
            )}
          </main>
          {config ? (
            <ValidationPanel
              errors={validationErrors}
              warnings={validationWarnings}
              isValidating={isValidating}
              onDismiss={dismissIssue}
              onClear={clearValidation}
            />
          ) : null}
          <StatusBar />
        </div>
      </div>
    </div>
  );
}

export default App;
