"use client";

import { useTranslation } from "react-i18next";
import { RefreshCw, CheckCircle, Save, RotateCcw, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/configStore";
import { useValidationStore } from "@/stores/validationStore";
import { useCallback } from "react";
import { logger } from "@/lib/logger";

interface OperationsBarProps {
  onReload?: () => Promise<void>;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function OperationsBar({ onReload, onUndo, onRedo }: OperationsBarProps) {
  const { t } = useTranslation();

  const config = useConfigStore((s) => s.config);
  const dirty = useConfigStore((s) => s.dirty);
  const loading = useConfigStore((s) => s.loading);
  const saving = useConfigStore((s) => s.saving);
  const load = useConfigStore((s) => s.load);
  const save = useConfigStore((s) => s.save);
  const validate = useConfigStore((s) => s.validate);
  const resetToOriginal = useConfigStore((s) => s.resetToOriginal);

  const isValidating = useValidationStore((s) => s.isValidating);
  const setErrors = useValidationStore((s) => s.setErrors);
  const setWarnings = useValidationStore((s) => s.setWarnings);
  const startValidation = useValidationStore((s) => s.startValidation);
  const finishValidation = useValidationStore((s) => s.finishValidation);
  const clearValidation = useValidationStore((s) => s.clear);

  const handleValidate = useCallback(async () => {
    if (!config) return;
    logger.info("OperationsBar", "validate triggered");
    startValidation();
    try {
      const result = await validate();
      setErrors(result.errors);
      setWarnings(result.warnings);
      logger.info("OperationsBar", "validation complete", {
        valid: result.valid,
        errors: result.errors.length,
        warnings: result.warnings.length,
      });
    } catch (err) {
      logger.error("OperationsBar", "validation failed", err);
    } finally {
      finishValidation();
    }
  }, [config, validate, startValidation, finishValidation, setErrors, setWarnings]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    logger.info("OperationsBar", "save triggered");
    try {
      startValidation();
      const result = await validate();
      setErrors(result.errors);
      setWarnings(result.warnings);
      finishValidation();

      if (!result.valid) {
        logger.warn("OperationsBar", "save aborted: validation failed", {
          errors: result.errors.length,
          warnings: result.warnings.length,
        });
        return;
      }

      await save({ "create-backup": true });
      logger.info("OperationsBar", "save successful");
    } catch (err) {
      logger.error("OperationsBar", "save failed", err);
      finishValidation();
    }
  }, [config, validate, save, startValidation, finishValidation, setErrors, setWarnings]);

  const handleReload = useCallback(async () => {
    logger.info("OperationsBar", "reload triggered");
    clearValidation();
    await load();
    if (onReload) await onReload();
  }, [load, clearValidation, onReload]);

  const handleUndo = useCallback(() => {
    logger.info("OperationsBar", "undo triggered");
    resetToOriginal();
    if (onUndo) onUndo();
  }, [resetToOriginal, onUndo]);

  const handleRedo = useCallback(() => {
    logger.info("OperationsBar", "redo triggered");
    // Redo would require history store - for now just log
    if (onRedo) onRedo();
  }, [onRedo]);

  return (
    <div className="flex flex-wrap items-center gap-2 p-4 border-b bg-card/50">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Button
          variant="outline"
          onClick={handleValidate}
          disabled={isValidating || !config}
          className="whitespace-nowrap"
        >
          <CheckCircle className={cn("h-4 w-4 mr-2", isValidating && "animate-spin")} />
          {isValidating ? t("common.validating") : t("common.validate")}
        </Button>

        <Button
          onClick={handleSave}
          disabled={saving || !config || !dirty}
          className="whitespace-nowrap"
        >
          <Save className={cn("h-4 w-4 mr-2", saving && "animate-spin")} />
          {saving ? t("common.saving") : t("common.save")}
        </Button>

        <Button
          variant="outline"
          onClick={handleReload}
          disabled={loading}
          className="whitespace-nowrap"
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
          {loading ? t("common.loading") : t("common.reload")}
        </Button>

        <Button
          variant="outline"
          onClick={handleUndo}
          disabled={!dirty}
          className="whitespace-nowrap"
        >
          <Undo2 className="h-4 w-4 mr-2" />
          {t("common.undo")}
        </Button>

        <Button
          variant="outline"
          onClick={handleRedo}
          disabled={true} // TODO: implement history
          className="whitespace-nowrap opacity-50"
        >
          <Redo2 className="h-4 w-4 mr-2" />
          {t("common.redo")}
        </Button>
      </div>

      {dirty && config && (
        <div className="flex items-center gap-2 text-sm text-warning">
          <RotateCcw className="h-4 w-4 animate-spin" />
          <span>{t("overview.operations.dirty_indicator")}</span>
        </div>
      )}
    </div>
  );
}