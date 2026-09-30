"use client";

import { useTranslation } from "react-i18next";
import { BookOpen, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import type { Config } from "@/types/config";
import { logger } from "@/lib/logger";

interface SchemaColumnProps {
  config: Config | null;
  validationErrors: Array<{ code?: string | null }>;
  validationWarnings: Array<{ code?: string | null }>;
}

export function SchemaColumn({
  config,
  validationErrors,
  validationWarnings,
}: SchemaColumnProps) {
  const { t } = useTranslation();

  // Calculate schema coverage based on known fields vs unknown fields
  const knownFieldsCount = config ? Object.keys(config).filter((k) => k !== "unknown").length : 0;
  const unknownFieldsCount = config?.unknown?.length ?? 0;
  const totalFields = knownFieldsCount + unknownFieldsCount;
  const coverage = totalFields > 0 ? Math.round((knownFieldsCount / totalFields) * 100) : 100;

  // Count unknown fields with validation errors/warnings
  const unknownErrors = validationErrors.filter((e) => e.code?.includes("unknown") || e.code?.includes("additional")).length;
  const unknownWarnings = validationWarnings.filter((e) => e.code?.includes("unknown") || e.code?.includes("additional")).length;

  logger.debug("SchemaColumn", "rendering", { coverage, unknownFieldsCount, knownFieldsCount });

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          {t("overview.schema.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 p-4 pt-0">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {t("overview.schema.version")}
            </p>
            <p className="font-mono text-sm">{t("overview.schema.niri_version")}</p>
          </div>

          <Separator />

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {t("overview.schema.coverage")}
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>{t("overview.schema.known_fields", { count: knownFieldsCount })}</span>
                <span className="text-muted-foreground">{coverage}%</span>
              </div>
              <Progress value={coverage} className="h-2" />
            </div>
          </div>

          <Separator />

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {t("overview.schema.unknown_fields")}
            </p>
            <div className="flex items-center gap-2">
              {unknownFieldsCount > 0 ? (
                <>
                  <Badge variant="secondary" className="gap-1">
                    <AlertTriangle className="h-3 w-3 text-yellow-500" />
                    {unknownFieldsCount}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {t("overview.schema.unknown_fields_desc", { errors: unknownErrors, warnings: unknownWarnings })}
                  </span>
                </>
              ) : (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  {t("overview.schema.none")}
                </Badge>
              )}
            </div>
          </div>

          {unknownFieldsCount > 0 && (
            <>
              <Separator />
              <div className="text-xs text-muted-foreground">
                <p>{t("overview.schema.unknown_fields_note")}</p>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}