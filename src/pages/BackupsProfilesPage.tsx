"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Database,
  FileCode2,
  FolderTree,
  History,
  Loader2,
  RotateCcw,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBackupStore } from "@/stores/backupStore";
import { useConfigStore } from "@/stores/configStore";
import { useToast } from "@/hooks/useToast";
import { describeAppError, toAppError } from "@/lib/ipc";
import { formatDate } from "@/lib/utils";
import type { AppError, BackupMeta } from "@/types/config";
import { logger } from "@/lib/logger";

/**
 * Backups and profiles.
 *
 * Snapshots are files on disk written by the backend, so everything on this
 * page goes through the backup store and its commands rather than through
 * component state. Restore is transactional in the backend: a candidate that
 * fails validation leaves the live config alone.
 */
export function BackupsProfilesPage() {
  const { t } = useTranslation();
  const { addToast } = useToast();

  const backups = useBackupStore((s) => s.backups);
  const loading = useBackupStore((s) => s.loading);
  const storeError = useBackupStore((s) => s.error);
  const fetchBackups = useBackupStore((s) => s.fetchBackups);
  const restore = useBackupStore((s) => s.restore);
  const create = useBackupStore((s) => s.create);
  const remove = useBackupStore((s) => s.delete);

  const config = useConfigStore((s) => s.config);
  const dirty = useConfigStore((s) => s.dirty);
  const load = useConfigStore((s) => s.load);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [namedOpen, setNamedOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshotComment, setSnapshotComment] = useState("");
  const [pendingRestore, setPendingRestore] = useState<BackupMeta | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupMeta | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    logger.info("BackupsProfilesPage", "mounted");
    return () => logger.info("BackupsProfilesPage", "unmounted");
  }, []);

  useEffect(() => {
    void fetchBackups();
  }, [fetchBackups]);

  useEffect(() => {
    if (selectedId === null && backups.length > 0) setSelectedId(backups[0].id);
    if (selectedId !== null && !backups.some((backup) => backup.id === selectedId)) {
      setSelectedId(backups.length > 0 ? backups[0].id : null);
    }
  }, [backups, selectedId]);

  const selected = useMemo(
    () => backups.find((backup) => backup.id === selectedId) ?? null,
    [backups, selectedId]
  );

  const reportError = useCallback(
    (err: unknown) => {
      const appError: AppError = toAppError(err);
      logger.error("BackupsProfilesPage", "operation failed", appError);
      addToast({
        title: appError.type,
        description: describeAppError(appError),
        variant: "destructive",
      });
    },
    [addToast]
  );

  const handleCreate = useCallback(async () => {
    const name = snapshotName.trim();
    setBusyId("new");
    try {
      const created = await create(name === "" ? undefined : name, snapshotComment.trim() === "" ? undefined : snapshotComment.trim());
      addToast({ title: t("backups.created", { defaultValue: "Snapshot created" }), variant: "success" });
      setNamedOpen(false);
      setSnapshotName("");
      setSnapshotComment("");
      setSelectedId(created.id);
      logger.info("BackupsProfilesPage", "snapshot created", { id: created.id });
    } catch (err) {
      reportError(err);
    } finally {
      setBusyId(null);
    }
  }, [addToast, create, reportError, snapshotComment, snapshotName, t]);

  const handleRestore = useCallback(
    async (backup: BackupMeta) => {
      setPendingRestore(null);
      setBusyId(backup.id);
      try {
        await restore(backup.id);
        // The files on disk are now the snapshot's, so the typed model has to be
        // re-read rather than patched.
        await load();
        addToast({ title: t("backups.restored", { defaultValue: "Snapshot restored" }), variant: "success" });
        logger.info("BackupsProfilesPage", "snapshot restored", { id: backup.id });
      } catch (err) {
        reportError(err);
      } finally {
        setBusyId(null);
      }
    },
    [addToast, load, reportError, restore, t]
  );

  const handleDelete = useCallback(
    async (backup: BackupMeta) => {
      setPendingDelete(null);
      setBusyId(backup.id);
      try {
        await remove(backup.id);
        addToast({ title: t("backups.deleted", { defaultValue: "Snapshot deleted" }), variant: "success" });
        logger.info("BackupsProfilesPage", "snapshot deleted", { id: backup.id });
      } catch (err) {
        reportError(err);
      } finally {
        setBusyId(null);
      }
    },
    [addToast, remove, reportError, t]
  );

  const handleRefresh = useCallback(() => {
    void fetchBackups();
  }, [fetchBackups]);

  return (
    <div className="flex h-full flex-col">
      <div className="relative overflow-hidden rounded-b-xl border-b border-border bg-surface-card p-4">
        <div className="relative z-10 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
              <Archive className="h-3.5 w-3.5" />
              {t("backups.scope", { defaultValue: "APPLICATION STATE // NOT NIRI CONFIG" })}
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              {t("backups.title", { defaultValue: "Backups & Profiles" })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("backups.description", {
                defaultValue: "Snapshots of the config files, restore points and what is stored on disk.",
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5 font-mono text-xs text-muted-foreground">
              <Database className="h-4 w-4 text-primary" />
              <span>
                {t("backups.count", { count: backups.length })}
              </span>
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={handleRefresh} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
              {t("backups.refresh", { defaultValue: "Refresh" })}
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setNamedOpen(true)} disabled={config === null}>
              <Archive className="h-4 w-4" />
              {t("backups.create_named", { defaultValue: "Create snapshot" })}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {storeError !== null && (
            <p className="rounded-md border border-danger/40 bg-danger/10 p-2 font-mono text-xs text-danger">
              {storeError.type}: {typeof storeError.details === "string" ? storeError.details : ""}
            </p>
          )}

          {loading && backups.length === 0 ? (
            <div className="flex items-center justify-center rounded-xl border border-border bg-surface-card py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              {t("common.loading", { defaultValue: "Loading" })}
            </div>
          ) : backups.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <Database className="h-10 w-10 text-muted-foreground" />
                <h2 className="text-lg font-medium">
                  {t("backups.empty", { defaultValue: "No snapshots yet" })}
                </h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  {t("backups.empty_hint", {
                    defaultValue:
                      "Snapshots appear here once the config has been saved with a backup, or when one is created by hand.",
                  })}
                </p>
                <Button
                  size="sm"
                  disabled={config === null}
                  onClick={() => setNamedOpen(true)}
                >
                  <Archive className="h-4 w-4" />
                  {t("backups.create_named", { defaultValue: "Create snapshot" })}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {backups.map((backup) => (
                <li key={backup.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(backup.id)}
                    className={`flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
                      selectedId === backup.id
                        ? "border-primary bg-surface-hover"
                        : "border-border bg-surface-card hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface">
                          {backup.name ? (
                            <Archive className="h-5 w-5 text-primary" />
                          ) : (
                            <Zap className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="truncate font-mono text-sm font-semibold">
                              {backup.name ?? backup.id}
                            </span>
                            <Badge variant={backup.name ? "default" : "secondary"} className="text-xs">
                              {backup.name
                                ? t("backups.named", { defaultValue: "named" })
                                : t("backups.automatic", { defaultValue: "automatic" })}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                            <span>{formatDate(backup.timestamp)}</span>
                            {backup.hash !== "" && (
                              <>
                                <span>·</span>
                                <span className="truncate">{backup.hash.slice(0, 8)}</span>
                              </>
                            )}
                            {backup["niri-version"] && (
                              <>
                                <span>·</span>
                                <span>niri {backup["niri-version"]}</span>
                              </>
                            )}
                          </div>
                          {backup.comment && (
                            <p className="mt-1 truncate rounded bg-surface px-2 py-1 text-xs text-muted-foreground">
                              {backup.comment}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          className="h-7 gap-1"
                          disabled={busyId === backup.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingRestore(backup);
                          }}
                        >
                          {busyId === backup.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          {t("backups.restore", { defaultValue: "Restore" })}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 text-danger hover:bg-danger/10 hover:text-danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDelete(backup);
                          }}
                          aria-label={t("backups.delete", { defaultValue: "Delete" })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-96">
          <Card>
            <CardHeader className="border-b border-border bg-surface px-3 py-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FolderTree className="h-4 w-4 text-primary" />
                {t("backups.inspector", { defaultValue: "Selected snapshot" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3 text-sm">
              {selected === null ? (
                <p className="text-muted-foreground">
                  {t("backups.inspector_empty", { defaultValue: "Pick a snapshot to see what it holds." })}
                </p>
              ) : (
                <>
                  <dl className="space-y-1">
                    <Row label={t("backups.name", { defaultValue: "Name" })} value={selected.name ?? selected.id} mono />
                    <Row label={t("backups.created", { defaultValue: "Created" })} value={formatDate(selected.timestamp)} />
                    <Row label={t("backups.hash", { defaultValue: "Hash" })} value={selected.hash === "" ? "—" : selected.hash} mono />
                    <Row
                      label={t("backups.niri_version", { defaultValue: "niri version" })}
                      value={selected["niri-version"] ?? "—"}
                      mono
                    />
                  </dl>
                  <Separator />
                  <div>
                    <span className="text-xs text-muted-foreground">
                      {t("backups.files", { defaultValue: "Files in this snapshot" })} ({selected.files.length})
                    </span>
                    {selected.files.length === 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("backups.files_empty", { defaultValue: "The backend reported no file list." })}
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {selected.files.map((file) => (
                          <li key={file} className="flex items-center gap-2 font-mono text-xs">
                            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{file}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {selected.comment && (
                    <>
                      <Separator />
                      <div>
                        <span className="text-xs text-muted-foreground">
                          {t("backups.note", { defaultValue: "Note" })}
                        </span>
                        <p className="text-xs">{selected.comment}</p>
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border bg-surface px-3 py-2">
              <CardTitle className="text-sm">
                {t("backups.profiles", { defaultValue: "Profiles" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              <p className="text-sm text-muted-foreground">
                {t("backups.profiles_unavailable", {
                  defaultValue:
                    "There is no profile store on the backend yet, so there is nothing to switch between. A snapshot plus a restore is the equivalent for now.",
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("backups.profiles_hint", {
                  defaultValue: "Restoring a snapshot reloads the model from disk.",
                })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border bg-surface px-3 py-2">
              <CardTitle className="text-sm">
                {t("backups.retention", { defaultValue: "Retention" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              <p className="text-sm text-muted-foreground">
                {t("backups.retention_unavailable", {
                  defaultValue:
                    "Pruning is decided by the backend when a save takes a backup; no retention limit is configurable from the app yet.",
                })}
              </p>
              <div className="flex items-center justify-between rounded-lg bg-surface p-3 text-xs text-muted-foreground">
                <span>
                  {t("backups.model_state", { defaultValue: "Loaded config" })}:{" "}
                  <span className={dirty ? "text-warning" : "text-success"}>
                    {dirty
                      ? t("backups.model_dirty", { defaultValue: "unsaved changes" })
                      : t("backups.model_clean", { defaultValue: "no unsaved changes" })}
                  </span>
                </span>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void load()}>
                  <History className="h-3.5 w-3.5" />
                  {t("backups.reload", { defaultValue: "Reload" })}
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog open={namedOpen} onOpenChange={setNamedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("backups.create_named", { defaultValue: "Create snapshot" })}</DialogTitle>
            <DialogDescription>
              {t("backups.create_named_hint", {
                defaultValue: "Freezes the config files currently on disk into a named restore point.",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="snapshot-name" className="font-mono text-xs text-muted-foreground">
                {t("backups.name", { defaultValue: "Name" })}
              </Label>
              <Input
                id="snapshot-name"
                className="h-8 font-mono"
                value={snapshotName}
                onChange={(event) => setSnapshotName(event.target.value)}
                placeholder={t("backups.name_placeholder", { defaultValue: "before switching dock" })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="snapshot-comment" className="text-xs text-muted-foreground">
                {t("backups.comment", { defaultValue: "Note" })}
              </Label>
              <Textarea
                id="snapshot-comment"
                rows={3}
                className="resize-none text-sm"
                value={snapshotComment}
                onChange={(event) => setSnapshotComment(event.target.value)}
                placeholder={t("backups.comment_placeholder", { defaultValue: "Why this snapshot was taken" })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNamedOpen(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={busyId === "new"}>
              {busyId === "new" && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("backups.create", { defaultValue: "Create" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingRestore !== null} onOpenChange={(open) => !open && setPendingRestore(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("backups.confirm_restore", { defaultValue: "Restore this snapshot?" })}</DialogTitle>
            <DialogDescription>
              {t("backups.confirm_restore_hint", {
                defaultValue:
                  "The files on disk are replaced by this snapshot and the config is reloaded. The backend validates the candidate first and leaves the current files alone if it does not pass.",
              })}
            </DialogDescription>
          </DialogHeader>
          {pendingRestore !== null && (
            <div className="space-y-2 rounded-lg bg-surface p-3 text-sm">
              <p className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("backups.restoring", { defaultValue: "Restoring" })}</span>
                <span className="truncate font-mono text-sm">{pendingRestore.name ?? pendingRestore.id}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("backups.created", { defaultValue: "Created" })}</span>
                <span className="text-sm">{formatDate(pendingRestore.timestamp)}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("backups.files", { defaultValue: "Files" })}</span>
                <span className="font-mono text-sm">{pendingRestore.files.length}</span>
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRestore(null)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              onClick={() => {
                if (pendingRestore) void handleRestore(pendingRestore);
              }}
            >
              <RotateCcw className="h-4 w-4" />
              {t("backups.restore", { defaultValue: "Restore" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("backups.confirm_delete", { defaultValue: "Delete this snapshot?" })}</DialogTitle>
            <DialogDescription>
              {t("backups.confirm_delete_hint", {
                defaultValue: "The snapshot file is removed from disk. This cannot be undone.",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void handleDelete(pendingDelete);
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("backups.delete", { defaultValue: "Delete" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-xs ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}