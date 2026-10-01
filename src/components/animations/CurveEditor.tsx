"use client";

import { useCallback, useMemo } from "react";
import { motionSamples, type BezierPoints, type MotionSample, type SpringParams } from "@/lib/animationMotion";

const VIEW_W = 200;
const VIEW_H = 200;

interface CurveEditorProps {
  /** Which plot to draw. */
  kind: "easing" | "spring";
  bezier: BezierPoints;
  spring: SpringParams;
  onBezierChange: (points: BezierPoints) => void;
}

/**
 * Plot of the motion curve.
 *
 * The easing plot is also the control surface: a pointer drag on a control point
 * writes the bezier straight into the config draft, which is why the editor and
 * the numbers below it are the same state.
 */
export function CurveEditor({ kind, bezier, spring, onBezierChange }: CurveEditorProps) {
  const samples = useMemo<MotionSample[]>(
    () => (kind === "easing" ? motionSamples("easing", { bezier }) : motionSamples("spring", { spring })),
    [kind, bezier, spring]
  );

  const path = useMemo(() => samplesToPath(samples), [samples]);

  const handlePointer = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (kind !== "easing") return;
      const box = event.currentTarget.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const x = clamp01((event.clientX - box.left) / box.width);
      const y = clampRange((event.clientY - box.top) / box.height, -1, 2);
      // The nearest control point is the one being dragged, decided by which
      // half of the plot the pointer is nearer to.
      const target = distance(x, y, bezier.x1, 1 - bezier.y1) <= distance(x, y, bezier.x2, 1 - bezier.y2) ? "p1" : "p2";
      onBezierChange(
        target === "p1" ? { ...bezier, x1: x, y1: y } : { ...bezier, x2: x, y2: y }
      );
    },
    [kind, bezier, onBezierChange]
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {kind === "easing" ? "cubic-bezier(x1, y1, x2, y2)" : "impulse response"}
        </span>
        <span className="font-mono text-xs text-muted-foreground">0,0 → 1,1</span>
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-48 w-full touch-none rounded-md border border-border-subtle bg-muted"
        onPointerDown={handlePointer}
        onPointerMove={(event) => {
          if (event.buttons === 1) handlePointer(event);
        }}
        role="img"
        aria-label={kind === "easing" ? "Easing curve plot" : "Spring response plot"}
      >
        <line x1={0} y1={VIEW_H} x2={VIEW_W} y2={0} className="stroke-border" strokeDasharray="4 4" strokeWidth={1} />
        <line x1={0} y1={VIEW_H} x2={VIEW_W} y2={VIEW_H} className="stroke-border" strokeWidth={1} />
        <line x1={0} y1={0} x2={0} y2={VIEW_H} className="stroke-border" strokeWidth={1} />

        {kind === "easing" && (
          <>
            <line
              x1={0}
              y1={VIEW_H}
              x2={bezier.x1 * VIEW_W}
              y2={VIEW_H - bezier.y1 * VIEW_H}
              className="stroke-mono-accent"
              strokeWidth={1}
              strokeOpacity={0.5}
            />
            <line
              x1={VIEW_W}
              y1={0}
              x2={bezier.x2 * VIEW_W}
              y2={VIEW_H - bezier.y2 * VIEW_H}
              className="stroke-mono-accent"
              strokeWidth={1}
              strokeOpacity={0.5}
            />
          </>
        )}

        <path d={path} fill="none" className="stroke-primary" strokeWidth={2} strokeLinecap="round" />

        {kind === "easing" && (
          <>
            <circle cx={bezier.x1 * VIEW_W} cy={VIEW_H - bezier.y1 * VIEW_H} r={5} className="fill-mono-accent" />
            <circle cx={bezier.x2 * VIEW_W} cy={VIEW_H - bezier.y2 * VIEW_H} r={5} className="fill-primary" />
          </>
        )}
      </svg>

      {kind === "easing" && (
        <p className="text-xs text-muted-foreground">
          Drag inside the plot to move the control point under the pointer.
        </p>
      )}
    </div>
  );
}

function samplesToPath(samples: MotionSample[]): string {
  if (samples.length === 0) return "";
  return samples
    .map((sample, index) => {
      const x = sample.t / 1000;
      // The travel is normalised to 0..1; overshoot above 1 is drawn above the
      // top edge so a bouncing spring stays visible instead of being clipped.
      const y = 1 - sample.value;
      const px = clamp01(x) * VIEW_W;
      const py = clampRange(y, -1, 2) * VIEW_H;
      return `${index === 0 ? "M" : "L"} ${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(" ");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return (x1 - x2) ** 2 + (y1 - y2) ** 2;
}