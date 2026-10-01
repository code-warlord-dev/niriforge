"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Globe,
  Info,
  Moon,
  Palette,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAppPolicyStore } from "@/stores/appPolicyStore";
import { useConfigStore } from "@/stores/configStore";
import { invokeCommand, toAppError } from "@/lib/ipc";
import type { AppError } from "@/types/config";
import { logger } from "@/lib/logger";
import pkg from "../../package.json";

type Locale = "ru" | "en";

/**
 * Application settings.
 *
 * Everything on this page is policy of this app, not configuration of niri: the
 * socket, the binary, the save safeguards and the language live here and are
 * kept out of `config.kdl`, which niri would reject if they were written into
 * it. Changing anything here never touches the loaded config, so it never
 * marks it dirty.
 */
export function AppSettingsPage() {
  const { t, i18n } = useTranslation();

  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);

  const niriBinary = useAppPolicyStore((s) => s.niriBinary);
  const socketPath = useAppPolicyStore((s) => s.socketPath);
  const validateBeforeSave = useAppPolicyStore((s) => s.validateBeforeSave);
  const backupBeforeSave = useAppPolicyStore((s) => s.backupBeforeSave);
  const setNiriBinary = useAppPolicyStore((s) => s.setNiriBinary);
  const setSocketPath = useAppPolicyStore((s) => s.setSocketPath);
  const setValidateBeforeSave = useAppPolicyStore((s) => s.setValidateBeforeSave);
  const setBackupBeforeSave = useAppPolicyStore((s) => s.setBackupBeforeSave);
  const resetPolicy = useAppPolicyStore((s) => s.reset);

  const configDirty = useConfigStore((s) => s.dirty);

  const [niriRunning, setNiriRunning] = useState<boolean | null>(null);
  const [niriVersion, setNiriVersion] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<AppError | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    logger.info("AppSettingsPage", "mounted");
    return () => logger.info("AppSettingsPage", "unmounted");
  }, []);

  const probe = useCallback(async () => {
    setProbing(true);
    setProbeError(null);
    try {
      const running = await invokeCommand<boolean>("check_niri_running", {});
      setNiriRunning(running);
      if (running) {
        const version = await invokeCommand<string>("niri_msg", { args: ["--version"] });
        setNiriVersion(version.trim());
      } else {
        setNiriVersion(null);
      }
    } catch (err) {
      setNiriRunning(false);
      setNiriVersion(null);
      setProbeError(toAppError(err));
      logger.error("AppSettingsPage", "niri probe failed", err);
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  useEffect(() => {
    let cancelled = false;
    invokeCommand<string>("get_config_path", {})
      .then((path) => {
        if (!cancelled) setConfigPath(path);
      })
      .catch((err) => {
        if (!cancelled) setConfigPath(null);
        logger.debug("AppSettingsPage", "config path unavailable", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changeLocale = useCallback(
    (value: string) => {
      const next = value as Locale;
      setLocale(next);
      void i18n.changeLanguage(next);
      logger.info("AppSettingsPage", "locale changed", { locale: next });
    },
    [i18n, setLocale]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-border bg-surface-card p-4">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-primary">
          <Terminal className="h-3.5 w-3.5" />
          {t("app_settings.scope", { defaultValue: "APPLICATION // NIFIFORGE OWN SETTINGS" })}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          {t("app_settings.title", { defaultValue: "App Settings" })}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("app_settings.description", {
            defaultValue: "Preferences of the NiriForge app: language, compositor integration and save safeguards.",
          })}
        </p>
        <div className="mt-1 flex items-start gap-2 rounded-lg bg-surface-hover p-3 md:max-w-md">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              {t("app_settings.isolation", { defaultValue: "Kept out of the config" })}
              <Badge variant="outline" className="font-mono text-xs">
                app
              </Badge>
            </div>
            <p className="text-xs leading-tight text-muted-foreground">
              {t("app_settings.isolation_hint", {
                defaultValue:
                  "None of these settings are niri configuration. They are stored by the app and never make config.kdl dirty.",
              })}
            </p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Card className="flex flex-col gap-4 lg:col-span-8">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Palette className="h-5 w-5 text-primary" />
                    <div>
                      <CardTitle className="text-lg">
                        {t("app_settings.appearance", { defaultValue: "Appearance" })}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {t("app_settings.appearance_hint", { defaultValue: "Interface theme of the app window." })}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">
                    v{pkg.version}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    {t("app_settings.theme", { defaultValue: "Interface theme" })}
                  </Label>
                  <div className="flex items-center gap-3 rounded-lg border border-primary bg-surface-hover p-3">
                    <div className="flex h-16 w-full max-w-40 flex-col justify-between overflow-hidden rounded bg-background p-2">
                      <div className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        <span className="ml-1 h-1.5 w-10 rounded bg-surface-card" />
                      </div>
                      <div className="flex gap-1">
                        <span className="h-6 w-1/3 rounded bg-surface-card" />
                        <span className="h-6 w-2/3 rounded bg-surface-hover" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Moon className="h-4 w-4" />
                        <span className="text-lg font-medium">
                          {t("app_settings.theme_dark", { defaultValue: "Dark" })}
                        </span>
                        <span className="font-mono text-xs text-primary">
                          {t("app_settings.theme_active", { defaultValue: "active" })}
                        </span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {t("app_settings.theme_dark_hint", {
                          defaultValue: "The only theme this build ships.",
                        })}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("app_settings.theme_pending", {
                      defaultValue:
                        "Light and system themes are not implemented yet, so they are not offered here.",
                    })}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="flex flex-col justify-between gap-4 lg:col-span-4">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-lg">
                      {t("app_settings.localization", { defaultValue: "Localization" })}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {t("app_settings.localization_hint", { defaultValue: "Language of the app interface." })}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground" htmlFor="locale-en">
                  {t("app_settings.ui_language", { defaultValue: "Interface language" })}
                </Label>
                <RadioGroup value={locale} onValueChange={changeLocale}>
                  <div
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      locale === "en" ? "border-primary bg-surface-hover" : "border-border"
                    }`}
                  >
                    <Label htmlFor="locale-en" className="flex cursor-pointer items-center gap-3">
                      <span className="rounded bg-surface px-2 py-0.5 font-mono text-xs font-bold">EN</span>
                      <span className="flex flex-col">
                        <span className="text-lg">{t("app_settings.locale_en", { defaultValue: "English" })}</span>
                        <span className="font-mono text-xs text-muted-foreground">en</span>
                      </span>
                    </Label>
                    <RadioGroupItem value="en" id="locale-en" />
                  </div>
                  <div
                    className={`mt-2 flex items-center justify-between rounded-lg border p-3 ${
                      locale === "ru" ? "border-primary bg-surface-hover" : "border-border"
                    }`}
                  >
                    <Label htmlFor="locale-ru" className="flex cursor-pointer items-center gap-3">
                      <span className="rounded bg-surface px-2 py-0.5 font-mono text-xs font-bold">RU</span>
                      <span className="flex flex-col">
                        <span className="text-lg">{t("app_settings.locale_ru", { defaultValue: "Русский" })}</span>
                        <span className="font-mono text-xs text-muted-foreground">ru</span>
                      </span>
                    </Label>
                    <RadioGroupItem value="ru" id="locale-ru" />
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="flex flex-col gap-4">
              <CardHeader>
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Waypoints className="h-5 w-5 text-primary" />
                    <div>
                      <CardTitle className="text-lg">
                        {t("app_settings.niri_integration", { defaultValue: "niri integration" })}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {t("app_settings.niri_integration_hint", {
                          defaultValue: "How the app reaches the compositor. Overrides are local to NiriForge.",
                        })}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      niriRunning === null
                        ? "text-muted-foreground"
                        : niriRunning
                          ? "text-success"
                          : "text-warning"
                    }
                  >
                    {niriRunning === null
                      ? t("app_settings.probing", { defaultValue: "checking" })
                      : niriRunning
                        ? t("app_settings.connected", { defaultValue: "connected" })
                        : t("app_settings.not_running", { defaultValue: "not running" })}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="policy-socket" className="text-xs uppercase tracking-wider text-muted-foreground">
                    {t("app_settings.socket", { defaultValue: "Event socket override" })}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="policy-socket"
                      className="h-9 font-mono"
                      value={socketPath}
                      placeholder={t("app_settings.socket_placeholder", {
                        defaultValue: "empty = use whatever niri reports",
                      })}
                      onChange={(event) => setSocketPath(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0"
                      onClick={() => void probe()}
                      disabled={probing}
                    >
                      {t("app_settings.probe", { defaultValue: "Probe" })}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="policy-binary" className="text-xs uppercase tracking-wider text-muted-foreground">
                    {t("app_settings.binary", { defaultValue: "niri binary override" })}
                  </Label>
                  <Input
                    id="policy-binary"
                    className="h-9 font-mono"
                    value={niriBinary}
                    placeholder={t("app_settings.binary_placeholder", { defaultValue: "empty = niri from PATH" })}
                    onChange={(event) => setNiriBinary(event.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg bg-surface p-3">
                  <div className="min-w-0">
                    <span className="block truncate text-sm">{niriBinary || "niri"}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{niriVersion ?? t("app_settings.version_unknown", { defaultValue: "version unknown" })}</span>
                  </div>
                  {niriRunning === false && (
                    <span className="shrink-0 font-mono text-xs text-warning">
                      {t("app_settings.offline", { defaultValue: "offline" })}
                    </span>
                  )}
                </div>

                {configPath !== null && (
                  <div className="flex items-center justify-between rounded-lg bg-surface p-3">
                    <div className="min-w-0">
                      <span className="block text-xs text-muted-foreground">
                        {t("app_settings.config_path", { defaultValue: "Config file in use" })}
                      </span>
                      <span className="block truncate font-mono text-xs">{configPath}</span>
                    </div>
                  </div>
                )}

                {probeError !== null && (
                  <p className="rounded-md border border-danger/40 bg-danger/10 p-2 font-mono text-xs text-danger">
                    {probeError.type}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="flex flex-col gap-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    <div>
                      <CardTitle className="text-lg">
                        {t("app_settings.safety", { defaultValue: "Safety and atomic saves" })}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {t("app_settings.safety_hint", {
                          defaultValue: "What happens before the app touches a file on disk.",
                        })}
                      </p>
                    </div>
                  </div>
                  <Badge variant="success" className="shrink-0">
                    {t("app_settings.guard", { defaultValue: "guard" })}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <PolicySwitch
                  id="policy-backup"
                  checked={backupBeforeSave}
                  onCheckedChange={setBackupBeforeSave}
                  title={t("app_settings.backup_before_save", { defaultValue: "Snapshot before every write" })}
                  hint={t("app_settings.backup_before_save_hint", {
                    defaultValue: "A timestamped backup is taken before files are replaced.",
                  })}
                />
                <Separator />
                <PolicySwitch
                  id="policy-validate"
                  checked={validateBeforeSave}
                  onCheckedChange={setValidateBeforeSave}
                  title={t("app_settings.validate_before_save", { defaultValue: "Validate before writing to disk" })}
                  hint={t("app_settings.validate_before_save_hint", {
                    defaultValue: "Refuses to write a config that niri cannot parse.",
                  })}
                />
                <Separator />
                <div className="flex items-start gap-2 rounded-lg bg-surface p-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("app_settings.backups_link", {
                      defaultValue:
                        "Snapshots themselves are listed, restored and pruned on the Backups page.",
                    })}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                  <span>
                    {t("app_settings.dirty_state", { defaultValue: "Loaded config" })}:{" "}
                    <span className={configDirty ? "text-warning" : "text-success"}>
                      {configDirty
                        ? t("app_settings.dirty", { defaultValue: "unsaved changes" })
                        : t("app_settings.clean", { defaultValue: "no unsaved changes" })}
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={resetPolicy}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("app_settings.reset_policy", { defaultValue: "Reset overrides" })}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t("app_settings.about", { defaultValue: "About" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-primary" />
                <span className="text-lg">NiriForge</span>
                <Badge variant="outline" className="font-mono text-xs">
                  v{pkg.version}
                </Badge>
                <Badge variant="secondary" className="font-mono text-xs">
                  Tauri 2
                </Badge>
              </p>
              <p className="leading-relaxed text-muted-foreground">
                {t("app_settings.about_text", {
                  defaultValue:
                    "A native configuration dashboard for the niri scrollable-tiling Wayland compositor.",
                })}
              </p>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}

function PolicySwitch({
  id,
  checked,
  onCheckedChange,
  title,
  hint,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface p-3">
      <Label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}