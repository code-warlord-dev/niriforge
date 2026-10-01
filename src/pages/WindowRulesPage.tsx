"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Code2, Filter, ListOrdered, Pencil, Plus, Regex, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { KdlPreviewPanel } from "@/components/rules/KdlPreviewPanel";
import { RuleEmptyState } from "@/components/rules/RuleEmptyState";
import { RuleInspectorPanel } from "@/components/rules/RuleInspectorPanel";
import { RuleListPanel } from "@/components/rules/RuleListPanel";
import {
  compilePattern,
  hasMatchCriteria,
  isRegexPattern,
  kdlString,
  matchRulesToKdl,
  summarizeMatch,
} from "@/components/rules/kdl";
import { useConfigStore } from "@/stores/configStore";
import type { WindowRule } from "@/types/generated/contract";
import { logger } from "@/lib/logger";

/** Values niri accepts for `block-out-from`; anything else is a config error. */
const BLOCK_OUT_VALUES = ["screencast", "screen-capture"];
const NO_SELECTION = "__none__";

const SIZE_PROPERTIES = [
  { key: "default-width", hint: "px" },
  { key: "default-height", hint: "px" },
  { key: "min-width", hint: "px" },
  { key: "min-height", hint: "px" },
  { key: "max-width", hint: "px" },
  { key: "max-height", hint: "px" },
] as const;

const STATE_FLAGS = [
  { key: "open-floating", hint: "detached from the tiling grid" },
  { key: "open-tiled", hint: "placed in the grid" },
  { key: "open-maximized", hint: "fills the usable area" },
  { key: "open-fullscreen", hint: "covers the output" },
  { key: "open-centered", hint: "centred in the viewport" },
] as const;

const RENDER_FLAGS = [
  { key: "border", hint: "override the global border" },
  { key: "focus-ring", hint: "override the global ring" },
  { key: "shadow", hint: "override the global shadow" },
  { key: "clip-to-geometry", hint: "clip the surface to its geometry" },
] as const;

type SizeKey = (typeof SIZE_PROPERTIES)[number]["key"];
type StateFlagKey = (typeof STATE_FLAGS)[number]["key"];
type RenderFlagKey = (typeof RENDER_FLAGS)[number]["key"];

type Translate = (key: string, options?: Record<string, unknown>) => string;

function windowRuleToKdl(rule: WindowRule): string[] {
  const lines: string[] = [...matchRulesToKdl(rule["match-rules"])];
  if (rule.exclude) {
    for (const line of matchRulesToKdl(rule.exclude)) {
      lines.push(line.replace(/^match /, "exclude "));
    }
  }
  for (const { key } of STATE_FLAGS) {
    const value = rule[key];
    if (value != null) lines.push(`${key} ${value}`);
  }
  for (const { key } of RENDER_FLAGS) {
    const value = rule[key];
    if (value != null) lines.push(`${key} ${value}`);
  }
  for (const { key } of SIZE_PROPERTIES) {
    const value = rule[key];
    if (value != null) lines.push(`${key} ${value}`);
  }
  if (rule["geometry-corner-radius"] != null) {
    lines.push(`geometry-corner-radius ${rule["geometry-corner-radius"]}`);
  }
  if (rule.opacity != null) lines.push(`opacity ${rule.opacity}`);
  if (rule["block-out-from"] != null) {
    lines.push(`block-out-from ${kdlString(rule["block-out-from"])}`);
  }
  return lines;
}

function summariseActions(rule: WindowRule, t: Translate): string {
  const parts: string[] = [];
  for (const { key } of STATE_FLAGS) {
    if (rule[key] === true) parts.push(key);
  }
  if (rule.opacity != null) parts.push(`opacity ${rule.opacity}`);
  if (rule["default-width"] != null) parts.push(`default-width ${rule["default-width"]}`);
  if (rule["block-out-from"]) parts.push(`block-out-from ${rule["block-out-from"]}`);
  if (parts.length === 0) {
    return t("window_rules.no_actions", { defaultValue: "no properties set" });
  }
  return parts.join(" · ");
}

