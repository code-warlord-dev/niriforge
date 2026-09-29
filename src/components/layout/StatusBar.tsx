import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useValidationStore } from "@/stores/validationStore";
import { useConfigStore } from "@/stores/configStore";

export function StatusBar() {
  const { t } = useTranslation();
  const errors = useValidationStore((s) => s.errors);
  const warnings = useValidationStore((s) => s.warnings);
  const isValidating = useValidationStore((s) => s.isValidating);
  const dirty = useConfigStore((s) => s.dirty);
  const meta = useConfigStore((s) => s.meta);

  const errCount = errors.length;
  const warnCount = warnings.length;

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t bg-muted/40 px-3 text-xs text-muted-foreground">
      <span
        className={cn(
          errCount > 0 && "text-destructive font-medium",
          errCount === 0 && warnCount === 0 && !isValidating && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {isValidating
          ? t("validation.validating")
          : errCount > 0
            ? t("validation.errors_count", { count: errCount })
            : warnCount > 0
              ? t("validation.warnings_count", { count: warnCount })
              : t("validation.no_errors")}
      </span>
      {dirty ? <span className="text-amber-600 dark:text-amber-400">{t("status.unsaved")}</span> : null}
      {meta?.path ? (
        <span className="ml-auto truncate font-mono" title={meta.path}>
          {meta.path}
        </span>
      ) : (
        <span className="ml-auto">{t("status.no_config")}</span>
      )}
    </footer>
  );
}
