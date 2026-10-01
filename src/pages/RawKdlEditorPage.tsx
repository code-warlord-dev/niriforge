"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  FileCode2,
  Files,
  Link2,
  Lock,
  Pencil,
  RefreshCw,
  Save,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfigStore } from "@/stores/configStore";
import { invokeCommand, toAppError } from "@/lib/ipc";
import type { AppError } from "@/types/config";
import { logger } from "@/lib/logger";

const MAIN_FILE = "__main__";

type SyncState = "synced" | "dirty";

/**
 * Raw KDL.
 *
 * The buffer shown here is the config the backend serialises from the typed
 * model, rendered by a plain textarea: nothing on this page is fetched over the
 * network, so the editor has to work with no connectivity at all. Text the user
 * types is a draft on top of that buffer, and it reaches the typed model only
 * through an explicit write - the reverse direction needs a parser on the
 * backend, so it is offered as a refusal rather than a silent no-op.
 */
export function RawKdlEditorPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const meta = useConfigStore((s) => s.meta);
  const dirty = useConfigStore((s) => s.dirty);
  const loading = useConfigStore((s) => s.loading);
  const save = useConfigStore((s) => s.save);
  const load = useConfigStore((s) => s.load);

  const [selectedFile, setSelectedFile] = useState<string>(MAIN_FILE);
  const [readOnly, setReadOnly] = useState(false);
  const [baseline, setBaseline] = useState<string>("");
  const [buffer, setBuffer] = useState<string>("");
  const [serializing, setSerializing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [writing, setWriting] = useState(false);
  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [validationErrors, setValidationErrors] = useState<{ message: string; line: number | null; column: number | null; file: string | null }[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<{ message: string; line: number | null; column: number | null; file: string | null }[]>([]);
  const [validatedAt, setValidatedAt] = useState<string | null>(null);
  const [niriVersion, setNiriVersion] = useState<string | null>(null);

  const includedFiles = useMemo(() => meta?.["included-files"] ?? [], [meta]);

  useEffect(() => {
    logger.info("RawKdlEditorPage", "mounted");
    return () => logger.info("RawKdlEditorPage", "unmounted");
  }, []);

  const readBuffer = useCallback(async () => {
    if (!config) return;
    setSerializing(true);
    setLoadError(null);
    try {
      const text = await invokeCommand<string>("serialize_file", { config: { config, meta: meta ?? { "main-path": "", "included-files": [] } } });
      setBaseline(text);
      setBuffer(text);
      logger.info("RawKdlEditorPage", "buffer serialized", { bytes: text.length });
    } catch (err) {
      setLoadError(toAppError(err));
      logger.error("RawKdlEditorPage", "serialize failed", err);
    } finally {
      setSerializing(false);
    }
  }, [config, meta]);

  useEffect(() => {
    void readBuffer();
  }, [readBuffer]);

  useEffect(() => {
    let cancelled = false;
    invokeCommand<string>("niri_msg", { args: ["--version"] })
      .then((output) => {
        if (!cancelled) setNiriVersion(output.trim());
      })
      .catch((err) => {
        if (!cancelled) setNiriVersion(null);
        logger.debug("RawKdlEditorPage", "niri version unavailable", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const edited = buffer !== baseline;
  const syncState: SyncState = dirty ? "dirty" : "synced";

  const diagnostics = useMemo(
    () => [
      ...validationErrors.map((issue) => ({ ...issue, severity: "error" as const })),
      ...validationWarnings.map((issue) => ({ ...issue, severity: "warning" as const })),
    ],
    [validationErrors, validationWarnings]
  );

  const validate = useCallback(async () => {
    if (!config) return;
    setValidatedAt(null);
    const store = useConfigStore.getState();
    try {
      const result = await store.validate();
      setValidationErrors(
        result.errors.map((issue) => ({
          message: issue.message,
          line: issue.line ?? null,
          column: issue.column ?? null,
          file: issue.file ?? null,
        }))
      );
      setValidationWarnings(
        result.warnings.map((issue) => ({
          message: issue.message,
          line: issue.line ?? null,
          column: issue.column ?? null,
          file: issue.file ?? null,
        }))
      );
      setValidatedAt(new Date().toISOString());
      logger.info("RawKdlEditorPage", "validation finished", {
        valid: result.valid,
        errors: result.errors.length,
        warnings: result.warnings.length,
      });
    } catch (err) {
      setLoadError(toAppError(err));
      logger.error("RawKdlEditorPage", "validation failed", err);
    }
  }, [config]);

  const writeToDisk = useCallback(async () => {
    setSaving(true);
    try {
      await save({ "create-backup": true });
      logger.info("RawKdlEditorPage", "config written to disk");
    } catch (err) {
      setLoadError(toAppError(err));
      logger.error("RawKdlEditorPage", "save failed", err);
    } finally {
      setSaving(false);
    }
  }, [save]);

  const copyBuffer = useCallback(() => {
    void navigator.clipboard.writeText(buffer);
    logger.debug("RawKdlEditorPage", "buffer copied to clipboard");
  }, [buffer]);

  const downloadBuffer = useCallback(() => {
    const blob = new Blob([buffer], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "config.kdl";
    anchor.click();
    URL.revokeObjectURL(url);
    logger.info("RawKdlEditorPage", "buffer downloaded");
  }, [buffer]);

  if (!config) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader
          title={t("raw_kdl.title", { defaultValue: "Raw KDL" })}
          description={t("raw_kdl.description", {
            defaultValue: "Edit the config as KDL text. No network access is required.",
          })}
          schema={niriVersion}
        />
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-lg">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <FileCode2 className="h-10 w-10 text-muted-foreground" />
              <h2 className="text-lg font-medium">
                {t("raw_kdl.no_config", { defaultValue: "No config loaded" })}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("raw_kdl.no_config_hint", {
                  defaultValue: "Load a config file to see its KDL source. The raw view works on whatever is currently loaded.",
                })}
              </p>
              <Button onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t("common.reload", { defaultValue: "Reload" })}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("raw_kdl.title", { defaultValue: "Raw KDL" })}
        description={t("raw_kdl.description", {
          defaultValue: "Edit the config as KDL text. No network access is required.",
        })}
        schema={niriVersion}
        modeToggle={
          // The two modes are a segmented pair rather than an action, so they
          // carry their own selected styling rather than a button variant.
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-0.5">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={!readOnly}
              className={`h-7 gap-1 ${readOnly ? "text-muted-foreground" : "border border-border-subtle bg-surface-card text-foreground"}`}
              onClick={() => setReadOnly(false)}
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("raw_kdl.edit_mode", { defaultValue: "Edit" })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={readOnly}
              className={`h-7 gap-1 ${readOnly ? "border border-border-subtle bg-surface-card text-foreground" : "text-muted-foreground"}`}
              onClick={() => setReadOnly(true)}
            >
              <Lock className="h-3.5 w-3.5" />
              {t("raw_kdl.read_only", { defaultValue: "Read-only" })}
            </Button>
          </div>
        }
      />

      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-card px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Files className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select value={selectedFile} onValueChange={setSelectedFile}>
            <SelectTrigger className="h-8 w-full max-w-sm font-mono text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MAIN_FILE} className="font-mono text-sm">
                {meta?.["main-path"] || t("raw_kdl.main_file", { defaultValue: "config.kdl" })}
              </SelectItem>
              {includedFiles.map((file) => (
                <SelectItem key={file} value={file} className="font-mono text-sm">
                  {file}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={validate} disabled={serializing}>
            <CheckCircle2 className="h-4 w-4" />
            {t("raw_kdl.validate", { defaultValue: "Validate" })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void readBuffer()}
            disabled={serializing}
            title={t("raw_kdl.discard_draft", { defaultValue: "Discard the draft and re-read the model" })}
          >
            <Undo2 className="h-4 w-4" />
            {t("raw_kdl.revert", { defaultValue: "Revert draft" })}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface-card">
          <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Code2 className="h-4 w-4 text-primary" />
              <span className="truncate font-mono text-sm">
                {selectedFile === MAIN_FILE
                  ? meta?.["main-path"] || "config.kdl"
                  : selectedFile}
              </span>
              {edited && (
                <Badge variant="warning" className="shrink-0 text-xs">
                  {t("raw_kdl.draft", { defaultValue: "draft" })}
                </Badge>
              )}
            </div>
            <div className="shrink-0 font-mono text-xs text-muted-foreground">
              {buffer.split("\n").length} {t("raw_kdl.lines", { defaultValue: "lines" })}
            </div>
          </div>

          <Textarea
            value={buffer}
            onChange={(event) => setBuffer(event.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            aria-label={t("raw_kdl.buffer", { defaultValue: "KDL source" })}
            className="min-h-[320px] flex-1 resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0"
            placeholder={t("raw_kdl.buffer_empty", { defaultValue: "The serialised config is empty." })}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono">{buffer.length} B</span>
              <span className="font-mono">
                {edited
                  ? t("raw_kdl.cursor_pending", { defaultValue: "draft not applied to the model" })
                  : t("raw_kdl.matches_model", { defaultValue: "buffer matches the model" })}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                {syncState === "dirty" ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                )}
                {syncState === "dirty"
                  ? t("raw_kdl.model_dirty", { defaultValue: "model has unsaved changes" })
                  : t("raw_kdl.model_synced", { defaultValue: "model matches disk" })}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyBuffer} aria-label={t("common.copy", { defaultValue: "Copy" })}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={downloadBuffer} aria-label={t("raw_kdl.download", { defaultValue: "Download buffer" })}>
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-96">
          <Card>
            <CardHeader className="border-b border-border bg-surface px-3 py-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-warning" />
                {t("raw_kdl.diagnostics", { defaultValue: "Diagnostics" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {validatedAt === null ? (
                <p className="text-sm text-muted-foreground">
                  {t("raw_kdl.diagnostics_hint", {
                    defaultValue: "Run Validate to check the loaded config against niri's own parser.",
                  })}
                </p>
              ) : diagnostics.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("raw_kdl.diagnostics_clean", { defaultValue: "niri reported no problems." })}
                </p>
              ) : (
                <ul className="space-y-1">
                  {diagnostics.map((issue, index) => (
                    <li key={`${issue.severity}-${index}`} className="font-mono text-xs">
                      <span className={issue.severity === "error" ? "text-danger" : "text-warning"}>
                        {issue.severity}
                      </span>
                      {issue.file !== null || issue.line !== null ? (
                        <span className="text-muted-foreground">
                          {" "}
                          {issue.file ?? "?"}:{issue.line ?? "?"}
                          {issue.column !== null ? `:${issue.column}` : ""}
                        </span>
                      ) : null}
                      <span className="block text-foreground">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              )}
              {loadError !== null && (
                <p className="rounded-md border border-danger/40 bg-danger/10 p-2 font-mono text-xs text-danger">
                  {loadError.type}: {typeof loadError.details === "string" ? loadError.details : ""}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border bg-surface px-3 py-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  {t("raw_kdl.includes", { defaultValue: "Included files" })}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{includedFiles.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              {includedFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("raw_kdl.includes_empty", {
                    defaultValue: "This config has no include nodes, so there is one file to read.",
                  })}
                </p>
              ) : (
                <ScrollArea className="max-h-48">
                  <ul className="space-y-1">
                    {includedFiles.map((file) => (
                      <li key={file}>
                        <button
                          type="button"
                          onClick={() => setSelectedFile(file)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-surface-hover ${
                            selectedFile === file ? "bg-surface-hover" : ""
                          }`}
                        >
                          <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{file}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border bg-surface px-3 py-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Save className="h-4 w-4 text-primary" />
                {t("raw_kdl.sync", { defaultValue: "Synchronisation" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              <p className="text-sm text-muted-foreground">
                {t("raw_kdl.sync_direction", {
                  defaultValue:
                    "The typed model is the source of truth on the way in: writing it to disk serialises the whole config, so free-form edits in this buffer are not parsed back into the model.",
                })}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" className="flex-1" onClick={() => void writeToDisk()} disabled={saving || writing}>
                  <Save className="h-4 w-4" />
                  {saving
                    ? t("common.saving", { defaultValue: "Saving" })
                    : t("raw_kdl.write_to_disk", { defaultValue: "Write model to disk" })}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setWriting((value) => !value)}
                >
                  {writing
                    ? t("raw_kdl.apply_cancelled", { defaultValue: "Cancel" })
                    : t("raw_kdl.apply_to_model", { defaultValue: "Apply draft to model" })}
                </Button>
              </div>
              {writing && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                  {t("raw_kdl.apply_unavailable", {
                    defaultValue:
                      "Parsing arbitrary KDL into the typed model needs a parse command the backend does not expose yet. Use the visual pages for structural edits; this page writes the model, not the text.",
                  })}
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function PageHeader({
  title,
  description,
  schema,
  modeToggle,
}: {
  title: string;
  description: string;
  schema: string | null;
  modeToggle?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-card p-4 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {schema !== null && (
            <Badge variant="outline" className="font-mono text-xs">
              {schema}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {modeToggle}
    </div>
  );
}