"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  Code2,
  Keyboard,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KdlPreviewPanel } from "@/components/rules/KdlPreviewPanel";
import { RuleEmptyState } from "@/components/rules/RuleEmptyState";
import { TriStateField } from "@/components/forms/TriStateField";
import { KeyHeatmap } from "@/components/binds/KeyHeatmap";
import {
  bindActionLine,
  bindHeader,
  bindsToKdlLines,
  findDuplicateChords,
  keyCounts,
  normalizeChord,
  normalizeKeyToken,
} from "@/components/binds/bindsKdl";
import { useConfigStore } from "@/stores/configStore";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import type { BindEntry } from "@/types/generated/contract";

type EditorState = { mode: "new" } | { mode: "edit"; index: number };

/**
 * Category names that do not read well when the action prefix is just
 * title-cased. Everything else falls back to the first token of the action.
 */
const CATEGORY_LABELS: Record<string, string> = {
  spawn: "Spawn / Run",
  focus: "Focus",
  move: "Window Movement",
  workspace: "Workspaces",
  quit: "System",
  power: "System",
};

/** Binds share the first token of their action, e.g. `focus-column-left`. */
function categoryOf(action: string): string {
  const token = action.trim().split("-")[0]?.toLowerCase() ?? "";
  return token === "" ? "other" : token;
}

