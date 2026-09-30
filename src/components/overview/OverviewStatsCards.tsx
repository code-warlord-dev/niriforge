"use client";

import { useTranslation } from "react-i18next";
import { Monitor, Keyboard, Gavel } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Config } from "@/types/config";

interface OverviewStatsCardsProps {
  config: Config | null;
}

export function OverviewStatsCards({ config }: OverviewStatsCardsProps) {
  const { t } = useTranslation();

  const outputsCount = config?.outputs.length ?? 0;
  const bindsCount = config?.binds.binds.length ?? 0;
  const rulesCount = (config?.["window-rules"].length ?? 0) + (config?.["layer-rules"].length ?? 0);

  const cards = [
    {
      id: "outputs",
      icon: Monitor,
      title: t("overview.stats.outputs"),
      value: outputsCount,
      description: t("overview.stats.outputs_desc"),
      color: "text-primary",
    },
    {
      id: "binds",
      icon: Keyboard,
      title: t("overview.stats.binds"),
      value: bindsCount,
      description: t("overview.stats.binds_desc"),
      color: "text-secondary",
    },
    {
      id: "rules",
      icon: Gavel,
      title: t("overview.stats.rules"),
      value: rulesCount,
      description: t("overview.stats.rules_desc"),
      color: "text-warning",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.id} className="transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
                  <p className={cn("text-3xl font-bold mt-1", card.color)}>{card.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0", `bg-${card.color.replace("text-", "")}/10`)}>
                  <Icon className={cn("h-5 w-5", card.color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}