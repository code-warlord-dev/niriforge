"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Monitor,
  Keyboard,
  LayoutGrid,
  GanttChart,
  Zap,
  MousePointer2,
  Square,
  Play,
  Settings,
  Database,
  FileCode,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import pkg from "../../../package.json";

interface SidebarProps {
  isOpen: boolean;
  activePage: string;
  onPageChange: (page: string) => void;
  onToggle: () => void;
}

const pages = [
  { id: "outputs", icon: Monitor, translationKey: "sidebar.outputs" },
  { id: "input", icon: Keyboard, translationKey: "sidebar.input" },
  { id: "binds", icon: Keyboard, translationKey: "sidebar.binds" },
  { id: "layout", icon: LayoutGrid, translationKey: "sidebar.layout" },
  { id: "rules", icon: GanttChart, translationKey: "sidebar.rules" },
  { id: "animations", icon: Zap, translationKey: "sidebar.animations" },
  { id: "gestures", icon: MousePointer2, translationKey: "sidebar.gestures" },
  { id: "workspaces", icon: Square, translationKey: "sidebar.workspaces" },
  { id: "startup", icon: Play, translationKey: "sidebar.startup" },
  { id: "misc", icon: Settings, translationKey: "sidebar.misc" },
  { id: "backups", icon: Database, translationKey: "sidebar.backups" },
  { id: "raw", icon: FileCode, translationKey: "sidebar.raw" },
] as const;

export function Sidebar({ isOpen, activePage, onPageChange, onToggle }: SidebarProps) {
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-full border-r bg-card transition-all duration-200",
        isOpen ? "w-64" : "w-16"
      )}
      aria-label={t("common.navigation")}
    >
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={onToggle}
            aria-label={isOpen ? t("common.collapse") : t("common.expand")}
          >
            {isOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2" role="navigation" aria-label={t("common.main_navigation")}>
          <ul className="space-y-1" role="list">
            {pages.map((page) => {
              const Icon = page.icon;
              const isActive = activePage === page.id;
              return (
                <li key={page.id}>
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    className={cn(
                      "w-full justify-start gap-3 text-left",
                      isOpen ? "" : "justify-center px-2"
                    )}
                    onClick={() => onPageChange(page.id)}
                    aria-current={isActive ? "page" : undefined}
                    title={isOpen ? undefined : t(page.translationKey)}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {isOpen && <span>{t(page.translationKey)}</span>}
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t p-2">
          {isOpen && (
            <p className="text-xs text-muted-foreground text-center">
              {t("app.version", { version: pkg.version })}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}