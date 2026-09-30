"use client";

import { useTranslation } from "react-i18next";
import { LayoutGrid, Monitor, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Config } from "@/types/config";
import { logger } from "@/lib/logger";

interface WorkspaceTimelineProps {
  config: Config | null;
}

export function WorkspaceTimeline({ config }: WorkspaceTimelineProps) {
  const { t } = useTranslation();

  const workspaces = config?.workspaces ?? [];

  logger.debug("WorkspaceTimeline", "rendering", { workspacesCount: workspaces.length });

  if (workspaces.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            {t("overview.workspaces.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <p className="text-center">{t("overview.workspaces.empty")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          {t("overview.workspaces.title", { count: workspaces.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <ScrollArea className="max-h-64">
          <div className="space-y-3">
            {workspaces.map((workspace, index) => (
              <div key={workspace.name} className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent/50 transition-colors">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <LayoutGrid className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{workspace.name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    {workspace["open-on-output"] && (
                      <span className="flex items-center gap-1">
                        <Monitor className="h-3 w-3" />
                        {workspace["open-on-output"]}
                      </span>
                    )}
                    {workspace.layout && (
                      <Badge variant="outline" className="gap-1">
                        <Zap className="h-3 w-3" />
                        {t("overview.workspaces.custom_layout")}
                      </Badge>
                    )}
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  #{index + 1}
                </Badge>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}