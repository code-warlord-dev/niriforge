"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RuleListPanelProps<T> {
  rules: T[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  renderPrimary: (rule: T, index: number) => ReactNode;
  renderActions: (rule: T, index: number) => ReactNode;
  title: string;
  countLabel: string;
  orderNote: string;
  addLabel: string;
  dragLabel: string;
  moveUpLabel: string;
  moveDownLabel: string;
  removeLabel: string;
  /** Distinguishes the drag payloads when both rule lists live in the app. */
  dragGroup: string;
}

/**
 * Ordered rule registry.
 *
 * Order is part of the rule, not a view detail, so reordering is a config
 * mutation handed to the caller. The drag handle is only a handle: the row
 * itself carries the draggable flag, which is what makes a keyboard user able
 * to reorder through the up and down buttons fall back to.
 */
export function RuleListPanel<T>({
  rules,
  selectedIndex,
  onSelect,
  onReorder,
  onRemove,
  onAdd,
  renderPrimary,
  renderActions,
  title,
  countLabel,
  orderNote,
  addLabel,
  dragLabel,
  moveUpLabel,
  moveDownLabel,
  removeLabel,
  dragGroup,
}: RuleListPanelProps<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const commitDrop = (target: number) => {
    if (dragIndex === null || dragIndex === target) return;
    onReorder(dragIndex, target);
  };

  const endDrag = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{countLabel}</span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">{orderNote}</span>
      </div>

      <ul className="flex flex-col gap-2">
        {rules.map((rule, index) => {
          const selected = index === selectedIndex;
          return (
            <li
              key={index}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(dragGroup, String(index));
                setDragIndex(index);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropIndex(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                commitDrop(index);
                endDrag();
              }}
              onDragEnd={endDrag}
              onClick={() => onSelect(index)}
              className={cn(
                "cursor-pointer rounded-lg border border-border bg-surface-card p-3 transition-colors",
                "hover:bg-surface-hover",
                selected && "border-l-2 border-l-primary bg-surface-hover",
                dropIndex === index && dragIndex !== null && dragIndex !== index && "border-dashed"
              )}
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                  title={dragLabel}
                  aria-hidden
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <span className="w-6 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">{renderPrimary(rule, index)}</div>
                <div
                  className="flex shrink-0 items-center gap-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  {renderActions(rule, index)}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={index === 0}
                    onClick={() => onReorder(index, index - 1)}
                    aria-label={moveUpLabel}
                    title={moveUpLabel}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={index === rules.length - 1}
                    onClick={() => onReorder(index, index + 1)}
                    aria-label={moveDownLabel}
                    title={moveDownLabel}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => onRemove(index)}
                    aria-label={removeLabel}
                    title={removeLabel}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Button variant="outline" size="sm" className="w-full" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}
