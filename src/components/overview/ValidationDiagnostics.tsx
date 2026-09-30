"use client";

import { useTranslation } from "react-i18next";
import { AlertCircle, AlertTriangle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useValidationStore } from "@/stores/validationStore";
import { logger } from "@/lib/logger";

export function ValidationDiagnostics() {
  const { t } = useTranslation();

  const errors = useValidationStore((s) => s.errors);
  const warnings = useValidationStore((s) => s.warnings);
  const isValidating = useValidationStore((s) => s.isValidating);
  const dismissIssue = useValidationStore((s) => s.dismissIssue);
  const clearValidation = useValidationStore((s) => s.clear);

  const hasIssues = errors.length > 0 || warnings.length > 0;

  logger.debug("ValidationDiagnostics", "rendering", { errorsCount: errors.length, warningsCount: warnings.length });

  if (!hasIssues && !isValidating) {
    return (
      <Card className="border-green-500/20 bg-green-500/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 text-green-500">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">{t("overview.validation.no_issues")}</p>
              <p className="text-sm text-muted-foreground">{t("overview.validation.no_issues_desc")}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" />
            {t("overview.validation.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            {errors.length > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.length}
              </Badge>
            )}
            {warnings.length > 0 && (
              <Badge variant="secondary" className="gap-1">
                <AlertTriangle className="h-3 w-3 text-yellow-500" />
                {warnings.length}
              </Badge>
            )}
            {(errors.length > 0 || warnings.length > 0) && (
              <Button variant="ghost" size="icon" onClick={clearValidation} aria-label={t("common.clear")}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {isValidating && (
          <div className="flex items-center gap-3 p-3 text-muted-foreground">
            <AlertCircle className="h-5 w-5 animate-spin text-primary" />
            <span>{t("common.validating")}</span>
          </div>
        )}

        {errors.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("overview.validation.errors", { count: errors.length })}
              </p>
            </div>
            <ScrollArea className="max-h-48">
              <div className="space-y-2">
                {errors.map((error) => (
                  <div
                    key={error.id}
                    className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
                  >
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-destructive">{error.message}</p>
                      {(error.file || error.line !== undefined) && (
                        <p className="text-xs text-muted-foreground font-mono mt-1">
                          {error.file ? `${error.file}:` : ""}{error.line !== undefined ? `${error.line}` : ""}
                          {error.column !== undefined ? `:${error.column}` : ""}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => dismissIssue(error.id)}
                      aria-label={t("common.dismiss")}
                      className="shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {warnings.length > 0 && (
          <>
            {errors.length > 0 && <Separator className="my-2" />}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("overview.validation.warnings", { count: warnings.length })}
                </p>
              </div>
              <ScrollArea className="max-h-48">
                <div className="space-y-2">
                  {warnings.map((warning) => (
                    <div
                      key={warning.id}
                      className="flex items-start gap-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg"
                    >
                      <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-yellow-500">{warning.message}</p>
                        {(warning.file || warning.line !== undefined) && (
                          <p className="text-xs text-muted-foreground font-mono mt-1">
                            {warning.file ? `${warning.file}:` : ""}{warning.line !== undefined ? `${warning.line}` : ""}
                            {warning.column !== undefined ? `:${warning.column}` : ""}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => dismissIssue(warning.id)}
                        aria-label={t("common.dismiss")}
                        className="shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}