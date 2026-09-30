"use client";

import { useTranslation } from "react-i18next";
import { FileText, Clock, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { ConfigMeta } from "@/types/config";
import { logger } from "@/lib/logger";

interface ConfigColumnProps {
  configPath: string | null;
  meta: ConfigMeta | null;
  validationStatus: "valid" | "invalid" | "warning" | "unknown";
  validationErrorsCount: number;
  validationWarningsCount: number;
}

export function ConfigColumn({
  configPath,
  meta,
  validationStatus,
  validationErrorsCount,
  validationWarningsCount,
}: ConfigColumnProps) {
  const { t } = useTranslation();

  logger.debug("ConfigColumn", "rendering", { configPath, validationStatus });

  const getStatusBadge = () => {
    switch (validationStatus) {
      case "valid":
        return (
          <Badge variant="default" className="gap-1">
            <CheckCircle className="h-3 w-3 text-green-500" />
            {t("overview.config.validation_valid")}
          </Badge>
        );
      case "invalid":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            {t("overview.config.validation_invalid", { count: validationErrorsCount })}
          </Badge>
        );
      case "warning":
        return (
          <Badge variant="secondary" className="gap-1">
            <AlertCircle className="h-3 w-3 text-yellow-500" />
            {t("overview.config.validation_warning", { count: validationWarningsCount })}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            {t("overview.config.validation_unknown")}
          </Badge>
        );
    }
  };

  const includedFiles = meta?.["included-files"] ?? [];

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {t("overview.config.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 p-4 pt-0">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {t("overview.config.path")}
            </p>
            <p className="font-mono text-sm truncate" title={configPath ?? ""}>
              {configPath ?? t("overview.config.no_path")}
            </p>
          </div>

          <Separator />

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {t("overview.config.last_modified")}
            </p>
            <p className="text-sm">
              {meta?.["main-path"]
                ? t("overview.config.modified_recently")
                : t("overview.config.unknown")}
            </p>
          </div>

          <Separator />

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {t("overview.config.validation_status")}
            </p>
            <div className="flex items-center gap-2">{getStatusBadge()}</div>
          </div>

          {includedFiles.length > 1 && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {t("overview.config.includes", { count: includedFiles.length - 1 })}
                </p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {includedFiles.slice(1).map((file, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      <FileText className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono truncate">{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}