function categoryLabel(category: string): string {
  const known = CATEGORY_LABELS[category];
  if (known) return known;
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function pillClass(active: boolean): string {
  return cn(
    "rounded-full border px-2.5 py-0.5 text-xs transition-default",
    active
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-border-subtle bg-surface text-muted-foreground hover:border-primary/30 hover:text-foreground"
  );
}

/**
 * Key Bindings.
 *
 * `config.binds.binds` is an ordered list and the table follows it rather than
 * sorting, so what is shown is what niri reads. Duplicate chords are called out
 * but not hidden or reordered: niri accepts them, and the user is the one who
 * decides which one to change. The heatmap and KDL preview are read-only views
 * over the same list.
 */
export function KeyBindingsPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const binds = useMemo(() => config?.binds.binds ?? [], [config]);

  useEffect(() => {
    logger.info("KeyBindingsPage", "mounted");
    return () => logger.info("KeyBindingsPage", "unmounted");
  }, []);

  const duplicates = useMemo(() => findDuplicateChords(binds), [binds]);
  const counts = useMemo(() => keyCounts(binds), [binds]);
  const kdlLines = useMemo(() => bindsToKdlLines(binds), [binds]);

  const conflictGroups = useMemo(() => {
    const byChord = new Map<string, { bind: BindEntry; index: number }[]>();
    binds.forEach((bind, index) => {
      const chord = normalizeChord(bind.key);
      if (chord === "") return;
      const group = byChord.get(chord);
      if (group) group.push({ bind, index });
      else byChord.set(chord, [{ bind, index }]);
    });
    return [...byChord.entries()].filter(([, group]) => group.length > 1);
  }, [binds]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const bind of binds) set.add(categoryOf(bind.action));
    return [...set].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
  }, [binds]);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const bind of binds) {
      const cat = categoryOf(bind.action);
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return map;
  }, [binds]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return binds
      .map((bind, index) => ({ bind, index }))
      .filter(({ bind }) => {
        if (category !== null && categoryOf(bind.action) !== category) return false;
        if (q === "") return true;
        const tokens = bind.key.split("+").map((part) => normalizeKeyToken(part).toLowerCase());
        return (
          bind.key.toLowerCase().includes(q) ||
          bind.action.toLowerCase().includes(q) ||
          tokens.includes(q)
        );
      });
  }, [binds, query, category]);

  const handleKeyClick = useCallback((label: string) => {
    setQuery((current) => (current.trim().toLowerCase() === label.toLowerCase() ? "" : label));
  }, []);

  const removeBinding = useCallback((index: number) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      draft.binds.binds.splice(index, 1);
    });
    store.markDirty();
    logger.debug("KeyBindingsPage", "bind removed", { index });
  }, []);

  const handleEditorSave = useCallback(
    (entry: BindEntry) => {
      if (!editor) return;
      const store = useConfigStore.getState();
      store.update((draft) => {
        if (editor.mode === "edit") draft.binds.binds[editor.index] = entry;
        else draft.binds.binds.push(entry);
      });
      store.markDirty();
      logger.debug("KeyBindingsPage", "bind saved", { mode: editor.mode });
      setEditor(null);
    },
    [editor]
  );

  if (!config) {
    return (
      <div className="flex h-full flex-col">
        <RuleEmptyState icon={Keyboard} title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  const editingBind =
    editor?.mode === "edit" ? binds[editor.index] ?? null : null;
  const otherBinds =
    editor?.mode === "edit" && editor.index != null
      ? binds.filter((_, index) => index !== editor.index)
      : binds;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Keyboard className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">
            {t("sidebar.key-bindings", { defaultValue: "Key Bindings" })}
          </h1>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
            {t("binds.count_badge", {
              defaultValue: "{{count}} active",
              count: binds.length,
            })}
          </span>
          {conflictGroups.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-mono text-xs text-warning">
              <AlertTriangle className="h-3 w-3" />
              {t("binds.conflict_badge", {
                defaultValue: "{{count}} conflict(s)",
                count: conflictGroups.length,
              })}
            </span>
          )}
          <span className="font-mono text-xs text-muted-foreground">config.binds.binds</span>
        </div>
        <Button size="sm" onClick={() => setEditor({ mode: "new" })}>
          <Plus className="mr-2 h-4 w-4" />
          {t("binds.add", { defaultValue: "Add binding" })}
        </Button>
      </div>

      {binds.length === 0 ? (
        <RuleEmptyState
          icon={Keyboard}
          title={t("binds.empty_title", { defaultValue: "No key bindings" })}
          description={t("binds.empty_description", {
            defaultValue:
              "This config has no binds, so niri falls back to its own defaults. Add a binding to run a compositor action, launch a program, or switch workspaces from the keyboard.",
          })}
          actionLabel={t("binds.add", { defaultValue: "Add binding" })}
          onAction={() => setEditor({ mode: "new" })}
        />
      ) : (
        <>
          {conflictGroups.length > 0 && (
            <div className="border-b border-warning/30 bg-warning/10 px-4 py-3">
              <div className="flex items-center gap-2 text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">
                  {t("binds.conflict_title", { defaultValue: "Hotkey collisions" })}
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {conflictGroups.map(([chord, group]) => (
                  <li key={chord} className="flex flex-wrap items-center gap-2 text-xs">
                    <kbd className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-mono text-warning">
                      {group[0]!.bind.key}
                    </kbd>
                    <span className="text-muted-foreground">
                      {t("binds.conflict_bound_to", { defaultValue: "is bound to" })}
                    </span>
                    {group.map(({ bind, index }) => (
                      <span key={index} className="font-mono text-warning">
                        {bind.action}
                      </span>
                    ))}
                    <button
                      type="button"
                      className="rounded-sm px-1 font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => setEditor({ mode: "edit", index: group[0]!.index })}
                    >
                      {t("binds.conflict_resolve", { defaultValue: "resolve" })}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8 font-mono text-xs"
                    value={query}
                    placeholder={t("binds.search_placeholder", {
                      defaultValue: "filter by hotkey (e.g. mod+shift) or action (e.g. spawn)",
                    })}
                    aria-label={t("common.search")}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className={pillClass(category === null)}
                    onClick={() => setCategory(null)}
                  >
                    {t("binds.category_all", { defaultValue: "All" })} ({binds.length})
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={pillClass(category === cat)}
                      onClick={() => setCategory(cat)}
                    >
                      {t(`binds.category_${cat}`, { defaultValue: categoryLabel(cat) })} (
                      {categoryCounts.get(cat) ?? 0})
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-border-subtle">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-surface">
                    <tr className="border-b border-border-subtle text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-medium">
                        {t("binds.col_key", { defaultValue: "Key" })}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("binds.col_action", { defaultValue: "Action" })}
                      </th>
                      <th className="hidden px-3 py-2 font-medium md:table-cell">
                        {t("binds.col_args", { defaultValue: "Arguments" })}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("binds.col_status", { defaultValue: "Status" })}
                      </th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">
                          {t("binds.no_matches", { defaultValue: "No binding matches this filter." })}
                        </td>
                      </tr>
                    ) : (
                      rows.map(({ bind, index }) => {
                        const duplicate = duplicates.has(index);
                        const noAction = bind.action.trim() === "";
                        return (
                          <tr
                            key={index}
                            className={cn(
                              "border-b border-border-subtle last:border-0 hover:bg-surface-hover",
                              duplicate && "bg-danger/5"
                            )}
                          >
                            <td className="px-3 py-2 align-top">
                              <div className="flex flex-wrap gap-1">
                                {bind.key
                                  .split("+")
                                  .filter((part) => part.trim() !== "")
                                  .map((part, partIndex) => (
                                    <kbd
                                      key={partIndex}
                                      className="rounded-sm border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-xs text-foreground"
                                    >
                                      {part.trim()}
                                    </kbd>
                                  ))}
                              </div>
                            </td>
                            <td className="px-3 py-2 align-top font-mono text-xs">
                              {noAction ? (
                                <span className="text-danger">
                                  {t("binds.no_action", { defaultValue: "no action" })}
                                </span>
                              ) : (
                                bind.action
                              )}
                            </td>
                            <td className="hidden max-w-[16rem] truncate px-3 py-2 align-top font-mono text-xs text-muted-foreground md:table-cell">
                              {(bind.args ?? []).join(" ") || "—"}
                            </td>
                            <td className="px-3 py-2 align-top">
                              {duplicate ? (
                                <span className="inline-flex items-center gap-1 rounded-sm border border-danger/30 bg-danger/10 px-1.5 py-0.5 font-mono text-xs text-danger">
                                  <AlertTriangle className="h-3 w-3" />
                                  {t("binds.status_duplicate", { defaultValue: "duplicate key" })}
                                </span>
                              ) : noAction ? (
                                <span className="rounded-sm border border-danger/30 bg-danger/10 px-1.5 py-0.5 font-mono text-xs text-danger">
                                  {t("binds.status_no_action", { defaultValue: "no action" })}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-mono text-xs text-success">
                                  <Check className="h-3 w-3" />
                                  {t("binds.status_unique", { defaultValue: "unique" })}
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setEditor({ mode: "edit", index })}
                                aria-label={t("common.edit")}
                                title={t("common.edit")}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-danger hover:bg-danger/10 hover:text-danger"
                                onClick={() => removeBinding(index)}
                                aria-label={t("common.delete")}
                                title={t("common.delete")}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
              <KeyHeatmap counts={counts} bindCount={binds.length} onKeyClick={handleKeyClick} />
              <KdlPreviewPanel
                nodeName="binds"
                lines={kdlLines}
                title={t("binds.kdl_title", { defaultValue: "Binds as KDL" })}
                icon={<Code2 className="h-4 w-4 text-primary" />}
                note={t("binds.kdl_note", {
                  defaultValue:
                    "The list keeps its config order; copied text can be pasted back into a binds block unchanged.",
                })}
              />
            </div>
          </div>
        </>
      )}

      {editor && (
        <BindEditorDialog
          mode={editor.mode}
          initial={editingBind}
          otherBinds={otherBinds}
          onSave={handleEditorSave}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

interface BindEditorDialogProps {
  mode: "new" | "edit";
  initial: BindEntry | null;
  /** Every other bind, for the duplicate-chord check. */
  otherBinds: BindEntry[];
  onSave: (entry: BindEntry) => void;
  onClose: () => void;
}

/**
 * Editor for a single bind.
 *
 * The dialog is mounted fresh for each open, so local state starts from the
 * bind being edited and never carries a previous edit over. A chord that is
 * already used is called out but stays committable: niri gives the config its
 * own meaning for repeated chords, so the editor warns and lets the user decide
 * rather than refusing to represent a config that already exists.
 */
function BindEditorDialog({ mode, initial, otherBinds, onSave, onClose }: BindEditorDialogProps) {
  const { t } = useTranslation();
  const [key, setKey] = useState(initial?.key ?? "");
  const [action, setAction] = useState(initial?.action ?? "");
  const [argsText, setArgsText] = useState((initial?.args ?? []).join("\n"));
  const [cooldown, setCooldown] = useState<number | null>(initial?.["cooldown-ms"] ?? null);
  const [overlayTitle, setOverlayTitle] = useState(initial?.["overlay-title"] ?? "");
  const [allowInhibiting, setAllowInhibiting] = useState<boolean | null>(
    initial?.["allow-inhibiting"] ?? null
  );
  const [allowWhenLocked, setAllowWhenLocked] = useState<boolean | null>(
    initial?.["allow-when-locked"] ?? null
  );

  const trimmedKey = key.trim();
  const trimmedAction = action.trim();
  const duplicate =
    trimmedKey !== "" &&
    otherBinds.some((bind) => normalizeChord(bind.key) === normalizeChord(trimmedKey));
  const canSave = trimmedKey !== "" && trimmedAction !== "";

  const parsedArgs = useMemo(
    () =>
      argsText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    [argsText]
  );

  const buildEntry = useCallback((): BindEntry => {
    const entry: BindEntry = { action: trimmedAction, key: trimmedKey };
    if (parsedArgs.length > 0) entry.args = parsedArgs;
    if (cooldown != null) entry["cooldown-ms"] = cooldown;
    if (overlayTitle.trim() !== "") entry["overlay-title"] = overlayTitle.trim();
    if (allowInhibiting != null) entry["allow-inhibiting"] = allowInhibiting;
    if (allowWhenLocked != null) entry["allow-when-locked"] = allowWhenLocked;
    return entry;
  }, [
    parsedArgs,
    trimmedAction,
    trimmedKey,
    cooldown,
    overlayTitle,
    allowInhibiting,
    allowWhenLocked,
  ]);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    onSave(buildEntry());
  }, [canSave, buildEntry, onSave]);

  const preview: BindEntry | null =
    trimmedKey !== "" && trimmedAction !== "" ? buildEntry() : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "new"
              ? t("binds.editor_new", { defaultValue: "Add key binding" })
              : t("binds.editor_edit", { defaultValue: "Edit key binding" })}
          </DialogTitle>
          <DialogDescription>
            {t("binds.editor_description", {
              defaultValue:
                "A chord is written as key names joined by +, for example Mod+Shift+Q. The action is the niri action to run.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="bind-key" className="font-mono text-xs text-muted-foreground">
              key
            </Label>
            <Input
              id="bind-key"
              className="h-8 font-mono"
              value={key}
              placeholder={t("binds.key_placeholder", { defaultValue: "Mod+Shift+Q" })}
              aria-invalid={trimmedKey === "" || duplicate}
              onChange={(event) => setKey(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="bind-action" className="font-mono text-xs text-muted-foreground">
              action
            </Label>
            <Input
              id="bind-action"
              className="h-8 font-mono"
              value={action}
              placeholder={t("binds.action_placeholder", { defaultValue: "spawn" })}
              aria-invalid={trimmedAction === ""}
              onChange={(event) => setAction(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="bind-args" className="font-mono text-xs text-muted-foreground">
              args
            </Label>
            <Textarea
              id="bind-args"
              className="min-h-[64px] font-mono text-xs"
              value={argsText}
              placeholder={t("binds.args_placeholder", { defaultValue: "one argument per line" })}
              onChange={(event) => setArgsText(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("binds.args_hint", {
                defaultValue: "Used by spawn and spawn-sh; other actions usually take none.",
              })}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="bind-cooldown" className="font-mono text-xs text-muted-foreground">
                cooldown-ms
              </Label>
              <Input
                id="bind-cooldown"
                type="number"
                min={0}
                max={60000}
                className="h-8 font-mono"
                value={cooldown ?? ""}
                placeholder={t("input.unset", { defaultValue: "niri default" })}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (raw === "") {
                    setCooldown(null);
                    return;
                  }
                  const parsed = Number(raw);
                  if (Number.isFinite(parsed)) setCooldown(Math.max(0, Math.round(parsed)));
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bind-overlay-title" className="font-mono text-xs text-muted-foreground">
                overlay-title
              </Label>
              <Input
                id="bind-overlay-title"
                className="h-8 font-mono"
                value={overlayTitle}
                placeholder={t("input.unset", { defaultValue: "niri default" })}
                onChange={(event) => setOverlayTitle(event.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TriStateField
              id="bind-allow-inhibiting"
              name="allow-inhibiting"
              value={allowInhibiting}
              onChange={setAllowInhibiting}
            />
            <TriStateField
              id="bind-allow-when-locked"
              name="allow-when-locked"
              value={allowWhenLocked}
              onChange={setAllowWhenLocked}
            />
          </div>

          {trimmedKey !== "" && duplicate && (
            <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("binds.editor_duplicate", {
                defaultValue:
                  "Another binding already uses this chord. Saving both keeps niri's own behaviour for repeated chords; resolve it here if that is not intended.",
              })}
            </p>
          )}
          {trimmedKey === "" && (
            <p className="text-xs text-danger">
              {t("binds.editor_need_key", { defaultValue: "A key is required." })}
            </p>
          )}
          {trimmedAction === "" && (
            <p className="text-xs text-danger">
              {t("binds.editor_need_action", { defaultValue: "An action is required." })}
            </p>
          )}

          {preview && (
            <KdlPreviewPanel
              nodeName={bindHeader(preview)}
              lines={[`${bindActionLine(preview)};`]}
              title={t("binds.editor_preview", { defaultValue: "This binding as KDL" })}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
