"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Eraser,
  FileCode2,
  Play,
  Plus,
  Settings2,
  Terminal,
  Trash2,
  Variable,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RuleEmptyState } from "@/components/rules/RuleEmptyState";
import { kdlString } from "@/components/rules/kdl";
import { useConfigStore } from "@/stores/configStore";
import { useAppPolicyStore } from "@/stores/appPolicyStore";
import type { CursorConfig, SpawnEntry } from "@/types/generated/contract";
import { logger } from "@/lib/logger";

/**
 * Startup & Environment.
 *
 * Two different things share this page, and they are kept apart on purpose.
 *
 * The niri half — `spawn-at-startup`, `spawn-sh-at-startup`, `environment`,
 * `cursor`, `screenshot-path`, `prefer-no-csd` — is config and goes through the
 * config draft like everywhere else. The app half — which binary to call, which
 * socket to use, whether a save validates — is policy this application decides
 * for itself and stores outside the config, because niri has no node for it.
 *
 * Editing an entry never runs it. Nothing here spawns a process; a command takes
 * effect when niri next loads the file.
 */
export function StartupPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const [newCommand, setNewCommand] = useState("");
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [useShell, setUseShell] = useState(false);
  const [unsetKeys, setUnsetKeys] = useState<string[]>([]);

  useEffect(() => {
    logger.info("StartupPage", "mounted");
    return () => logger.info("StartupPage", "unmounted");
  }, []);

  const spawnAtStartup = useMemo(() => config?.["spawn-at-startup"] ?? [], [config]);
  const spawnShAtStartup = useMemo(() => config?.["spawn-sh-at-startup"] ?? [], [config]);
  const environment = useMemo(() => config?.environment ?? {}, [config]);
  const cursor = config?.cursor ?? null;
  const screenshotPath = config?.["screenshot-path"] ?? null;
  const preferNoCsd = config?.["prefer-no-csd"] ?? false;

  const patchConfig = useCallback((patch: (draft: NonNullable<typeof config>) => void) => {
    const store = useConfigStore.getState();
    store.update(patch);
    store.markDirty();
  }, []);

  const addSpawnEntry = useCallback(() => {
    const command = newCommand.trim();
    if (command === "") return;
    patchConfig((draft) => {
      if (useShell) {
        draft["spawn-sh-at-startup"].push(command);
      } else {
        const entry: SpawnEntry = { command };
        draft["spawn-at-startup"].push(entry);
      }
    });
    setNewCommand("");
    setUseShell(false);
    logger.info("StartupPage", "startup entry added", { shell: useShell });
  }, [newCommand, useShell, patchConfig]);

  const removeSpawnEntry = useCallback(
    (index: number) => {
      patchConfig((draft) => {
        draft["spawn-at-startup"].splice(index, 1);
      });
      logger.info("StartupPage", "spawn-at-startup entry removed", { index });
    },
    [patchConfig]
  );

  const removeShellEntry = useCallback(
    (index: number) => {
      patchConfig((draft) => {
        draft["spawn-sh-at-startup"].splice(index, 1);
      });
      logger.info("StartupPage", "spawn-sh-at-startup entry removed", { index });
    },
    [patchConfig]
  );

  const moveSpawnEntry = useCallback(
    (from: number, to: number) => {
      patchConfig((draft) => {
        const list = draft["spawn-at-startup"];
        if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved);
      });
      logger.debug("StartupPage", "spawn-at-startup reordered", { from, to });
    },
    [patchConfig]
  );

  const moveShellEntry = useCallback(
    (from: number, to: number) => {
      patchConfig((draft) => {
        const list = draft["spawn-sh-at-startup"];
        if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved);
      });
      logger.debug("StartupPage", "spawn-sh-at-startup reordered", { from, to });
    },
    [patchConfig]
  );

  const setEnvEntry = useCallback(
    (key: string, value: string | null) => {
      patchConfig((draft) => {
        if (value === null) {
          delete draft.environment[key];
        } else {
          draft.environment[key] = value;
        }
      });
    },
    [patchConfig]
  );

  const addEnvEntry = useCallback(() => {
    const key = newEnvKey.trim();
    if (key === "") return;
    setEnvEntry(key, newEnvValue);
    setNewEnvKey("");
    setNewEnvValue("");
  }, [newEnvKey, newEnvValue, setEnvEntry]);

  const envRows = useMemo(() => {
    const keys = new Set([...Object.keys(environment), ...unsetKeys]);
    return Array.from(keys).sort();
  }, [environment, unsetKeys]);

  const kdlLines = useMemo(
    () =>
      config
        ? startupToKdl({
            preferNoCsd,
            screenshotPath,
            cursor,
            envRows,
            environment,
            spawnAtStartup,
            spawnShAtStartup,
          })
        : [],
    [config, preferNoCsd, screenshotPath, cursor, envRows, environment, spawnAtStartup, spawnShAtStartup]
  );

  if (!config) {
    return (
      <div className="flex h-full flex-col">
        <RuleEmptyState icon={Terminal} title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  const hasStartupConfig =
    spawnAtStartup.length > 0 ||
    spawnShAtStartup.length > 0 ||
    envRows.length > 0 ||
    cursor !== null ||
    screenshotPath !== null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Terminal className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("sidebar.startup")}</h1>
          <span className="font-mono text-xs text-muted-foreground">
            spawn-at-startup · environment
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            {spawnAtStartup.length} spawn
          </Badge>
          <Badge variant="outline" className="font-mono text-xs">
            {spawnShAtStartup.length} shell
          </Badge>
          <Badge variant="outline" className="font-mono text-xs">
            {envRows.length} env
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
            <h2 className="text-lg font-semibold">
              {t("startup.processes", { defaultValue: "Startup processes" })}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("startup.processes_hint", {
                defaultValue:
                  "Order matters: niri runs these in sequence at startup. Editing a line here never launches it.",
              })}
            </p>

            {spawnAtStartup.length === 0 && spawnShAtStartup.length === 0 ? (
              <p className="rounded-md border border-border-subtle bg-muted p-3 text-sm text-muted-foreground">
                {t("startup.no_processes", {
                  defaultValue: "This config spawns nothing at startup.",
                })}
              </p>
            ) : null}

            {spawnAtStartup.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-mono text-xs text-muted-foreground">spawn-at-startup</p>
                {spawnAtStartup.map((entry, index) => (
                  <div
                    key={`${entry.command}-${index}`}
                    className="flex items-center gap-2 rounded-md border border-border-subtle bg-muted p-2"
                  >
                    <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                      {entry.command}
                      {entry.args && entry.args.length > 0 ? ` ${entry.args.join(" ")}` : ""}
                    </span>
                    {entry.env && Object.keys(entry.env).length > 0 && (
                      <Badge variant="outline" className="font-mono text-xs">
                        env ×{Object.keys(entry.env).length}
                      </Badge>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      disabled={index === 0}
                      onClick={() => moveSpawnEntry(index, index - 1)}
                      aria-label={t("startup.move_up", { defaultValue: "Move up" })}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      disabled={index === spawnAtStartup.length - 1}
                      onClick={() => moveSpawnEntry(index, index + 1)}
                      aria-label={t("startup.move_down", { defaultValue: "Move down" })}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-danger hover:bg-danger/10 hover:text-danger"
                      onClick={() => removeSpawnEntry(index)}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {spawnShAtStartup.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-mono text-xs text-primary">spawn-sh-at-startup</p>
                {spawnShAtStartup.map((line, index) => (
                  <div
                    key={`${line}-${index}`}
                    className="flex items-center gap-2 rounded-md border border-border-subtle bg-muted p-2"
                  >
                    <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{line}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      disabled={index === 0}
                      onClick={() => moveShellEntry(index, index - 1)}
                      aria-label={t("startup.move_up", { defaultValue: "Move up" })}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      disabled={index === spawnShAtStartup.length - 1}
                      onClick={() => moveShellEntry(index, index + 1)}
                      aria-label={t("startup.move_down", { defaultValue: "Move down" })}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-danger hover:bg-danger/10 hover:text-danger"
                      onClick={() => removeShellEntry(index)}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 rounded-md border border-border-subtle p-3">
              <Label htmlFor="startup-command" className="text-sm">
                {t("startup.add_command", { defaultValue: "Add command" })}
              </Label>
              <Input
                id="startup-command"
                className="h-8 font-mono"
                placeholder={useShell ? "gammastep -O 4500" : "waybar"}
                value={newCommand}
                onChange={(event) => setNewCommand(event.target.value)}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch id="startup-shell" checked={useShell} onCheckedChange={setUseShell} />
                  <Label htmlFor="startup-shell" className="font-mono text-xs text-muted-foreground">
                    spawn-sh-at-startup
                  </Label>
                </div>
                <Button size="sm" disabled={newCommand.trim() === ""} onClick={addSpawnEntry}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t("common.add")}
                </Button>
              </div>
              {useShell && (
                <p className="text-xs text-warning">
                  {t("startup.shell_hint", {
                    defaultValue:
                      "A shell line is handed to sh -c, so quoting and redirection are interpreted by the shell.",
                  })}
                </p>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
            <div className="flex items-center gap-2">
              <Variable className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">
                {t("startup.environment", { defaultValue: "Environment" })}
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("startup.environment_hint", {
                defaultValue:
                  "Keys with no value are written as null, which unsets the variable for spawned processes.",
              })}
            </p>

            {envRows.length === 0 ? (
              <p className="rounded-md border border-border-subtle bg-muted p-3 text-sm text-muted-foreground">
                {t("startup.no_env", { defaultValue: "This config exports nothing." })}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-xs text-muted-foreground">
                      <th className="py-1.5 pr-3 font-normal">key</th>
                      <th className="py-1.5 pr-3 font-normal">value</th>
                      <th className="py-1.5 font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {envRows.map((key) => {
                      const value = environment[key];
                      return (
                        <tr key={key} className="border-b border-border-subtle/60">
                          <td className="py-1.5 pr-3 font-mono text-xs text-foreground">{key}</td>
                          <td className="py-1.5 pr-3">
                            <Input
                              className="h-7 font-mono text-xs"
                              aria-label={`${key} value`}
                              placeholder="null"
                              value={value ?? ""}
                              onChange={(event) => setEnvEntry(key, event.target.value)}
                            />
                          </td>
                          <td className="py-1.5 text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-muted-foreground hover:text-danger"
                              onClick={() => {
                                setEnvEntry(key, null);
                                if (value === undefined) {
                                  setUnsetKeys((keys) => keys.filter((entry) => entry !== key));
                                }
                              }}
                              aria-label={t("startup.remove_var", { defaultValue: "Remove variable" })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Input
                className="h-8 font-mono"
                placeholder="KEY"
                aria-label={t("startup.new_key", { defaultValue: "New variable name" })}
                value={newEnvKey}
                onChange={(event) => setNewEnvKey(event.target.value)}
              />
              <Input
                className="h-8 font-mono"
                placeholder="value"
                aria-label={t("startup.new_value", { defaultValue: "New variable value" })}
                value={newEnvValue}
                onChange={(event) => setNewEnvValue(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="col-span-2"
                disabled={newEnvKey.trim() === ""}
                onClick={addEnvEntry}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t("startup.add_var", { defaultValue: "Add variable" })}
              </Button>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
            <h2 className="text-lg font-semibold">
              {t("startup.runtime_flags", { defaultValue: "Compositor flags" })}
            </h2>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-muted p-2.5">
              <div className="min-w-0">
                <span className="font-mono text-sm">prefer-no-csd</span>
                <p className="text-xs text-muted-foreground">
                  {t("startup.prefer_no_csd_hint", {
                    defaultValue: "Ask clients for server-side decorations.",
                  })}
                </p>
              </div>
              <Switch
                checked={preferNoCsd}
                onCheckedChange={(checked) => patchConfig((draft) => { draft["prefer-no-csd"] = checked; })}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="screenshot-path" className="font-mono text-xs text-muted-foreground">
                screenshot-path
              </Label>
              <Input
                id="screenshot-path"
                className="h-8 font-mono"
                placeholder={t("startup.screenshot_placeholder", { defaultValue: "niri default" })}
                value={screenshotPath ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  patchConfig((draft) => {
                    draft["screenshot-path"] = raw === "" ? null : raw;
                  });
                }}
              />
            </div>

            <fieldset className="space-y-3 rounded-md border border-border-subtle p-3">
              <legend className="px-1 font-mono text-xs text-muted-foreground">cursor</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="cursor-theme" className="font-mono text-xs text-muted-foreground">
                    theme
                  </Label>
                  <Input
                    id="cursor-theme"
                    className="h-8 font-mono"
                    placeholder="niri default"
                    value={cursor?.theme ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      patchConfig((draft) => {
                        draft.cursor = { ...(draft.cursor ?? {}), theme: raw === "" ? null : raw };
                      });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cursor-size" className="font-mono text-xs text-muted-foreground">
                    size
                  </Label>
                  <Input
                    id="cursor-size"
                    type="number"
                    min={1}
                    className="h-8 font-mono"
                    placeholder="niri default"
                    value={cursor?.size ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      patchConfig((draft) => {
                        const existing = draft.cursor ?? {};
                        if (raw === "") {
                          const rest: CursorConfig = { ...existing };
                          delete rest.size;
                          draft.cursor = Object.keys(rest).length > 0 ? rest : null;
                        } else {
                          const value = Number(raw);
                          draft.cursor = { ...existing, size: Number.isFinite(value) ? value : 1 };
                        }
                      });
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="cursor-hide-typing" className="font-mono text-xs text-muted-foreground">
                  hide-when-typing
                </Label>
                <Switch
                  id="cursor-hide-typing"
                  checked={cursor?.["hide-when-typing"] ?? false}
                  onCheckedChange={(checked) =>
                    patchConfig((draft) => {
                      draft.cursor = { ...(draft.cursor ?? {}), "hide-when-typing": checked };
                    })
                  }
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="cursor-hide-after" className="font-mono text-xs text-muted-foreground">
                  hide-after-inactive-ms
                </Label>
                <Input
                  id="cursor-hide-after"
                  type="number"
                  min={0}
                  className="h-8 font-mono"
                  placeholder="niri default"
                  value={cursor?.["hide-after-inactive-ms"] ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value;
                    patchConfig((draft) => {
                      const existing = draft.cursor ?? {};
                      if (raw === "") {
                        const rest: CursorConfig = { ...existing };
                        delete rest["hide-after-inactive-ms"];
                        draft.cursor = Object.keys(rest).length > 0 ? rest : null;
                      } else {
                        const value = Number(raw);
                        draft.cursor = {
                          ...existing,
                          "hide-after-inactive-ms": Number.isFinite(value) ? value : 0,
                        };
                      }
                    });
                  }}
                />
              </div>
            </fieldset>
          </section>

          <AppPolicyPanel />
        </div>

        {!hasStartupConfig ? (
          <RuleEmptyState
            icon={Play}
            title={t("startup.empty_title", { defaultValue: "No startup configuration" })}
            description={t("startup.empty_description", {
              defaultValue:
                "Nothing here is set, so niri starts with its own defaults: no spawned processes and no exported variables. Adding a command above writes a spawn-at-startup line.",
            })}
          />
        ) : null}

        <StartupKdlPreview lines={kdlLines} title={t("startup.kdl_title", { defaultValue: "Generated KDL" })} />
      </div>
    </div>
  );
}

/**
 * Policy this application applies to itself.
 *
 * Deliberately not part of the config preview above: niri would reject these
 * nodes, and the header says which store owns them.
 */
function AppPolicyPanel() {
  const { t } = useTranslation();
  const niriBinary = useAppPolicyStore((s) => s.niriBinary);
  const socketPath = useAppPolicyStore((s) => s.socketPath);
  const validateBeforeSave = useAppPolicyStore((s) => s.validateBeforeSave);
  const backupBeforeSave = useAppPolicyStore((s) => s.backupBeforeSave);
  const setNiriBinary = useAppPolicyStore((s) => s.setNiriBinary);
  const setSocketPath = useAppPolicyStore((s) => s.setSocketPath);
  const setValidateBeforeSave = useAppPolicyStore((s) => s.setValidateBeforeSave);
  const setBackupBeforeSave = useAppPolicyStore((s) => s.setBackupBeforeSave);
  const reset = useAppPolicyStore((s) => s.reset);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">
          {t("startup.app_policy", { defaultValue: "NiriForge policy" })}
        </h2>
        <Badge variant="outline" className="font-mono text-xs">
          not config
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("startup.app_policy_hint", {
          defaultValue:
            "How this app reaches niri and how it touches the file. niri has no node for any of it, so it is stored by NiriForge and never written to config.kdl.",
        })}
      </p>

      <div className="space-y-1">
        <Label htmlFor="policy-binary" className="font-mono text-xs text-muted-foreground">
          niri binary
        </Label>
        <Input
          id="policy-binary"
          className="h-8 font-mono"
          placeholder="niri"
          value={niriBinary}
          onChange={(event) => setNiriBinary(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="policy-socket" className="font-mono text-xs text-muted-foreground">
          socket path
        </Label>
        <Input
          id="policy-socket"
          className="h-8 font-mono"
          placeholder="runtime socket"
          value={socketPath}
          onChange={(event) => setSocketPath(event.target.value)}
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-muted p-2.5">
        <Label htmlFor="policy-validate" className="font-mono text-xs text-muted-foreground">
          validate before save
        </Label>
        <Switch id="policy-validate" checked={validateBeforeSave} onCheckedChange={setValidateBeforeSave} />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-muted p-2.5">
        <Label htmlFor="policy-backup" className="font-mono text-xs text-muted-foreground">
          backup before save
        </Label>
        <Switch id="policy-backup" checked={backupBeforeSave} onCheckedChange={setBackupBeforeSave} />
      </div>

      <Button size="sm" variant="ghost" className="self-start font-mono text-xs" onClick={reset}>
        <Eraser className="mr-1 h-3.5 w-3.5" />
        {t("startup.policy_reset", { defaultValue: "reset policy" })}
      </Button>
    </section>
  );
}

interface StartupKdlInput {
  preferNoCsd: boolean;
  screenshotPath: string | null;
  cursor: CursorConfig | null;
  envRows: string[];
  environment: Record<string, string | null>;
  spawnAtStartup: SpawnEntry[];
  spawnShAtStartup: string[];
}

/** KDL for the startup nodes, in the order niri documents them. */
function startupToKdl(input: StartupKdlInput): string[] {
  const lines: string[] = [];

  if (input.preferNoCsd) lines.push("prefer-no-csd");
  if (input.screenshotPath) lines.push(`screenshot-path ${kdlString(input.screenshotPath)}`);

  if (input.cursor && Object.keys(input.cursor).length > 0) {
    lines.push("cursor {");
    if (input.cursor.theme) lines.push(`    theme ${kdlString(input.cursor.theme)}`);
    if (input.cursor.size != null) lines.push(`    size ${input.cursor.size}`);
    if (input.cursor["hide-when-typing"] != null) {
      lines.push(`    hide-when-typing ${input.cursor["hide-when-typing"]}`);
    }
    if (input.cursor["hide-after-inactive-ms"] != null) {
      lines.push(`    hide-after-inactive-ms ${input.cursor["hide-after-inactive-ms"]}`);
    }
    lines.push("}");
  }

  const envLines: string[] = [];
  for (const key of input.envRows) {
    const value = input.environment[key];
    envLines.push(`    ${key} ${value === null || value === undefined ? "null" : kdlString(value)}`);
  }
  if (envLines.length > 0) {
    lines.push("environment {");
    lines.push(...envLines);
    lines.push("}");
  }

  for (const entry of input.spawnAtStartup) {
    const args = entry.args && entry.args.length > 0 ? ` ${entry.args.join(" ")}` : "";
    lines.push(`spawn-at-startup ${kdlString(entry.command)}${args}`);
    if (entry.env && Object.keys(entry.env).length > 0) {
      lines.push("    env {");
      for (const [key, value] of Object.entries(entry.env)) {
        lines.push(`        ${key} ${kdlString(value)}`);
      }
      lines.push("    }");
    }
  }

  for (const line of input.spawnShAtStartup) {
    lines.push(`spawn-sh-at-startup ${kdlString(line)}`);
  }

  return lines;
}

interface StartupKdlPreviewProps {
  lines: string[];
  title: string;
}

/**
 * KDL for the whole startup section, which is a handful of top-level nodes
 * rather than one node with children, so there is no node name to wrap it in.
 */
function StartupKdlPreview({ lines, title }: StartupKdlPreviewProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = lines.join("\n");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      logger.warn("StartupPage", "clipboard write failed", err);
    }
  }, [text]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleCopy}
          title={t("common.copy", { defaultValue: "Copy" })}
          aria-label={t("common.copy", { defaultValue: "Copy" })}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {lines.length === 0 ? (
        <p className="rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
          {t("startup.kdl_empty", {
            defaultValue: "Nothing to write: niri keeps its own defaults for every startup node.",
          })}
        </p>
      ) : (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
          <code>{text}</code>
        </pre>
      )}
    </div>
  );
}