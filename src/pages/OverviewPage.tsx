"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/configStore";
import { useValidationStore } from "@/stores/validationStore";
import { useBackupStore } from "@/stores/backupStore";
import { invokeCommand } from "@/lib/ipc";
import { logger } from "@/lib/logger";

import { OverviewStatsCards } from "@/components/overview/OverviewStatsCards";
import { ConfigColumn } from "@/components/overview/ConfigColumn";
import { IPCColumn } from "@/components/overview/IPCColumn";
import { SchemaColumn } from "@/components/overview/SchemaColumn";
import { OperationsBar } from "@/components/overview/OperationsBar";
import { ValidationDiagnostics } from "@/components/overview/ValidationDiagnostics";
import { WorkspaceTimeline } from "@/components/overview/WorkspaceTimeline";
import { RecentSnapshots } from "@/components/overview/RecentSnapshots";

export function OverviewPage() {
  const { t } = useTranslation();

  const config = useConfigStore((s) => s.config);
  const meta = useConfigStore((s) => s.meta);
  const loading = useConfigStore((s) => s.loading);
  const load = useConfigStore((s) => s.load);

  const validationErrors = useValidationStore((s) => s.errors);
  const validationWarnings = useValidationStore((s) => s.warnings);
  const isValidating = useValidationStore((s) => s.isValidating);
  const clearValidation = useValidationStore((s) => s.clear);

  const fetchBackups = useBackupStore((s) => s.fetchBackups);

  const [niriRunning, setNiriRunning] = useState<boolean | null>(null);
  const [niriVersion, setNiriVersion] = useState<string | null>(null);
  const [socketPath, setSocketPath] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Log mount
  useEffect(() => {
    logger.info("OverviewPage", "mounted");
    return () => logger.info("OverviewPage", "unmounted");
  }, []);

  // Load config on mount if not already loaded
  useEffect(() => {
    if (!config && !loading && !initialLoadDone) {
      logger.info("OverviewPage", "no config loaded, attempting to load default");
      load().catch((err) => {
        logger.debug("OverviewPage", "initial load failed (expected if no config)", err);
      });
    }
    setInitialLoadDone(true);
  }, [config, loading, load, initialLoadDone]);

  // Fetch backups on mount
  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  // Reload live data when config changes
  const loadLiveData = useCallback(async () => {
    if (!config) return;
    logger.debug("OverviewPage", "loading live data");
    try {
      const running = await invokeCommand<boolean>("check_niri_running", {});
      setNiriRunning(running);

      if (running) {
        try {
          const versionResult = await invokeCommand<string>("niri_msg", { args: ["--version"] });
          setNiriVersion(versionResult.trim());
        } catch {
          setNiriVersion(t("overview.ipc.version_unknown"));
        }

        try {
          const socketResult = await invokeCommand<string>("niri_msg", { args: ["socket"] });
          setSocketPath(socketResult.trim() || t("overview.ipc.socket_unavailable"));
        } catch {
          setSocketPath(t("overview.ipc.socket_unavailable"));
        }
      } else {
        setNiriVersion(null);
        setSocketPath(null);
      }
    } catch (err) {
      logger.error("OverviewPage", "live data load failed", err);
      setNiriRunning(false);
      setNiriVersion(null);
      setSocketPath(null);
    }
  }, [config, t]);

  useEffect(() => {
    loadLiveData();
  }, [loadLiveData]);

  // Determine validation status
  const validationStatus = isValidating
    ? "unknown"
    : validationErrors.length > 0
    ? "invalid"
    : validationWarnings.length > 0
    ? "warning"
    : config
    ? "valid"
    : "unknown";

  const handleReload = useCallback(async () => {
    logger.info("OverviewPage", "reload triggered");
    clearValidation();
    await load();
    await loadLiveData();
    fetchBackups();
  }, [load, loadLiveData, clearValidation, fetchBackups]);

  const handleUndo = useCallback(() => {
    logger.info("OverviewPage", "undo triggered");
    useConfigStore.getState().resetToOriginal();
  }, []);

  // Empty state when no config loaded
  if (!config) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="p-6 space-y-4">
            <div className="text-center">
              <Monitor className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">{t("overview.empty_title")}</h2>
              <p className="text-muted-foreground">{t("overview.empty_description")}</p>
            </div>
            <Button onClick={handleReload} className="w-full" disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              {loading ? t("common.loading") : t("overview.reload_config")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Operations Bar */}
      <OperationsBar onReload={handleReload} onUndo={handleUndo} onRedo={() => {}} />

      {/* Main Content */}
      <div className="flex-1 flex overflow-auto p-4 gap-4">
        {/* Top Row: Stats Cards */}
        <OverviewStatsCards config={config} />

        {/* Middle Row: Three Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ConfigColumn
            configPath={meta?.["main-path"] ?? null}
            meta={meta}
            validationStatus={validationStatus}
            validationErrorsCount={validationErrors.length}
            validationWarningsCount={validationWarnings.length}
          />
          <IPCColumn
            niriRunning={niriRunning}
            setNiriRunning={setNiriRunning}
            niriVersion={niriVersion}
            setNiriVersion={setNiriVersion}
            socketPath={socketPath}
            setSocketPath={setSocketPath}
          />
          <SchemaColumn
            config={config}
            validationErrors={validationErrors}
            validationWarnings={validationWarnings}
          />
        </div>

        {/* Bottom Row: Validation Diagnostics + Workspace Timeline + Recent Snapshots */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ValidationDiagnostics />
          <WorkspaceTimeline config={config} />
          <RecentSnapshots maxItems={5} />
        </div>
      </div>
    </div>
  );
}