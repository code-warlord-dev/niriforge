"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Code2, Layers, Plus, Ruler, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KdlPreviewPanel } from "@/components/rules/KdlPreviewPanel";
import { RuleEmptyState } from "@/components/rules/RuleEmptyState";
import { RuleInspectorPanel } from "@/components/rules/RuleInspectorPanel";
import { RuleListPanel } from "@/components/rules/RuleListPanel";
import { compilePattern, kdlString, matchRulesToKdl } from "@/components/rules/kdl";
import { useConfigStore } from "@/stores/configStore";
import type { LayerRule, Margin } from "@/types/generated/contract";
import { logger } from "@/lib/logger";

/** niri's layer-shell layers, in the order `niri_ipc::Layer` lists them. */
const LAYERS = ["background", "bottom", "top", "overlay"];
const ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
const KEYBOARD_INTERACTIVITY = ["none", "exclusive", "on-demand"];
const NO_SELECTION = "__none__";

const MARGIN_SIDES = [
  { key: "top", label: "margin.top" },
  { key: "right", label: "margin.right" },
  { key: "bottom", label: "margin.bottom" },
  { key: "left", label: "margin.left" },
] as const;

type MarginKey = (typeof MARGIN_SIDES)[number]["key"];

function layerRuleToKdl(rule: LayerRule): string[] {
  const lines: string[] = [...matchRulesToKdl(rule["match-rules"])];
  if (rule.exclude) {
    for (const line of matchRulesToKdl(rule.exclude)) {
      lines.push(line.replace(/^match /, "exclude "));
    }
  }
  if (rule.layer) lines.push(`layer ${kdlString(rule.layer)}`);
  if (rule.anchor) lines.push(`anchor ${kdlString(rule.anchor)}`);
  if (rule["keyboard-interactivity"]) {
    lines.push(`keyboard-interactivity ${kdlString(rule["keyboard-interactivity"])}`);
  }
  if (rule.margin) {
    for (const { key } of MARGIN_SIDES) {
      const value = rule.margin[key];
      if (value != null) lines.push(`${key} ${value}`);
    }
  }
  return lines;
}

function summariseLayerRule(rule: LayerRule): string[] {
  const parts: string[] = [];
  if (rule.layer) parts.push(`layer ${rule.layer}`);
  if (rule.anchor) parts.push(rule.anchor);
  if (rule["keyboard-interactivity"]) parts.push(`kbd ${rule["keyboard-interactivity"]}`);
  if (rule.margin) {
    for (const { key } of MARGIN_SIDES) {
      const value = rule.margin[key];
      if (value != null) parts.push(`${key} ${value}`);
    }
  }
  return parts;
}

/**
 * Layer Rules.
 *
 * `config["layer-rules"]` targets zwlr_layer_shell surfaces — docks, bars,
 * notification daemons, lock screens — which are not tiled windows. The model
 * is a layer rule: a required namespace plus shell properties (layer, anchor,
 * keyboard interactivity, margin). Only the list shell is shared with the
 * window rules page; no field or serialiser is.
 */
