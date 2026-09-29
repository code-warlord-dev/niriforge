import { useTranslation } from "react-i18next";
import { FolderOpen, AlertCircle, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

interface EmptyStateProps {
  loading: boolean;
  errorMessage?: string | null;
  defaultPath?: string;
  onOpen: (path: string) => void;
}

/**
 * First-run / no-config screen.
 * No sample or demo datasets — only a real config path.
 */
export function EmptyState({ loading, errorMessage, defaultPath = "~/.config/niri/config.kdl", onOpen }: EmptyStateProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState(defaultPath);

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        filters: [{ name: "KDL Config", extensions: ["kdl"] }],
      });
      if (selected) {
        setPath(selected);
        onOpen(selected);
      }
    } catch {
      // User cancelled or error - silently ignore
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t("empty.title")}</CardTitle>
          <CardDescription>{t("empty.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (path.trim()) onOpen(path.trim());
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="config-path">{t("empty.path_label")}</Label>
              <div className="flex gap-2">
                <Input
                  id="config-path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="~/.config/niri/config.kdl"
                  disabled={loading}
                  aria-invalid={!!errorMessage}
                  aria-describedby={errorMessage ? "config-path-error" : undefined}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBrowse}
                  disabled={loading}
                  aria-label={t("common.browse")}
                  className="shrink-0"
                >
                  <FileSearch className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("common.browse")}</span>
                </Button>
              </div>
            </div>
            {errorMessage ? (
              <p id="config-path-error" role="alert" className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                {errorMessage}
              </p>
            ) : null}
            <Button type="submit" className="w-full gap-2" disabled={loading || !path.trim()}>
              <FolderOpen className="h-4 w-4" />
              {loading ? t("empty.loading") : t("common.open_config")}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">{t("empty.hint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
