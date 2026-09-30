"use client";

import { useTranslation } from "react-i18next";
import { Database, RotateCcw, Clock, Trash2, Loader2, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";
import { useBackupStore } from "@/stores/backupStore";
import { invokeCommand } from "@/lib/ipc";
import { useCallback, useEffect, useState } from "react";
import { logger } from "@/lib/logger";
import type { BackupMeta } from "@/types/config";

interface RecentSnapshotsProps {
  maxItems?: number;
}

export function RecentSnapshots({ maxItems = 5 }: RecentSnapshotsProps) {
  const { t } = useTranslation();

  const backups = useBackupStore((s) => s.backups);
  const loading = useBackupStore((s) => s.loading);
  const fetchBackups = useBackupStore((s) => s.fetchBackups);
  const restore = useBackupStore((s) => s.restore);
  const deleteBackup = useBackupStore((s) => s.delete);

  const [recentBackups, setRecentBackups] = useState<BackupMeta[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  useEffect(() => {
    const sorted = [...backups].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setRecentBackups(sorted.slice(0, maxItems));
  }, [backups, maxItems]);

  const handleRestore = useCallback(async (id: string) => {
    setRestoringId(id);
    logger.info("RecentSnapshots", "restoring backup", { id });
    try {
      await restore(id);
      logger.info("RecentSnapshots", "backup restored", { id });
    } catch (err) {
      logger.error("RecentSnapshots", "restore failed", err);
    } finally {
      setRestoringId(null);
    }
  }, [restore]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm(t("overview.backups.confirm_delete"))) return;
    setDeletingId(id);
    logger.info("RecentSnapshots", "deleting backup", { id });
    try {
      await deleteBackup(id);
      logger.info("RecentSnapshots", "backup deleted", { id });
    } catch (err) {
      logger.error("RecentSnapshots", "delete failed", err);
    } finally {
      setDeletingId(null);
    }
  }, [deleteBackup, t]);

  const handleCreateBackup = useCallback(async () => {
    logger.info("RecentSnapshots", "creating backup");
    try {
      await invokeCommand<BackupMeta>("create_backup", { name: t("overview.backups.manual_name") });
      await fetchBackups();
      logger.info("RecentSnapshots", "backup created");
    } catch (err) {
      logger.error("RecentSnapshots", "create backup failed", err);
    }
  }, [fetchBackups, t]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-muted-foreground" />
            {t("overview.backups.title", { count: backups.length })}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={handleCreateBackup} disabled={loading}>
            <RotateCcw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            {loading ? t("common.loading") : t("overview.backups.create")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {loading && backups.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span>{t("common.loading")}</span>
          </div>
        ) : recentBackups.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <Database className="h-8 w-8 mr-2 opacity-50" />
            <p>{t("overview.backups.empty")}</p>
          </div>
        ) : (
          <ScrollArea className="max-h-64">
            <div className="space-y-2">
              {recentBackups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0">
                      <Database className="h-4 w-4 text-secondary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{backup.name ?? t("overview.backups.unnamed")}</p>
                        {backup.comment && (
                          <Badge variant="outline" className="text-xs">
                            {backup.comment}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(backup.timestamp)}
                        </span>
                        {backup["niri-version"] && (
                          <span className="flex items-center gap-1 font-mono">
                            <Zap className="h-3 w-3" />
                            {backup["niri-version"]}
                          </span>
                        )}
                        {backup.hash && (
                          <span className="font-mono truncate max-w-[120px]">{backup.hash.slice(0, 8)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRestore(backup.id)}
                      disabled={restoringId === backup.id}
                      aria-label={t("overview.backups.restore")}
                      title={t("overview.backups.restore")}
                    >
                      {restoringId === backup.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(backup.id)}
                      disabled={deletingId === backup.id}
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                      className="text-destructive hover:bg-destructive/10"
                    >
                      {deletingId === backup.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}