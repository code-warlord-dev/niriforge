"use client";

import { LayoutGrid, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LayoutConfig, NamedWorkspace } from "@/types/generated/contract";

interface WorkspaceRibbonProps {
  workspaces: NamedWorkspace[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * The declared workspaces as a strip.
 *
 * Every cell is a real block from the config: its name, the output it is pinned
 * to or the fact that it is not, and which layout properties it overrides.
 * Windows and columns are runtime state the compositor owns, so they are not
 * drawn here — a cell with no windows is not a mock of an empty workspace, it is
 * a workspace whose contents nobody has looked at.
 */
export function WorkspaceRibbon({ workspaces, selectedIndex, onSelect }: WorkspaceRibbonProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3">
      <div className="flex items-center gap-2">
        <LayoutGrid className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">
          config.workspaces · {workspaces.length} declared
        </span>
      </div>

      <ol className="flex flex-wrap gap-2">
        {workspaces.map((workspace, index) => {
          const active = index === selectedIndex;
          const output = workspace["open-on-output"];
          const overrides = layoutOverrides(workspace.layout);

          return (
            <li key={`${workspace.name}-${index}`}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-pressed={active}
                className={cn(
                  "flex w-44 flex-col gap-1.5 rounded-md border p-2.5 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border-subtle bg-muted hover:bg-surface-hover"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-sm text-foreground">
                    {workspace.name === "" ? "∅" : workspace.name}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
                </div>

                <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  <Monitor className="h-3 w-3 shrink-0" />
                  <span className="truncate">{output ?? "dynamic"}</span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {overrides.length === 0 ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      global layout
                    </span>
                  ) : (
                    overrides.map((item) => (
                      <span
                        key={item}
                        className="rounded border border-border-subtle px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                      >
                        {item}
                      </span>
                    ))
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Names of the layout properties this block actually overrides. */
function layoutOverrides(layout: LayoutConfig | null | undefined): string[] {
  if (!layout) return [];
  const out: string[] = [];
  if (layout.gaps != null) out.push("gaps");
  if (layout["default-column-width"] != null) out.push("col-width");
  if (layout["focus-ring"] && Object.keys(layout["focus-ring"]).length > 0) out.push("focus-ring");
  if (layout.border && Object.keys(layout.border).length > 0) out.push("border");
  if (layout["always-center-single-column"] != null) out.push("center-single");
  return out;
}