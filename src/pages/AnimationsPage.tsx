"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileCode2, Play, Sparkles, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RuleEmptyState } from "@/components/rules/RuleEmptyState";
import { MotionPreview } from "@/components/animations/MotionPreview";
import { CurveEditor } from "@/components/animations/CurveEditor";
import {
  MOTION_PRESETS,
  bezierToCss,
  clampBezier,
  clampSpring,
  describeDamping,
  type BezierPoints,
  type MotionModel,
  type SpringParams,
} from "@/lib/animationMotion";
import { useConfigStore } from "@/stores/configStore";
import type { AnimationConfig, AnimationsConfig } from "@/types/generated/contract";
import { logger } from "@/lib/logger";

/**
 * The animation slots niri's `animations` node accepts.
 *
 * This list is the schema, not a preference: the typed contract has exactly
 * these keys, and a slot that is not here cannot be written.
 */
const SLOTS = [
  "window-open",
  "window-close",
  "window-move",
  "window-resize",
  "workspace-switch",
  "column-switch",
  "overview",
  "overview-window",
] as const;

type SlotKey = (typeof SLOTS)[number];

const NO_SELECTION = "__none__";

/**
 * Animations & Curves.
 *
 * The domain here is small and exact: `animations.enabled`, `animations.slowdown`
 * and per-slot `duration` / `easing` / `spring`. Everything visual — the plot,
 * the settle time, the playable preview — comes from the motion service and is
 * computed here, never stored.
 */
