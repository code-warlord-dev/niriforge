"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Save, CheckCircle } from "lucide-react";

interface HeaderProps {
  configPath: string | null;
  isDirty: boolean;
  isLoading: boolean;
  onSave: () => void;
  onValidate: () => void;
}

export function Header({
  configPath,
  isDirty,
  isLoading,
  onSave,
  onValidate,
}: HeaderProps) {
  const { t } = useTranslation();

  const displayPath = configPath ?? t("common.no_config");
  const pathTitle = configPath ?? undefined;

  return (
    <header className="sticky top-0 z-30 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center justify-between px-4 gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span
            className={cn(
              "text-sm truncate flex-1 max-w-md",
              isDirty ? "text-warning" : "text-muted-foreground"
            )}
            title={pathTitle}
          >
            {displayPath}
            {isDirty && (
              <span
                className="ml-1.5 inline-flex items-center text-warning"
                aria-label={t("status.unsaved")}
              >
                ●
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onValidate}
            disabled={isLoading}
            className="gap-1"
            aria-label={t("common.validate")}
          >
            <CheckCircle className="h-4 w-4" />
            <span>{t("common.validate")}</span>
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={onSave}
            disabled={!isDirty || isLoading}
            className="gap-1"
          >
            <Save className="h-4 w-4" />
            <span>{t("common.save")}</span>
          </Button>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}