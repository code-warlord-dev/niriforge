"use client";

import { useTranslation } from "react-i18next";
import { Cpu, WifiOff, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { invokeCommand } from "@/lib/ipc";
import { useCallback, useEffect, useState } from "react";
import { logger } from "@/lib/logger";

interface IPCColumnProps {
  niriRunning: boolean | null;
  setNiriRunning: (running: boolean) => void;
  niriVersion: string | null;
  setNiriVersion: (version: string | null) => void;
  socketPath: string | null;
  setSocketPath: (path: string | null) => void;
}

export function IPCColumn({
  niriRunning,
  setNiriRunning,
  niriVersion,
  setNiriVersion,
  socketPath,
  setSocketPath,
}: IPCColumnProps) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);

  const checkIPC = useCallback(async () => {
    setChecking(true);
    logger.debug("IPCColumn", "checking IPC status");
    try {
      const running = await invokeCommand<boolean>("check_niri_running", {});
      setNiriRunning(running);

      if (running) {
        try {
          const versionResult = await invokeCommand<string>("niri_msg", { args: ["--version"] });
          setNiriVersion(versionResult.trim());
        } catch {
          setNiriVersion(t("overview.ipc.version_unknown"));
        }

        try {
          const socketResult = await invokeCommand<string>("niri_msg", { args: ["socket"] });
          setSocketPath(socketResult.trim() || t("overview.ipc.socket_unavailable"));
        } catch {
          setSocketPath(t("overview.ipc.socket_unavailable"));
        }
      } else {
        setNiriVersion(null);
        setSocketPath(null);
      }
      logger.info("IPCColumn", "IPC check complete", { running, niriVersion, socketPath });
    } catch (err) {
      logger.error("IPCColumn", "IPC check failed", err);
      setNiriRunning(false);
      setNiriVersion(null);
      setSocketPath(null);
    } finally {
      setChecking(false);
    }
  }, [setNiriRunning, setNiriVersion, setSocketPath, t, niriVersion, socketPath]);

  useEffect(() => {
    checkIPC();
  }, [checkIPC]);

  const statusBadge = checking
    ? (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("overview.ipc.checking")}
      </Badge>
    )
    : niriRunning === true
    ? (
      <Badge variant="default" className="gap-1">
        <CheckCircle className="h-3 w-3 text-green-500" />
        {t("overview.ipc.running")}
      </Badge>
    )
    : niriRunning === false
    ? (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {t("overview.ipc.not_running")}
      </Badge>
    )
    : (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("overview.ipc.checking")}
      </Badge>
    );

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            {t("overview.ipc.title")}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={checkIPC} disabled={checking} aria-label={t("overview.ipc.refresh")}>
            <Loader2 className={cn("h-4 w-4", checking && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 p-4 pt-0">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {t("overview.ipc.status")}
            </p>
            <div className="flex items-center gap-2">{statusBadge}</div>
          </div>

          <Separator />

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {t("overview.ipc.version")}
            </p>
            <p className="font-mono text-sm">{niriVersion ?? (niriRunning === false ? t("overview.ipc.n_a") : t("overview.ipc.checking"))}</p>
          </div>

          <Separator />

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {t("overview.ipc.socket")}
            </p>
            <p className="font-mono text-sm truncate" title={socketPath ?? ""}>
              {socketPath ?? (niriRunning === false ? t("overview.ipc.n_a") : t("overview.ipc.checking"))}
            </p>
          </div>

          {niriRunning === false && (
            <>
              <Separator />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <WifiOff className="h-4 w-4" />
                <span>{t("overview.ipc.niri_not_running_hint")}</span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}