"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConfigStore } from "@/stores/configStore";
import { useOutputsCanvasStore } from "@/stores/outputsCanvasStore";
import { useValidationStore } from "@/stores/validationStore";
import { invokeCommand } from "@/lib/ipc";
import { OutputsCanvas } from "@/components/outputs/OutputsCanvas";
import { OutputPropertiesPanel } from "@/components/outputs/OutputPropertiesPanel";
import { OutputKDLPanel } from "@/components/outputs/OutputKDLPanel";
import type { OutputInfo } from "@/types/config";
import { logger } from "@/lib/logger";

export function OutputsPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const load = useConfigStore((s) => s.load);
  const save = useConfigStore((s) => s.save);
  const validate = useConfigStore((s) => s.validate);
  const loading = useConfigStore((s) => s.loading);
  const saving = useConfigStore((s) => s.saving);

  const selectedOutputId = useOutputsCanvasStore((s) => s.selectedOutputId);
  const setSelectedOutputId = useOutputsCanvasStore((s) => s.setSelectedOutputId);
  const zoom = useOutputsCanvasStore((s) => s.zoom);
  const pan = useOutputsCanvasStore((s) => s.pan);

  const validationErrors = useValidationStore((s) => s.errors);
  const validationWarnings = useValidationStore((s) => s.warnings);
  const isValidating = useValidationStore((s) => s.isValidating);
  const setErrors = useValidationStore((s) => s.setErrors);
  const setWarnings = useValidationStore((s) => s.setWarnings);
  const startValidation = useValidationStore((s) => s.startValidation);
  const finishValidation = useValidationStore((s) => s.finishValidation);
  const clearValidation = useValidationStore((s) => s.clear);

  const [liveOutputs, setLiveOutputs] = useState<Map<string, { modes: string[]; currentMode: string }>>(new Map());
  const [availableModes, setAvailableModes] = useState<string[]>([]);

  const hasConfig = !!config;

  // Log mount
  useEffect(() => {
    logger.info("OutputsPage", "mounted");
    return () => logger.info("OutputsPage", "unmounted");
  }, []);

  // Collect all available modes from config
  const configModes = useMemo(() => {
    if (!config) return [];
    const modes = new Set<string>();
    config.outputs.forEach((o) => {
      if (o.mode) modes.add(o.mode);
    });
    return Array.from(modes).sort();
  }, [config]);

  // Load live outputs from niri if running
  const loadLiveOutputs = useCallback(async () => {
    logger.debug("OutputsPage", "loading live outputs");
    try {
      const result = await invokeCommand<OutputInfo[]>("get_outputs", {});
      const newLiveOutputs = new Map<string, { modes: string[]; currentMode: string }>();
      const allModes = new Set<string>(configModes);

      result.forEach((output) => {
        const modes = output.modes.map((m) => `${m.width}x${m.height}@${m["refresh-rate"]}`);
        modes.forEach((m) => allModes.add(m));
        newLiveOutputs.set(output.name, {
          modes,
          currentMode: output["current-mode"] ?? "",
        });
      });

      setLiveOutputs(newLiveOutputs);
      setAvailableModes(Array.from(allModes).sort());
      logger.info("OutputsPage", "live outputs loaded", { count: result.length });
    } catch (err) {
      // niri not running or error - silently ignore, use config modes only
      logger.debug("OutputsPage", "could not load live outputs", err);
      setAvailableModes(configModes);
    }
  }, [configModes]);

  useEffect(() => {
    loadLiveOutputs();
  }, [loadLiveOutputs]);

  // Auto-select first output if none selected
  useEffect(() => {
    if (config && config.outputs.length > 0 && !selectedOutputId) {
      logger.debug("OutputsPage", "auto-selecting first output", { outputId: config.outputs[0].name });
      setSelectedOutputId(config.outputs[0].name);
    }
  }, [config, selectedOutputId, setSelectedOutputId]);

  // Log zoom/pan changes (debounced)
  useEffect(() => {
    logger.trace("OutputsPage", "zoom changed", { zoom });
  }, [zoom]);

  useEffect(() => {
    logger.trace("OutputsPage", "pan changed", { pan });
  }, [pan]);

  const handleValidate = useCallback(async () => {
    if (!config) return;
    logger.info("OutputsPage", "validate triggered");
    startValidation();
    try {
      const result = await validate();
      setErrors(result.errors);
      setWarnings(result.warnings);
      logger.info("OutputsPage", "validation complete", {
        valid: result.valid,
        errors: result.errors.length,
        warnings: result.warnings.length,
      });
    } catch (err) {
      logger.error("OutputsPage", "validation failed", err);
    } finally {
      finishValidation();
    }
  }, [config, validate, startValidation, finishValidation, setErrors, setWarnings]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    logger.info("OutputsPage", "save triggered");
    try {
      startValidation();
      const result = await validate();
      setErrors(result.errors);
      setWarnings(result.warnings);
      finishValidation();

      if (!result.valid) {
        logger.warn("OutputsPage", "save aborted: validation failed", {
          errors: result.errors.length,
          warnings: result.warnings.length,
        });
        return;
      }

      await save({ "create-backup": true });
      logger.info("OutputsPage", "save successful");
    } catch (err) {
      logger.error("OutputsPage", "save failed", err);
      finishValidation();
    }
  }, [config, validate, save, startValidation, finishValidation, setErrors, setWarnings]);

  const handleReload = useCallback(async () => {
    logger.info("OutputsPage", "reload triggered");
    clearValidation();
    await load();
    await loadLiveOutputs();
  }, [load, loadLiveOutputs, clearValidation]);

  if (!hasConfig) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              {t("outputs.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center text-muted-foreground">
              <p>{t("outputs.no_config")}</p>
              <p className="text-sm">{t("outputs.load_config_first")}</p>
            </div>
            <Button onClick={handleReload} className="w-full" disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? t("common.loading") : t("outputs.reload")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (config.outputs.length === 0) {
    return (
      <div className="flex h-full flex-col p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            {t("outputs.title")}
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleValidate} disabled={isValidating}>
              <RefreshCw className={`h-4 w-4 ${isValidating ? "animate-spin" : ""}`} />
              {t("common.validate")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Loader2 className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} />
              {t("common.save")}
            </Button>
          </div>
        </div>

        <Card className="flex-1 flex items-center justify-center">
          <CardContent className="text-center">
            <Monitor className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t("outputs.empty_title")}</h3>
            <p className="text-muted-foreground mb-4">{t("outputs.empty_description")}</p>
            <Button variant="outline" disabled>
              <Monitor className="h-4 w-4 mr-2" />
              {t("outputs.add_output")}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">{t("outputs.run_niri_hint")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b p-4 bg-card">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            {t("outputs.title")}
          </h1>
          {config.outputs.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {t("outputs.outputs_count", { count: config.outputs.length })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleReload} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("common.reload")}
          </Button>
          <Button variant="outline" onClick={handleValidate} disabled={isValidating}>
            <RefreshCw className={`h-4 w-4 ${isValidating ? "animate-spin" : ""}`} />
            {t("common.validate")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Loader2 className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} />
            {t("common.save")}
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Canvas */}
        <div className="lg:w-2/3 flex-1 min-w-0 border-r">
          <OutputsCanvas />
        </div>

        {/* Right: Properties + KDL */}
        <div className="lg:w-1/3 w-full lg:min-w-[320px] flex flex-col min-w-0">
          <Tabs defaultValue="properties" className="flex-1 flex flex-col">
            <TabsList className="flex-shrink-0">
              <TabsTrigger value="properties">{t("outputs.properties")}</TabsTrigger>
              <TabsTrigger value="kdl">{t("outputs.kdl_block")}</TabsTrigger>
            </TabsList>
            <TabsContent value="properties" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <OutputPropertiesPanel
                  availableModes={availableModes}
                  liveOutputs={liveOutputs}
                />
              </ScrollArea>
            </TabsContent>
            <TabsContent value="kdl" className="flex-1 overflow-hidden">
              <OutputKDLPanel selectedOutputId={selectedOutputId} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Validation summary at bottom */}
      {(validationErrors.length > 0 || validationWarnings.length > 0) && (
        <div className="border-t bg-card p-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">{t("validation.title")}</span>
            <span className="text-muted-foreground">
              {validationErrors.length > 0 && (
                <span className="text-destructive mr-2">
                  <AlertCircle className="h-3 w-3 inline mr-1" />
                  {t("validation.errors_count", { count: validationErrors.length })}
                </span>
              )}
              {validationWarnings.length > 0 && (
                <span className="text-warning">
                  <AlertCircle className="h-3 w-3 inline mr-1" />
                  {t("validation.warnings_count", { count: validationWarnings.length })}
                </span>
              )}
            </span>
          </div>
          <ScrollArea className="max-h-32">
            <div className="space-y-1 font-mono text-xs">
              {validationErrors.map((err) => (
                <div key={err.id} className="text-destructive">
                  {err.file ? `${err.file}:${err.line ?? ""}: ` : ""}{err.message}
                </div>
              ))}
              {validationWarnings.map((warn) => (
                <div key={warn.id} className="text-warning">
                  {warn.file ? `${warn.file}:${warn.line ?? ""}: ` : ""}{warn.message}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}