"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Check, Copy, FileCode2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

interface KdlPreviewPanelProps {
  /** Node name the preview opens with, e.g. `window-rule`. */
  nodeName: string;
  lines: string[];
  title?: string;
  note?: string;
  icon?: ReactNode;
}

/**
 * Read-only view of the KDL a rule will be written as.
 *
 * Nothing here edits the rule: the inspector owns the fields, and this panel
 * only shows the text they produce so a change can be checked before saving.
 */
export function KdlPreviewPanel({ nodeName, lines, title, note, icon }: KdlPreviewPanelProps) {
  const [copied, setCopied] = useState(false);

  const text = [`${nodeName} {`, ...lines.map((line) => `    ${line}`), "}"].join("\n");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      logger.warn("KdlPreviewPanel", "clipboard write failed", err);
    }
  }, [text]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon ?? <FileCode2 className="h-4 w-4 shrink-0 text-primary" />}
          <span className="truncate text-sm font-medium">{title ?? nodeName}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy} title={copied ? title ?? nodeName : "Copy"} aria-label="Copy">
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
        <code>{text}</code>
      </pre>
    </div>
  );
}
