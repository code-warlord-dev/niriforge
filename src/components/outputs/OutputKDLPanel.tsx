"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Copy, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConfigStore } from "@/stores/configStore";
import { useOutputsCanvasStore } from "@/stores/outputsCanvasStore";
import { useValidationStore } from "@/stores/validationStore";
import { invokeCommand } from "@/lib/ipc";

interface OutputKDLPanelProps {
  selectedOutputId: string | null;
}

export function OutputKDLPanel({ selectedOutputId: propSelectedOutputId }: OutputKDLPanelProps) {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const selectedOutputId = useOutputsCanvasStore((s) => s.selectedOutputId);
  const errors = useValidationStore((s) => s.errors);
  const warnings = useValidationStore((s) => s.warnings);

  const [isExpanded, setIsExpanded] = useState(true);
  const [kdlContent, setKdlContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const effectiveSelectedId = propSelectedOutputId ?? selectedOutputId;

  const outputErrors = useMemo(() => {
    if (!effectiveSelectedId) return [];
    return errors.filter((e) => e.message.includes(effectiveSelectedId));
  }, [errors, effectiveSelectedId]);

  const outputWarnings = useMemo(() => {
    if (!effectiveSelectedId) return [];
    return warnings.filter((w) => w.message.includes(effectiveSelectedId));
  }, [warnings, effectiveSelectedId]);

  const hasIssues = outputErrors.length > 0 || outputWarnings.length > 0;

  const extractOutputKDL = useCallback(async () => {
    if (!config || !effectiveSelectedId) {
      setKdlContent("");
      return;
    }

    setIsLoading(true);
    try {
      const result = await invokeCommand<string>("serialize_file", {
        config: { config, meta: { "main-path": "", "included-files": [] } },
      });

      // Simple extraction of the output node
      const outputRegex = new RegExp(
        `output\\s+"${effectiveSelectedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*\\{[^}]*\\}`,
        "s"
      );
      const match = result.match(outputRegex);
      if (match) {
        setKdlContent(match[0]);
      } else {
        // Fallback: show a representation
        const output = config.outputs.find((o) => o.name === effectiveSelectedId);
        if (output) {
          const lines = [`output "${output.name}" {`];
          if (output.off) lines.push("  off");
          if (output.mode) lines.push(`  mode ${output.mode}`);
          if (output.scale !== undefined) lines.push(`  scale ${output.scale}`);
          if (output.transform) lines.push(`  transform ${output.transform}`);
          if (output.position) lines.push(`  position ${output.position.x} ${output.position.y}`);
          if (output["variable-refresh-rate"]) lines.push("  variable-refresh-rate");
          if (output["focus-at-startup"]) lines.push("  focus-at-startup");
          if (output["background-color"]) lines.push(`  background-color ${output["background-color"]}`);
          if (output["max-bpc"]) lines.push(`  max-bpc ${output["max-bpc"]}`);
          lines.push("}");
          setKdlContent(lines.join("\n"));
        } else {
          setKdlContent("");
        }
      }
    } catch (err) {
      console.error("Failed to serialize KDL:", err);
      setKdlContent("");
    } finally {
      setIsLoading(false);
    }
  }, [config, effectiveSelectedId]);

  useEffect(() => {
    extractOutputKDL();
  }, [extractOutputKDL]);

  const handleCopy = useCallback(async () => {
    if (kdlContent) {
      await navigator.clipboard.writeText(kdlContent);
    }
  }, [kdlContent]);

  if (!effectiveSelectedId) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{t("outputs.kdl_block")}</span>
            <span className="text-xs text-muted-foreground">{t("outputs.select_output")}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center text-muted-foreground">
          <p>{t("outputs.select_output")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span>{t("outputs.kdl_block")}</span>
            {hasIssues && <AlertTriangle className="h-4 w-4 text-warning" />}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-label={isExpanded ? t("common.collapse") : t("common.expand")}
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleCopy} aria-label={t("common.copy")}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isExpanded ? (
          <ScrollArea className="h-64 max-h-[400px] font-mono text-xs">
            <pre className="p-3 bg-muted rounded-md overflow-x-auto text-foreground">
              <code>{kdlContent || (isLoading ? t("common.loading") : t("outputs.no_kdl"))}</code>
            </pre>
          </ScrollArea>
        ) : (
          <div className="text-xs text-muted-foreground py-2">
            {t("outputs.kdl_collapsed")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}