/**
 * Window Rules.
 *
 * `config["window-rules"]` is a cascade niri walks from the top, so the order
 * is part of the rule: reordering writes to the config and takes part in undo
 * like any other mutation. Layer-shell rules are a different model and live on
 * their own page.
 */
export function WindowRulesPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const rules = config?.["window-rules"] ?? [];

  useEffect(() => {
    logger.info("WindowRulesPage", "mounted");
    return () => logger.info("WindowRulesPage", "unmounted");
  }, []);

  // A removal can leave the selection past the end of the list.
  useEffect(() => {
    if (selectedIndex !== null && selectedIndex > rules.length - 1) {
      setSelectedIndex(rules.length > 0 ? rules.length - 1 : null);
    }
  }, [rules.length, selectedIndex]);

  const activeIndex = selectedIndex ?? (rules.length > 0 ? 0 : null);
  const activeRule = activeIndex !== null ? rules[activeIndex] ?? null : null;

  const patchRule = useCallback((index: number, patch: (rule: WindowRule) => void) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      const rule = draft["window-rules"][index];
      if (rule) patch(rule);
    });
    store.markDirty();
  }, []);

  const patchSelected = useCallback(
    (patch: (rule: WindowRule) => void) => {
      if (activeIndex === null) return;
      patchRule(activeIndex, patch);
    },
    [activeIndex, patchRule]
  );

  const reorder = useCallback((from: number, to: number) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      const list = draft["window-rules"];
      if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
    });
    store.markDirty();
    logger.debug("WindowRulesPage", "rule reordered", { from, to });
    setSelectedIndex(to);
  }, []);

  const removeRule = useCallback((index: number) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      draft["window-rules"].splice(index, 1);
    });
    store.markDirty();
    logger.debug("WindowRulesPage", "rule removed", { index });
    setSelectedIndex(null);
  }, []);

  const addRule = useCallback(() => {
    const store = useConfigStore.getState();
    const index = store.config?.["window-rules"].length ?? 0;
    store.update((draft) => {
      draft["window-rules"].push({ "match-rules": {} });
    });
    store.markDirty();
    setSelectedIndex(index);
  }, []);

  const duplicateRule = useCallback((index: number) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      const source = draft["window-rules"][index];
      if (!source) return;
      // Immer drafts are proxies, so the copy has to come off a plain value.
      draft["window-rules"].splice(index + 1, 0, JSON.parse(JSON.stringify(source)) as WindowRule);
    });
    store.markDirty();
    setSelectedIndex(index + 1);
  }, []);

  if (!config) {
    return (
      <div className="flex h-full flex-col">
        <RuleEmptyState icon={ListOrdered} title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ListOrdered className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("sidebar.window-rules")}</h1>
          <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-mono text-xs text-warning">
            {t("window_rules.cascade_badge", { defaultValue: "first match wins" })}
          </span>
          <span className="font-mono text-xs text-muted-foreground">config["window-rules"]</span>
        </div>
        <Button size="sm" onClick={addRule}>
          <Plus className="mr-2 h-4 w-4" />
          {t("window_rules.add", { defaultValue: "Add window rule" })}
        </Button>
      </div>

      {rules.length === 0 ? (
        <RuleEmptyState
          icon={Filter}
          title={t("window_rules.empty_title", { defaultValue: "No window rules" })}
          description={t("window_rules.empty_description", {
            defaultValue:
              "This config has no window-rule blocks, so niri treats every window with its global defaults. Add a rule to send specific apps floating, maximized, or hidden from screen capture.",
          })}
          actionLabel={t("window_rules.add", { defaultValue: "Add window rule" })}
          onAction={addRule}
        />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-full min-w-0 flex-col gap-3 overflow-auto border-r border-border p-4 lg:w-2/5">
            <RuleListPanel<WindowRule>
              rules={rules}
              selectedIndex={activeIndex ?? -1}
              onSelect={setSelectedIndex}
              onReorder={reorder}
              onRemove={removeRule}
              onAdd={addRule}
              dragGroup="application/x-niriforge-window-rule"
              title={t("window_rules.pipeline", { defaultValue: "Evaluation pipeline" })}
              countLabel={`(${rules.length})`}
              orderNote={t("window_rules.order_note", { defaultValue: "drag a row or use the arrows" })}
              addLabel={t("window_rules.add", { defaultValue: "Add window rule" })}
              dragLabel={t("window_rules.drag", { defaultValue: "Drag to reorder" })}
              moveUpLabel={t("window_rules.move_up", { defaultValue: "Move up" })}
              moveDownLabel={t("window_rules.move_down", { defaultValue: "Move down" })}
              removeLabel={t("common.delete")}
              renderPrimary={(rule) => {
                const match = rule["match-rules"];
                const patternKey = match["app-id"] != null ? "app-id" : match.title != null ? "title" : null;
                const patternValue = patternKey === "app-id" ? (match["app-id"] ?? "") : (match.title ?? "");
                const isRegex = patternKey !== null && isRegexPattern(patternKey, patternValue);
                const incomplete = !hasMatchCriteria(match);
                return (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="max-w-full truncate rounded-sm bg-surface-hover px-1.5 py-0.5 font-mono text-xs text-foreground">
                        {summarizeMatch(match)}
                      </span>
                      {isRegex && (
                        <span className="inline-flex items-center gap-1 rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">
                          <Regex className="h-3 w-3" />
                          regex
                        </span>
                      )}
                      {incomplete && (
                        <span className="rounded-sm border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-xs text-warning">
                          {t("window_rules.matches_everything", { defaultValue: "matches every window" })}
                        </span>
                      )}
                      {rule.exclude && (
                        <span className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-xs text-warning">
                          exclude
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{summariseActions(rule, t)}</p>
                  </div>
                );
              }}
              renderActions={(_rule, index) => (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => duplicateRule(index)}
                  aria-label={t("window_rules.duplicate", { defaultValue: "Duplicate rule" })}
                  title={t("window_rules.duplicate", { defaultValue: "Duplicate rule" })}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              )}
            />

            {activeRule && (
              <KdlPreviewPanel
                nodeName="window-rule"
                lines={windowRuleToKdl(activeRule)}
                title={t("window_rules.kdl_title", { defaultValue: "Generated KDL" })}
                icon={<Code2 className="h-4 w-4 text-primary" />}
              />
            )}
          </div>

          <div className="hidden w-3/5 min-w-0 flex-col p-4 lg:flex">
            {activeRule && activeIndex !== null ? (
              <RuleInspectorPanel
                title={`${t("window_rules.inspector", { defaultValue: "Rule inspector" })} #${activeIndex + 1}`}
                subtitle={summarizeMatch(activeRule["match-rules"])}
                icon={<Pencil className="h-4 w-4 text-primary" />}
                actions={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => removeRule(activeIndex)}
                    aria-label={t("common.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                }
              >
                <div className="space-y-4">
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("window_rules.matcher", { defaultValue: "Match criteria" })}
                    </h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      <PatternField
                        id="wr-app-id"
                        label="app-id"
                        value={activeRule["match-rules"]["app-id"] ?? ""}
                        onChange={(value) =>
                          patchSelected((rule) => {
                            rule["match-rules"]["app-id"] = value === "" ? null : value;
                          })
                        }
                      />
                      <PatternField
                        id="wr-title"
                        label="title"
                        value={activeRule["match-rules"].title ?? ""}
                        onChange={(value) =>
                          patchSelected((rule) => {
                            rule["match-rules"].title = value === "" ? null : value;
                          })
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                      <MatchFlag
                        id="wr-is-active"
                        label="is-active"
                        value={activeRule["match-rules"]["is-active"]}
                        onChange={(checked) =>
                          patchSelected((rule) => {
                            rule["match-rules"]["is-active"] = checked;
                          })
                        }
                      />
                      <MatchFlag
                        id="wr-is-focused"
                        label="is-focused"
                        value={activeRule["match-rules"]["is-focused"]}
                        onChange={(checked) =>
                          patchSelected((rule) => {
                            rule["match-rules"]["is-focused"] = checked;
                          })
                        }
                      />
                      <MatchFlag
                        id="wr-is-floating"
                        label="is-floating"
                        value={activeRule["match-rules"]["is-floating"]}
                        onChange={(checked) =>
                          patchSelected((rule) => {
                            rule["match-rules"]["is-floating"] = checked;
                          })
                        }
                      />
                      <MatchFlag
                        id="wr-is-maximized"
                        label="is-maximized"
                        value={activeRule["match-rules"]["is-maximized"]}
                        onChange={(checked) =>
                          patchSelected((rule) => {
                            rule["match-rules"]["is-maximized"] = checked;
                          })
                        }
                      />
                      <MatchFlag
                        id="wr-is-fullscreen"
                        label="is-fullscreen"
                        value={activeRule["match-rules"]["is-fullscreen"]}
                        onChange={(checked) =>
                          patchSelected((rule) => {
                            rule["match-rules"]["is-fullscreen"] = checked;
                          })
                        }
                      />
                      <MatchFlag
                        id="wr-at-startup"
                        label="at-startup"
                        value={activeRule["match-rules"]["at-startup"]}
                        onChange={(checked) =>
                          patchSelected((rule) => {
                            rule["match-rules"]["at-startup"] = checked;
                          })
                        }
                      />
                    </div>
                  </section>

                  <section className="space-y-2 border-t border-border-subtle pt-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("window_rules.state", { defaultValue: "Window state on open" })}
                    </h3>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                      {STATE_FLAGS.map((flag) => (
                        <PropertyFlag
                          key={flag.key}
                          id={`wr-${flag.key}`}
                          label={flag.key}
                          hint={flag.hint}
                          value={activeRule[flag.key]}
                          onChange={(checked) =>
                            patchSelected((rule) => {
                              rule[flag.key as StateFlagKey] = checked;
                            })
                          }
                        />
                      ))}
                    </div>
                  </section>

                  <section className="space-y-2 border-t border-border-subtle pt-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("window_rules.geometry", { defaultValue: "Geometry" })}
                    </h3>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                      {SIZE_PROPERTIES.map((prop) => (
                        <SizeField
                          key={prop.key}
                          id={`wr-${prop.key}`}
                          label={prop.key}
                          value={activeRule[prop.key]}
                          placeholder={t("window_rules.inherit", { defaultValue: "inherited" })}
                          onChange={(value) =>
                            patchSelected((rule) => {
                              rule[prop.key as SizeKey] = value;
                            })
                          }
                        />
                      ))}
                      <SizeField
                        id="wr-geometry-corner-radius"
                        label="geometry-corner-radius"
                        value={activeRule["geometry-corner-radius"]}
                        placeholder={t("window_rules.inherit", { defaultValue: "inherited" })}
                        onChange={(value) =>
                          patchSelected((rule) => {
                            rule["geometry-corner-radius"] = value;
                          })
                        }
                      />
                    </div>
                  </section>

                  <section className="space-y-2 border-t border-border-subtle pt-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("window_rules.rendering", { defaultValue: "Rendering & capture" })}
                    </h3>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {RENDER_FLAGS.map((flag) => (
                        <PropertyFlag
                          key={flag.key}
                          id={`wr-${flag.key}`}
                          label={flag.key}
                          hint={flag.hint}
                          value={activeRule[flag.key as RenderFlagKey]}
                          onChange={(checked) =>
                            patchSelected((rule) => {
                              rule[flag.key as RenderFlagKey] = checked;
                            })
                          }
                        />
                      ))}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="wr-opacity" className="text-sm">
                          {t("window_rules.opacity", { defaultValue: "Opacity" })}
                        </Label>
                        <span className="font-mono text-xs text-primary">{activeRule.opacity ?? "—"}</span>
                      </div>
                      <input
                        id="wr-opacity"
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.01}
                        value={activeRule.opacity ?? 1}
                        onChange={(event) =>
                          patchSelected((rule) => {
                            rule.opacity = Number(event.target.value);
                          })
                        }
                        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted"
                        style={{ accentColor: "var(--primary)" }}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="wr-block-out-from" className="text-sm">
                        {t("window_rules.block_out_from", { defaultValue: "Block out from" })}
                      </Label>
                      <Select
                        value={activeRule["block-out-from"] ?? NO_SELECTION}
                        onValueChange={(value) =>
                          patchSelected((rule) => {
                            rule["block-out-from"] = value === NO_SELECTION ? null : value;
                          })
                        }
                      >
                        <SelectTrigger id="wr-block-out-from">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_SELECTION}>
                            {t("window_rules.block_out_none", { defaultValue: "Not blocked" })}
                          </SelectItem>
                          {BLOCK_OUT_VALUES.map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </section>
                </div>
              </RuleInspectorPanel>
            ) : (
              <RuleEmptyState
                icon={Pencil}
                title={t("window_rules.select_title", { defaultValue: "No rule selected" })}
                description={t("window_rules.select_description", {
                  defaultValue: "Pick a rule from the pipeline to edit its match criteria and properties.",
                })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface PatternFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * A matcher pattern field.
 *
 * niri compiles `app-id` and `title` into regexes, so a broken pattern is a
 * config that will not load: the field compiles it the same way and refuses to
 * pretend the value is fine.
 */
function PatternField({ id, label, value, onChange }: PatternFieldProps) {
  const { t } = useTranslation();
  const result = compilePattern(value);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="font-mono text-xs text-muted-foreground">
          {label}
        </Label>
        {isRegexPattern(label, value) && (
          <span className="inline-flex items-center gap-1 font-mono text-xs text-primary">
            <Regex className="h-3 w-3" />
            regex
          </span>
        )}
      </div>
      <Input
        id={id}
        className="h-8 font-mono"
        value={value}
        aria-invalid={!result.ok}
        onChange={(event) => onChange(event.target.value)}
      />
      {!result.ok && (
        <p className="text-xs text-danger">
          {t("window_rules.regex_error", { defaultValue: "Invalid regex" })}: {result.message}
        </p>
      )}
    </div>
  );
}

interface SizeFieldProps {
  id: string;
  label: string;
  value: number | null | undefined;
  placeholder: string;
  onChange: (value: number | null) => void;
}

function SizeField({ id, label, value, placeholder, onChange }: SizeFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="font-mono text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={16384}
        className="h-8 font-mono"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
      />
    </div>
  );
}

interface MatchFlagProps {
  id: string;
  label: string;
  value: boolean | null | undefined;
  onChange: (checked: boolean) => void;
}

function MatchFlag({ id, label, value, onChange }: MatchFlagProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface px-2 py-1.5 hover:bg-surface-hover"
    >
      <span className="font-mono text-xs text-foreground">{label}</span>
      <Switch id={id} checked={value === true} onCheckedChange={onChange} />
    </label>
  );
}

interface PropertyFlagProps {
  id: string;
  label: string;
  hint: string;
  value: boolean | null | undefined;
  onChange: (checked: boolean) => void;
}

function PropertyFlag({ id, label, hint, value, onChange }: PropertyFlagProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer flex-col gap-1 rounded-md border border-border-subtle bg-surface px-2 py-1.5 hover:bg-surface-hover"
    >
      <span className="font-mono text-xs text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
      <Switch id={id} className="mt-1" checked={value === true} onCheckedChange={onChange} />
    </label>
  );
}