export function AnimationsPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);

  const animations = config?.animations ?? null;
  const [selectedSlot, setSelectedSlot] = useState<SlotKey | null>(null);
  const [model, setModel] = useState<MotionModel>("spring");
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    logger.info("AnimationsPage", "mounted");
    return () => logger.info("AnimationsPage", "unmounted");
  }, []);

  // Keep the selection on a slot that still exists.
  useEffect(() => {
    if (selectedSlot !== null && !animations?.[selectedSlot]) {
      setSelectedSlot(animations ? nextConfiguredSlot(animations) : null);
    }
    if (selectedSlot === null && animations) {
      setSelectedSlot(nextConfiguredSlot(animations));
    }
  }, [animations, selectedSlot]);

  const patchAnimations = useCallback((patch: (node: AnimationsConfig) => void) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      if (!draft.animations) draft.animations = {};
      patch(draft.animations);
    });
    store.markDirty();
  }, []);

  const patchSlot = useCallback(
    (slot: SlotKey, patch: (node: AnimationConfig) => void) => {
      patchAnimations((node) => {
        const current = node[slot];
        if (current) {
          patch(current);
        } else {
          const created: AnimationConfig = {};
          patch(created);
          node[slot] = created;
        }
      });
      logger.debug("AnimationsPage", "slot patched", { slot });
    },
    [patchAnimations]
  );

  const activeSlot = selectedSlot;
  const slotConfig = activeSlot ? animations?.[activeSlot] ?? null : null;
  const slowdown = animations?.slowdown ?? 1;
  const enabled = animations?.enabled ?? true;

  const spring = useMemo(
    () => clampSpring(slotConfig?.spring ?? undefined),
    [slotConfig?.spring]
  );
  const bezier = useMemo(
    () => clampBezier(slotConfig?.easing ?? undefined),
    [slotConfig?.easing]
  );

  const setSpring = useCallback(
    (patch: Partial<SpringParams>) => {
      if (!activeSlot) return;
      const next = clampSpring({ ...spring, ...patch });
      patchSlot(activeSlot, (node) => {
        node.spring = next;
        // niri treats easing and spring as alternatives: leaving both would
        // produce a config the compositor has to guess about.
        delete node.easing;
      });
    },
    [activeSlot, spring, patchSlot]
  );

  const setBezier = useCallback(
    (patch: Partial<BezierPoints> | BezierPoints) => {
      if (!activeSlot) return;
      const next = clampBezier({ ...bezier, ...patch });
      patchSlot(activeSlot, (node) => {
        node.easing = next;
        delete node.spring;
      });
    },
    [activeSlot, bezier, patchSlot]
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = MOTION_PRESETS.find((entry) => entry.id === presetId);
      if (!preset || !activeSlot) return;
      setModel(preset.model);
      patchSlot(activeSlot, (node) => {
        delete node.easing;
        delete node.spring;
        if (preset.model === "spring") {
          node.spring = clampSpring(preset.spring);
        } else {
          node.easing = clampBezier(preset.bezier);
        }
      });
      logger.info("AnimationsPage", "preset applied", { presetId, slot: activeSlot });
    },
    [activeSlot, patchSlot]
  );

  const resetSlot = useCallback(() => {
    if (!activeSlot) return;
    patchSlot(activeSlot, (node) => {
      delete node.easing;
      delete node.spring;
      delete node.duration;
    });
  }, [activeSlot, patchSlot]);

  const kdlLines = useMemo(() => animationsToKdl(animations), [animations]);

  if (!config) {
    return (
      <div className="flex h-full flex-col">
        <RuleEmptyState icon={Sparkles} title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  const configuredCount = SLOTS.filter((slot) => animations?.[slot]).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("sidebar.animations")}</h1>
          <span className="font-mono text-xs text-muted-foreground">config["animations"]</span>
          <Badge variant="outline" className="font-mono text-xs">
            {configuredCount}/{SLOTS.length} slots
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="anim-enabled" className="text-sm text-muted-foreground">
            animations.enabled
          </Label>
          <Switch
            id="anim-enabled"
            checked={enabled}
            onCheckedChange={(checked) => patchAnimations((node) => { node.enabled = checked; })}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor="anim-slowdown" className="text-sm">
                animations.slowdown
              </Label>
              <p className="text-xs text-muted-foreground">
                Scales every animation duration. 1.0 is niri&apos;s own timing; larger values stretch it.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="anim-slowdown"
                type="number"
                step={0.1}
                min={0.1}
                max={10}
                className="h-8 w-24 font-mono"
                value={slowdown}
                onChange={(event) => {
                  const raw = Number(event.target.value);
                  patchAnimations((node) => {
                    node.slowdown = Number.isFinite(raw) ? Math.min(10, Math.max(0.1, raw)) : 1;
                  });
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => patchAnimations((node) => { node.slowdown = 1; })}
              >
                reset
              </Button>
            </div>
          </div>
        </section>

        {animations === null ? (
          <RuleEmptyState
            icon={Sparkles}
            title={t("animations.empty_title", { defaultValue: "No animations node" })}
            description={t("animations.empty_description", {
              defaultValue:
                "This config has no animations block, so niri runs every transition with its built-in defaults. Turn on animations above or pick a slot to write one.",
            })}
          />
        ) : configuredCount === 0 ? (
          <RuleEmptyState
            icon={Sparkles}
            title={t("animations.no_slots_title", { defaultValue: "No slots configured" })}
            description={t("animations.no_slots_description", {
              defaultValue:
                "Every slot is unset, which means all of them use niri defaults. Choose a slot below to give one its own duration and motion.",
            })}
            actionLabel={t("animations.add_slot", { defaultValue: "Add slot" })}
            onAction={() => setSelectedSlot(SLOTS[0])}
          />
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("animations.slots", { defaultValue: "Animation slots" })}</h2>
              <span className="font-mono text-xs text-muted-foreground">
                {configuredCount}/{SLOTS.length}
              </span>
            </div>

            <Tabs value={activeSlot ?? NO_SELECTION} onValueChange={(value) => {
              if (value !== NO_SELECTION) setSelectedSlot(value as SlotKey);
            }}>
              <TabsList className="flex-wrap">
                {SLOTS.map((slot) => (
                  <TabsTrigger key={slot} value={slot} className="font-mono text-xs">
                    {slot}
                    {animations?.[slot] ? "" : " ·"}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {activeSlot === null ? (
              <p className="text-sm text-muted-foreground">
                {t("animations.select_slot", { defaultValue: "Pick a slot to edit its motion." })}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">{activeSlot}</Badge>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {slotConfig?.spring ? "spring" : slotConfig?.easing ? "easing" : "niri default"}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    duration {slotConfig?.duration ?? "—"} ms
                  </span>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="anim-duration" className="font-mono text-xs text-muted-foreground">
                    duration (ms)
                  </Label>
                  <Input
                    id="anim-duration"
                    type="number"
                    min={0}
                    step={10}
                    className="h-8 w-28 font-mono"
                    placeholder="niri default"
                    value={slotConfig?.duration ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      patchSlot(activeSlot, (node) => {
                        if (raw === "") {
                          delete node.duration;
                        } else {
                          const parsed = Number(raw);
                          node.duration = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
                        }
                      });
                    }}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {MOTION_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      size="sm"
                      variant="outline"
                      className="font-mono text-xs"
                      onClick={() => applyPreset(preset.id)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" className="font-mono text-xs" onClick={resetSlot}>
                    {t("animations.clear_slot", { defaultValue: "clear" })}
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("animations.editor", { defaultValue: "Motion editor" })}</h2>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={model === "spring" ? "default" : "outline"}
                  className="font-mono text-xs"
                  onClick={() => setModel("spring")}
                >
                  <Waves className="mr-1 h-3.5 w-3.5" />
                  spring
                </Button>
                <Button
                  size="sm"
                  variant={model === "easing" ? "default" : "outline"}
                  className="font-mono text-xs"
                  onClick={() => setModel("easing")}
                >
                  easing
                </Button>
              </div>
            </div>

            {activeSlot === null ? (
              <p className="text-sm text-muted-foreground">
                {t("animations.select_slot", { defaultValue: "Pick a slot to edit its motion." })}
              </p>
            ) : model === "spring" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <CurveEditor kind="spring" bezier={bezier} spring={spring} onBezierChange={setBezier} />
                <div className="grid grid-cols-2 gap-3">
                  <SpringField
                    id="spring-stiffness"
                    label="stiffness"
                    value={spring.stiffness}
                    min={1}
                    max={5000}
                    step={10}
                    onChange={(value) => setSpring({ stiffness: value })}
                  />
                  <SpringField
                    id="spring-damping"
                    label="damping (ζ)"
                    value={spring.damping}
                    min={0.05}
                    max={3}
                    step={0.01}
                    hint={describeDamping(spring.damping)}
                    onChange={(value) => setSpring({ damping: value })}
                  />
                  <SpringField
                    id="spring-mass"
                    label="mass"
                    value={spring.mass}
                    min={0.05}
                    max={10}
                    step={0.05}
                    onChange={(value) => setSpring({ mass: value })}
                  />
                  <SpringField
                    id="spring-epsilon"
                    label="epsilon"
                    value={spring.epsilon}
                    min={0.00001}
                    max={0.1}
                    step={0.0001}
                    onChange={(value) => setSpring({ epsilon: value })}
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <CurveEditor kind="easing" bezier={bezier} spring={spring} onBezierChange={setBezier} />
                <div className="grid grid-cols-2 gap-3">
                  {(["x1", "y1", "x2", "y2"] as const).map((key) => (
                    <div key={key} className="space-y-1">
                      <Label htmlFor={`bezier-${key}`} className="font-mono text-xs text-muted-foreground">
                        {key}
                      </Label>
                      <Input
                        id={`bezier-${key}`}
                        type="number"
                        step={0.05}
                        className="h-8 font-mono"
                        value={bezier[key]}
                        onChange={(event) => {
                          const raw = Number(event.target.value);
                          if (Number.isFinite(raw)) setBezier({ [key]: raw });
                        }}
                      />
                    </div>
                  ))}
                  <p className="col-span-2 font-mono text-xs text-muted-foreground">
                    {bezierToCss(bezier)}
                  </p>
                </div>
              </div>
            )}

            {activeSlot !== null && (
              <MotionPreview
                model={model}
                spring={model === "spring" ? spring : undefined}
                bezier={model === "easing" ? bezier : undefined}
                slowdown={slowdown}
                label={activeSlot}
                runKey={runKey}
              />
            )}
            {activeSlot !== null && (
              <Button size="sm" variant="outline" className="self-start" onClick={() => setRunKey((value) => value + 1)}>
                <Play className="mr-1 h-3.5 w-3.5" />
                {t("animations.run_preview", { defaultValue: "Run preview" })}
              </Button>
            )}
          </section>
        </div>

        <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
          <div className="flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">
              {t("animations.kdl_title", { defaultValue: "Generated KDL" })}
            </h2>
          </div>
          {kdlLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("animations.kdl_empty", {
                defaultValue: "Nothing to write: this config has no animations node yet.",
              })}
            </p>
          ) : (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
              <code>{["animations {", ...kdlLines.map((line) => `    ${line}`), "}"].join("\n")}</code>
            </pre>
          )}
        </section>
      </div>
    </div>
  );
}

interface SpringFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (value: number) => void;
}

function SpringField({ id, label, value, min, max, step, hint, onChange }: SpringFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="font-mono text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        className="h-8 font-mono"
        value={value}
        onChange={(event) => {
          const raw = Number(event.target.value);
          if (Number.isFinite(raw)) onChange(raw);
        }}
      />
      {hint && <p className="font-mono text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The first slot that already has a block, so the editor opens on real data. */
function nextConfiguredSlot(animations: AnimationsConfig): SlotKey | null {
  return SLOTS.find((slot) => animations[slot]) ?? null;
}

/**
 * KDL text for the animations node.
 *
 * Only the fields the typed contract carries are printed: an absent slot stays
 * absent, because writing an empty block would change what niri does with it.
 */
function animationsToKdl(animations: AnimationsConfig | null): string[] {
  if (!animations) return [];
  const lines: string[] = [];

  if (animations.enabled != null) lines.push(`enabled ${animations.enabled}`);
  if (animations.slowdown != null) lines.push(`slowdown ${animations.slowdown}`);

  for (const slot of SLOTS) {
    const node = animations[slot];
    if (!node) continue;
    lines.push(`${slot} {`);
    if (node.duration != null) lines.push(`    duration ${node.duration}`);
    if (node.spring) {
      const spring = clampSpring(node.spring);
      lines.push(`    spring stiffness=${spring.stiffness} damping=${spring.damping} mass=${spring.mass} epsilon=${spring.epsilon}`);
    }
    if (node.easing) {
      const easing = clampBezier(node.easing);
      lines.push(`    easing ${easing.x1} ${easing.y1} ${easing.x2} ${easing.y2}`);
    }
    lines.push("}");
  }

  return lines;
}