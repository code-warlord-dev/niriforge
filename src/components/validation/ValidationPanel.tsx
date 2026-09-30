"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import type { ValidationIssue } from "@/types/config";

interface ValidationPanelProps {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  isValidating: boolean;
  onDismiss?: (id: string) => void;
  onClear?: () => void;
}

export function ValidationPanel({ errors, warnings, isValidating, onDismiss, onClear }: ValidationPanelProps) {
  const { t } = useTranslation();
  const hasIssues = errors.length > 0 || warnings.length > 0;

  if (!hasIssues && !isValidating) {
    return (
      <Card className="border-green-200 dark:border-green-800">
        <CardContent className="py-4">
          <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            <span>{t("validation.no_errors")}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(errors.length > 0 && "border-destructive/50 dark:border-destructive/50")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{t("validation.title")}</CardTitle>
          <div className="flex items-center gap-2">
            {onClear && (
              <Button variant="ghost" size="sm" onClick={onClear} className="h-7">
                <X className="h-3 w-3" />
                <span className="hidden sm:inline">{t("common.clear")}</span>
              </Button>
            )}
            {isValidating && <span className="text-xs text-muted-foreground animate-pulse">{t("validation.validating")}</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[300px]">
          <div className="p-4 space-y-3">
            {errors.map((error) => (
              <ValidationItem key={error.id} issue={error} variant="error" onDismiss={onDismiss} />
            ))}
            {warnings.map((warning) => (
              <ValidationItem key={warning.id} issue={warning} variant="warning" onDismiss={onDismiss} />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

interface ValidationItemProps {
  issue: ValidationIssue;
  variant: "error" | "warning";
  onDismiss?: (id: string) => void;
}

/** `file:line:column`, with the parts the backend did not send left off. */
function formatLocation(issue: ValidationIssue): string | null {
  if (issue.file === undefined || issue.file === null) return null;
  const line = issue.line === undefined || issue.line === null ? "" : `:${issue.line}`;
  const column = issue.line === undefined || issue.line === null || issue.column === undefined || issue.column === null
    ? ""
    : `:${issue.column}`;
  return `${issue.file}${line}${column}`;
}

function ValidationItem({ issue, variant, onDismiss }: ValidationItemProps) {
  const Icon = AlertCircle;
  const iconClass = variant === "error" ? "text-destructive" : "text-yellow-500";
  const borderClass = variant === "error" ? "border-l-destructive" : "border-l-yellow-500";
  const location = formatLocation(issue);

  return (
    <div className={cn("relative p-3 rounded-r-md border-l-4 bg-muted/30", borderClass)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", iconClass)} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{issue.message}</p>
          {location && (
            <p className="text-xs text-muted-foreground font-mono mt-1">{location}</p>
          )}
          {issue.code && (
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              Code: {issue.code}
            </p>
          )}
        </div>
        {onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onDismiss(issue.id)}
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
