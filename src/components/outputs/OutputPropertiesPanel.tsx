"use client";

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Copy, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfigStore } from "@/stores/configStore";
import { useOutputsCanvasStore } from "@/stores/outputsCanvasStore";
import { useValidationStore } from "@/stores/validationStore";
import { invokeCommand } from "@/lib/ipc";

const TRANSFORMS = ["normal", "90", "180", "270", "flipped", "flipped-90", "flipped-180", "flipped-270"] as const;

interface OutputPropertiesPanelProps {
  availableModes: string[];
  liveOutputs: Map<string, { modes: string[]; currentMode: string }>;
}

export function OutputPropertiesPanel({ availableModes, liveOutputs }: OutputPropertiesPanelProps) {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const update = useConfigStore((s) => s.update);
  
  const selectedOutputId = useOutputsCanvasStore((s) => s.selectedOutputId);
  const setSelectedOutputId = useOutputsCanvasStore((s) => s.setSelectedOutputId);
  
  const errors = useValidationStore((s) => s.errors);
  const warnings = useValidationStore((s) => s.warnings);

  const selectedOutput = useMemo(() => {
    if (!config || !selectedOutputId) return null;
    return config.outputs.find((o) => o.name === selectedOutputId) ?? null;
  }, [config, selectedOutputId]);

  const outputErrors = useMemo(() => {
    if (!selectedOutputId) return [];
    return errors.filter((e) => e.message.includes(selectedOutputId) || (e.line && e.line >= 0));
  }, [errors, selectedOutputId]);

  const outputWarnings = useMemo(() => {
    if (!selectedOutputId) return [];
    return warnings.filter((w) => w.message.includes(selectedOutputId) || (w.line && w.line >= 0));
  }, [warnings, selectedOutputId]);

  const hasErrors = outputErrors.length > 0;
  const hasWarnings = outputWarnings.length > 0;

  const handleModeChange = useCallback((mode: string) => {
    if (!selectedOutput) return;
    update((draft) => {
      const output = draft.outputs.find((o) => o.name === selectedOutputId);
      if (output) output.mode = mode;
    });
  }, [selectedOutputId, update, selectedOutput]);

  const handleScaleChange = useCallback((scale: number) => {
    if (!selectedOutput) return;
    const clamped = Math.max(0.25, Math.min(10, scale));
    update((draft) => {
      const output = draft.outputs.find((o) => o.name === selectedOutputId);
      if (output) output.scale = clamped;
    });
  }, [selectedOutputId, update, selectedOutput]);

  const handleTransformChange = useCallback((transform: string) => {
    if (!selectedOutput) return;
    update((draft) => {
      const output = draft.outputs.find((o) => o.name === selectedOutputId);
      if (output) output.transform = transform;
    });
  }, [selectedOutputId, update, selectedOutput]);

  const handleEnabledChange = useCallback((enabled: boolean) => {
    if (!selectedOutput) return;
    update((draft) => {
      const output = draft.outputs.find((o) => o.name === selectedOutputId);
      if (output) output.off = !enabled;
    });
  }, [selectedOutputId, update, selectedOutput]);

  const handleVrrChange = useCallback((vrr: boolean) => {
    if (!selectedOutput) return;
    update((draft) => {
      const output = draft.outputs.find((o) => o.name === selectedOutputId);
      if (output) output["variable-refresh-rate"] = vrr;
    });
  }, [selectedOutputId, update, selectedOutput]);

  const handleBackgroundColorChange = useCallback((color: string) => {
    if (!selectedOutput) return;
    update((draft) => {
      const output = draft.outputs.find((o) => o.name === selectedOutputId);
      if (output) output["background-color"] = color;
    });
  }, [selectedOutputId, update, selectedOutput]);

  const handleFocusAtStartupChange = useCallback((enabled: boolean) => {
    if (!selectedOutput) return;
    update((draft) => {
      const output = draft.outputs.find((o) => o.name === selectedOutputId);
      if (output) output["focus-at-startup"] = enabled;
    });
  }, [selectedOutputId, update, selectedOutput]);

  const handleMaxBpcChange = useCallback((bpc: number) => {
    if (!selectedOutput) return;
    update((draft) => {
      const output = draft.outputs.find((o) => o.name === selectedOutputId);
      if (output) output["max-bpc"] = bpc;
    });
  }, [selectedOutputId, update, selectedOutput]);

  const handleIdentify = useCallback(async () => {
    if (!selectedOutput) return;
    try {
      await invokeCommand("niri_msg", {
        args: ["output", selectedOutput.name, "identify"],
      });
    } catch (err) {
      console.error("Identify failed:", err);
    }
  }, [selectedOutput]);

  const handleCopyKDL = useCallback(async () => {
    if (!selectedOutput || !config) return;
    try {
      const result = await invokeCommand<string>("serialize_file", {
        config: { config, meta: { "main-path": "", "included-files": [] } },
      });
      // Extract the output node - simple regex approach
      const outputRegex = new RegExp(`output\\s+"${selectedOutput.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*\\{[^}]*\\}`, "s");
      const match = result.match(outputRegex);
      if (match) {
        await navigator.clipboard.writeText(match[0]);
      }
    } catch (err) {
      console.error("Copy KDL failed:", err);
    }
  }, [selectedOutput, config]);

  if (!selectedOutput) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{t("outputs.properties")}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center text-muted-foreground">
          <p>{t("outputs.select_output")}</p>
        </CardContent>
      </Card>
    );
  }

  const liveInfo = liveOutputs.get(selectedOutput.name);
  const isLive = !!liveInfo;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            {selectedOutput.name}
            {isLive && (
              <span className="text-xs bg-success/20 text-success px-2 py-0.5 rounded-full">
                {t("outputs.live")}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleCopyKDL} aria-label={t("outputs.copy_kdl")}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleIdentify} aria-label={t("outputs.identify")}>
              <Monitor className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-4">
        {hasErrors && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>{t("validation.errors_count", { count: outputErrors.length })}</span>
          </div>
        )}
        {hasWarnings && !hasErrors && (
          <div className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" />
            <span>{t("validation.warnings_count", { count: outputWarnings.length })}</span>
          </div>
        )}

        <Tabs defaultValue="basic" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">{t("outputs.basic")}</TabsTrigger>
            <TabsTrigger value="advanced">{t("outputs.advanced")}</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4">
            <div className="space-y-2">
              <Label>{t("outputs.enabled")}</Label>
              <Switch
                checked={!selectedOutput.off}
                onCheckedChange={handleEnabledChange}
                aria-label={t("outputs.enabled")}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("outputs.mode")}</Label>
              <Select
                value={selectedOutput.mode ?? ""}
                onValueChange={handleModeChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("outputs.auto")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("outputs.auto")}</SelectItem>
                  {availableModes.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("outputs.scale")}</Label>
              <Input
                type="number"
                step="0.25"
                min="0.25"
                max="10"
                value={selectedOutput.scale ?? 1}
                onChange={(e) => handleScaleChange(parseFloat(e.target.value) || 1)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("outputs.transform")}</Label>
              <Select
                value={selectedOutput.transform ?? "normal"}
                onValueChange={handleTransformChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSFORMS.map((transform) => (
                    <SelectItem key={transform} value={transform}>
                      {transform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("outputs.position")}</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={selectedOutput.position?.x ?? 0}
                  onChange={(e) => {
                    const x = parseInt(e.target.value, 10) || 0;
                    update((draft) => {
                      const output = draft.outputs.find((o) => o.name === selectedOutputId);
                      if (output) output.position = { x, y: output.position?.y ?? 0 };
                    });
                  }}
                  placeholder="X"
                  aria-label={t("outputs.position_x")}
                />
                <Input
                  type="number"
                  value={selectedOutput.position?.y ?? 0}
                  onChange={(e) => {
                    const y = parseInt(e.target.value, 10) || 0;
                    update((draft) => {
                      const output = draft.outputs.find((o) => o.name === selectedOutputId);
                      if (output) output.position = { x: output.position?.x ?? 0, y };
                    });
                  }}
                  placeholder="Y"
                  aria-label={t("outputs.position_y")}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("outputs.position_hint")}</p>
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4">
            <div className="space-y-2">
              <Label>{t("outputs.vrr")}</Label>
              <Switch
                checked={selectedOutput["variable-refresh-rate"] ?? false}
                onCheckedChange={handleVrrChange}
                aria-label={t("outputs.vrr")}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("outputs.focus_at_startup")}</Label>
              <Switch
                checked={selectedOutput["focus-at-startup"] ?? false}
                onCheckedChange={handleFocusAtStartupChange}
                aria-label={t("outputs.focus_at_startup")}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("outputs.background_color")}</Label>
              <Input
                type="color"
                value={selectedOutput["background-color"] ?? "#000000"}
                onChange={(e) => handleBackgroundColorChange(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("outputs.max_bpc")}</Label>
              <Input
                type="number"
                min="6"
                max="16"
                step="2"
                value={selectedOutput["max-bpc"] ?? 8}
                onChange={(e) => handleMaxBpcChange(parseInt(e.target.value, 10) || 8)}
              />
            </div>
          </TabsContent>
        </Tabs>

        {config && config.outputs.length > 1 && (
          <div className="pt-4 border-t">
            <Label>{t("outputs.select_another")}</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {config.outputs.map((output) => (
                <Button
                  key={output.name}
                  variant={output.name === selectedOutputId ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedOutputId(output.name)}
                  className="gap-1"
                >
                  <Monitor className="h-3 w-3" />
                  {output.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}