export function LayerRulesPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const rules = config?.["layer-rules"] ?? [];

  useEffect(() => {
    logger.info("LayerRulesPage", "mounted");
    return () => logger.info("LayerRulesPage", "unmounted");
  }, []);

  useEffect(() => {
    if (selectedIndex !== null && selectedIndex > rules.length - 1) {
      setSelectedIndex(rules.length > 0 ? rules.length - 1 : null);
    }
  }, [rules.length, selectedIndex]);

  const activeIndex = selectedIndex ?? (rules.length > 0 ? 0 : null);
  const activeRule = activeIndex !== null ? rules[activeIndex] ?? null : null;

  const patchRule = useCallback((index: number, patch: (rule: LayerRule) => void) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      const rule = draft["layer-rules"][index];
      if (rule) patch(rule);
    });
    store.markDirty();
  }, []);

  const patchSelected = useCallback(
    (patch: (rule: LayerRule) => void) => {
      if (activeIndex === null) return;
      patchRule(activeIndex, patch);
    },
    [activeIndex, patchRule]
  );

  const reorder = useCallback((from: number, to: number) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      const list = draft["layer-rules"];
      if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
    });
    store.markDirty();
    logger.debug("LayerRulesPage", "rule reordered", { from, to });
    setSelectedIndex(to);
  }, []);

  const removeRule = useCallback((index: number) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      draft["layer-rules"].splice(index, 1);
    });
    store.markDirty();
    logger.debug("LayerRulesPage", "rule removed", { index });
    setSelectedIndex(null);
  }, []);

  const addRule = useCallback(() => {
    const store = useConfigStore.getState();
    const index = store.config?.["layer-rules"].length ?? 0;
    store.update((draft) => {
      draft["layer-rules"].push({ namespace: "", "match-rules": { namespace: "" } });
    });
    store.markDirty();
    setSelectedIndex(index);
  }, []);

  const namespacePattern = activeRule?.["match-rules"].namespace ?? "";
  const namespaceResult = compilePattern(namespacePattern);

  if (!config) {
    return (
      <div className="flex h-full flex-col">
        <RuleEmptyState icon={Layers} title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("sidebar.layer-rules")}</h1>
          <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-xs text-muted-foreground">
            zwlr_layer_shell_v1
          </span>
          <span className="font-mono text-xs text-muted-foreground">config["layer-rules"]</span>
        </div>
        <Button size="sm" onClick={addRule}>
          <Plus className="mr-2 h-4 w-4" />
          {t("layer_rules.add", { defaultValue: "Add layer rule" })}
        </Button>
      </div>

      {rules.length === 0 ? (
        <RuleEmptyState
          icon={Layers}
          title={t("layer_rules.empty_title", { defaultValue: "No layer rules" })}
          description={t("layer_rules.empty_description", {
            defaultValue:
              "This config has no layer-rule blocks, so every layer-shell surface (docks, bars, notification daemons, lock screens) is placed by its client. Add a rule to set a layer, anchor, margins or keyboard interactivity.",
          })}
          actionLabel={t("layer_rules.add", { defaultValue: "Add layer rule" })}
          onAction={addRule}
        />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-full min-w-0 overflow-auto border-r border-border p-4 lg:w-2/5">
            <RuleListPanel<LayerRule>
              rules={rules}
              selectedIndex={activeIndex ?? -1}
              onSelect={setSelectedIndex}
              onReorder={reorder}
              onRemove={removeRule}
              onAdd={addRule}
              dragGroup="application/x-niriforge-layer-rule"
              title={t("layer_rules.registry", { defaultValue: "Configured namespaces" })}
              countLabel={`(${rules.length})`}
              orderNote={t("layer_rules.order_note", { defaultValue: "drag a row or use the arrows" })}
              addLabel={t("layer_rules.add", { defaultValue: "Add layer rule" })}
              dragLabel={t("layer_rules.drag", { defaultValue: "Drag to reorder" })}
              moveUpLabel={t("layer_rules.move_up", { defaultValue: "Move up" })}
              moveDownLabel={t("layer_rules.move_down", { defaultValue: "Move down" })}
              removeLabel={t("common.delete")}
              renderPrimary={(rule) => {
                const namespace = rule["match-rules"].namespace ?? rule.namespace;
                const parts = summariseLayerRule(rule);
                return (
                  <div className="space-y-1">
                    <span className="block truncate font-mono text-sm text-foreground">
                      namespace={namespace === "" ? "∅" : kdlString(namespace)}
                    </span>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {parts.length > 0 ? parts.join(" · ") : t("layer_rules.no_properties", { defaultValue: "client defaults" })}
                    </p>
                  </div>
                );
              }}
              renderActions={() => null}
            />
          </div>

          <div className="hidden w-3/5 min-w-0 flex-col gap-4 overflow-auto p-4 lg:flex">
            {activeRule && activeIndex !== null ? (
              <>
                <RuleInspectorPanel
                  title={t("layer_rules.inspector", { defaultValue: "Layer rule inspector" })}
                  subtitle={`layer-rule #${activeIndex + 1}`}
                  icon={<Layers className="h-4 w-4 text-primary" />}
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
                        {t("layer_rules.target", { defaultValue: "Target" })}
                      </h3>
                      <div className="space-y-1">
                        <Label htmlFor="lr-namespace" className="font-mono text-xs text-muted-foreground">
                          match namespace
                        </Label>
                        <Input
                          id="lr-namespace"
                          className="h-8 font-mono"
                          value={namespacePattern}
                          aria-invalid={!namespaceResult.ok}
                          onChange={(event) => {
                            const value = event.target.value;
                            patchSelected((rule) => {
                              // The flat `namespace` mirrors the matcher: niri's
                              // KDL keeps the namespace inside the match node.
                              rule["match-rules"].namespace = value;
                              rule.namespace = value;
                            });
                          }}
                        />
                        {!namespaceResult.ok && (
                          <p className="text-xs text-danger">
                            {t("layer_rules.regex_error", { defaultValue: "Invalid regex" })}:{" "}
                            {namespaceResult.message}
                          </p>
                        )}
                        {namespacePattern === "" && (
                          <p className="text-xs text-warning">
                            {t("layer_rules.namespace_required", {
                              defaultValue: "A layer rule without a namespace matches nothing useful. Set the namespace its client announces.",
                            })}
                          </p>
                        )}
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-border-subtle pt-3">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("layer_rules.shell", { defaultValue: "Shell placement" })}
                      </h3>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-1">
                          <Label htmlFor="lr-layer" className="font-mono text-xs text-muted-foreground">
                            layer
                          </Label>
                          <Select
                            value={activeRule.layer ?? NO_SELECTION}
                            onValueChange={(value) =>
                              patchSelected((rule) => {
                                rule.layer = value === NO_SELECTION ? null : value;
                              })
                            }
                          >
                            <SelectTrigger id="lr-layer">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_SELECTION}>
                                {t("layer_rules.client_default", { defaultValue: "client default" })}
                              </SelectItem>
                              {LAYERS.map((layer) => (
                                <SelectItem key={layer} value={layer}>
                                  {layer}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="lr-anchor" className="font-mono text-xs text-muted-foreground">
                            anchor
                          </Label>
                          <Select
                            value={activeRule.anchor ?? NO_SELECTION}
                            onValueChange={(value) =>
                              patchSelected((rule) => {
                                rule.anchor = value === NO_SELECTION ? null : value;
                              })
                            }
                          >
                            <SelectTrigger id="lr-anchor">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_SELECTION}>
                                {t("layer_rules.client_default", { defaultValue: "client default" })}
                              </SelectItem>
                              {ANCHORS.map((anchor) => (
                                <SelectItem key={anchor} value={anchor}>
                                  {anchor}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="lr-kbd" className="font-mono text-xs text-muted-foreground">
                            keyboard-interactivity
                          </Label>
                          <Select
                            value={activeRule["keyboard-interactivity"] ?? NO_SELECTION}
                            onValueChange={(value) =>
                              patchSelected((rule) => {
                                rule["keyboard-interactivity"] = value === NO_SELECTION ? null : value;
                              })
                            }
                          >
                            <SelectTrigger id="lr-kbd">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_SELECTION}>
                                {t("layer_rules.client_default", { defaultValue: "client default" })}
                              </SelectItem>
                              {KEYBOARD_INTERACTIVITY.map((value) => (
                                <SelectItem key={value} value={value}>
                                  {value}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-border-subtle pt-3">
                      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        <Ruler className="h-3.5 w-3.5" />
                        {t("layer_rules.margin", { defaultValue: "Margin" })}
                      </h3>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {MARGIN_SIDES.map((side) => (
                          <div key={side.key} className="space-y-1">
                            <Label htmlFor={`lr-margin-${side.key}`} className="font-mono text-xs text-muted-foreground">
                              {side.label}
                            </Label>
                            <Input
                              id={`lr-margin-${side.key}`}
                              type="number"
                              min={-16384}
                              max={16384}
                              className="h-8 font-mono"
                              value={activeRule.margin?.[side.key] ?? ""}
                              placeholder={t("layer_rules.untouched", { defaultValue: "untouched" })}
                              onChange={(event) => {
                                const raw = event.target.value;
                                const value = raw === "" ? null : Number(raw);
                                patchSelected((rule) => {
                                  if (value === null) {
                                    if (rule.margin) delete rule.margin[side.key as MarginKey];
                                  } else {
                                    rule.margin = { ...(rule.margin ?? ({} as Margin)) };
                                    rule.margin[side.key as MarginKey] = value;
                                  }
                                });
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </RuleInspectorPanel>

                <KdlPreviewPanel
                  nodeName="layer-rule"
                  lines={layerRuleToKdl(activeRule)}
                  title={t("layer_rules.kdl_title", { defaultValue: "Generated KDL" })}
                  icon={<Code2 className="h-4 w-4 text-primary" />}
                />
              </>
            ) : (
              <RuleEmptyState
                icon={Layers}
                title={t("layer_rules.select_title", { defaultValue: "No rule selected" })}
                description={t("layer_rules.select_description", {
                  defaultValue: "Pick a namespace from the list to edit its shell placement.",
                })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
