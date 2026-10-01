"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface RuleInspectorPanelProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Frame around one rule's editable fields.
 *
 * Deliberately layout-free in the middle: which fields exist is a property of
 * the rule family, not of this shell, which is why a window rule and a layer
 * rule can share it without sharing a single field.
 */
export function RuleInspectorPanel({
  title,
  subtitle,
  icon,
  actions,
  children,
}: RuleInspectorPanelProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 border-b border-border-subtle py-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{title}</div>
            {subtitle && (
              <div className="truncate font-mono text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto p-4">{children}</CardContent>
    </Card>
  );
}
