"use client";

import { useTranslation } from "react-i18next";
import { Keyboard } from "lucide-react";

interface KeyHeatmapProps {
  /** How many binds name each physical key, keyed by the label used here. */
  counts: Record<string, number>;
  bindCount: number;
  onKeyClick?: (label: string) => void;
}

interface HeatKey {
  label: string;
  /** Relative key width in units of a letter key. */
  grow?: number;
}

/**
 * A QWERTY layout, because that is the layout the labels assume.
 *
 * niri names keys by their XKB name, which is layout-independent, while the
 * heatmap necessarily draws one physical arrangement. Mapping the tokens onto
 * this layout is what makes a busy key visible; a non-QWERTY user still gets
 * correct counts, just labelled for the common case.
 */
const ROWS: HeatKey[][] = [
  [
    { label: "Esc", grow: 1.25 },
    { label: "F1" },
    { label: "F2" },
    { label: "F3" },
    { label: "F4" },
    { label: "F5" },
    { label: "F6" },
    { label: "F7" },
    { label: "F8" },
    { label: "F9" },
    { label: "F10" },
    { label: "F11" },
    { label: "F12" },
    { label: "Del", grow: 1.25 },
  ],
  [
    { label: "`" },
    { label: "1" },
    { label: "2" },
    { label: "3" },
    { label: "4" },
    { label: "5" },
    { label: "6" },
    { label: "7" },
    { label: "8" },
    { label: "9" },
    { label: "0" },
    { label: "-" },
    { label: "=" },
    { label: "Backspace", grow: 2 },
  ],
  [
    { label: "Tab", grow: 1.5 },
    { label: "Q" },
    { label: "W" },
    { label: "E" },
    { label: "R" },
    { label: "T" },
    { label: "Y" },
    { label: "U" },
    { label: "I" },
    { label: "O" },
    { label: "P" },
    { label: "[" },
    { label: "]" },
    { label: "\\", grow: 1.5 },
  ],
  [
    { label: "Caps", grow: 1.75 },
    { label: "A" },
    { label: "S" },
    { label: "D" },
    { label: "F" },
    { label: "G" },
    { label: "H" },
    { label: "J" },
    { label: "K" },
    { label: "L" },
    { label: ";" },
    { label: "'" },
    { label: "Enter", grow: 2.25 },
  ],
  [
    { label: "Shift", grow: 2.25 },
    { label: "Z" },
    { label: "X" },
    { label: "C" },
    { label: "V" },
    { label: "B" },
    { label: "N" },
    { label: "M" },
    { label: "," },
    { label: "." },
    { label: "/" },
    { label: "Shift", grow: 2.75 },
  ],
  [
    { label: "Ctrl", grow: 1.25 },
    { label: "Super", grow: 1.25 },
    { label: "Alt", grow: 1.25 },
    { label: "Space", grow: 6.25 },
    { label: "Alt", grow: 1.25 },
    { label: "Super", grow: 1.25 },
    { label: "Ctrl", grow: 1.25 },
  ],
];

/**
 * Physical keyboard heatmap of the current binds.
 *
 * The counts come from the bind chords themselves, not from a keymap profile,
 * so an idle key is drawn dim and a bound one is drawn in the accent colour.
 * Clicking a lit key hands its label back so the caller can narrow the table to
 * that key.
 */
export function KeyHeatmap({ counts, bindCount, onKeyClick }: KeyHeatmapProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            {t("binds.heatmap_title", { defaultValue: "Layout" })}
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {t("binds.heatmap_binds", {
            defaultValue: "{{count}} binds",
            count: bindCount,
          })}
        </span>
      </div>

      <div className="space-y-1">
        {ROWS.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-1">
            {row.map((key, keyIndex) => {
              const count = counts[key.label] ?? 0;
              const active = count > 0;
              const clickable = active && onKeyClick !== undefined;
              return (
                <button
                  key={`${key.label}-${keyIndex}`}
                  type="button"
                  onClick={clickable ? () => onKeyClick(key.label) : undefined}
                  disabled={!clickable}
                  title={active ? `${key.label}: ${count}` : key.label}
                  aria-label={active ? `${key.label}: ${count}` : key.label}
                  className={[
                    "relative flex h-8 min-w-0 items-center justify-center overflow-hidden rounded-md border px-1 font-mono text-xs transition-default",
                    rowIndex === 0 ? "h-7" : "",
                    active
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border-subtle bg-surface text-muted-foreground",
                    clickable ? "cursor-pointer hover:border-primary hover:bg-primary/20" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ flexGrow: key.grow ?? 1, flexBasis: 0 }}
                >
                  <span className="truncate">{key.label}</span>
                  {count > 1 && (
                    <span className="absolute right-0.5 top-0.5 rounded-full bg-primary px-1 text-[9px] font-semibold leading-tight text-primary-foreground">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-primary/40 bg-primary/10" />
          {t("binds.heatmap_bound", { defaultValue: "bound" })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-border-subtle bg-surface" />
          {t("binds.heatmap_free", { defaultValue: "free" })}
        </span>
        <span>
          {t("binds.heatmap_note", {
            defaultValue: "number is how many binds name the key",
          })}
        </span>
      </div>
    </div>
  );
}
