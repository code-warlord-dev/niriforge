"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  motionToCss,
  springOvershoot,
  springSamples,
  springSettleMs,
  type BezierPoints,
  type MotionModel,
  type SpringParams,
} from "@/lib/animationMotion";
import { logger } from "@/lib/logger";

interface MotionPreviewProps {
  model: MotionModel;
  spring?: SpringParams;
  bezier?: BezierPoints;
  slowdown: number;
  label: string;
  runKey: number;
}

/**
 * The test bench.
 *
 * A local CSS transition on a placeholder card, driven by the motion service.
 * It is deliberately inert: it never sends anything to the compositor, so
 * triggering it cannot change the running session.
 */
export function MotionPreview({ model, spring, bezier, slowdown, label, runKey }: MotionPreviewProps) {
  const [travel, setTravel] = useState(0);
  const [running, setRunning] = useState(false);
  const timerRef = useRef<number | null>(null);

  const css = motionToCss(model, { spring, bezier }, slowdown);
  const settle = spring ? springSettleMs(spring) : null;
  const overshoot = spring ? springOvershoot(springSamples(spring)) : 0;

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (runKey === 0) return;
    // Restart the transition: the key changes the element, so React remounts it
    // at the resting position and the entry animation plays from there.
    setTravel(0);
    setRunning(true);
    logger.debug("MotionPreview", "preview triggered", { model, durationMs: css.durationMs });
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setRunning(false);
      setTravel(0);
      timerRef.current = null;
    }, css.durationMs + 60);
  }, [runKey, model, css.durationMs]);

  const toggle = useCallback(() => {
    setTravel((current) => (current === 0 ? 1 : 0));
  }, []);

  const offset = travel === 0 ? "translateX(0px)" : "translateX(min(160px, 40%))";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{label}</span>
          <Badge variant="outline" className="font-mono text-xs">
            {model === "spring" ? "spring" : "cubic-bezier"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {settle !== null && (
            <span className="font-mono text-xs text-muted-foreground">
              settle ≈ {settle} ms
            </span>
          )}
          <Button size="sm" variant="outline" onClick={toggle} disabled={running}>
            {running ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
            {running ? "running" : "test"}
          </Button>
        </div>
      </div>

      <div className="relative flex h-24 items-center overflow-hidden rounded-md border border-border-subtle bg-muted">
        <div
          className="h-16 w-32 shrink-0 rounded-md border border-border bg-surface-card"
          style={{
            transform: offset,
            transition: travel === 0 ? "none" : css.transition,
          }}
        />
      </div>

      <p className="font-mono text-xs text-muted-foreground">
        transition: {css.transition}
        {overshoot > 0 ? ` · overshoot ${(overshoot * 100).toFixed(1)}%` : ""}
      </p>
    </div>
  );
}